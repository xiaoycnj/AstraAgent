"""Versioned writing projects, explicit canon status, and bounded chapter context."""

import io
import json
import time
import uuid
import zipfile
import html
import re

KINDS = ("chapter", "outline", "character", "location", "timeline", "note")
STATES = ("draft", "confirmed", "assumption")
INVALID_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


def initialize(db):
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS stories(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS story_entries(id TEXT PRIMARY KEY,story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,state TEXT NOT NULL,position INTEGER NOT NULL,revision INTEGER NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS story_revisions(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES story_entries(id) ON DELETE CASCADE,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS story_entries_project ON story_entries(story_id,kind,position);
    """
    )
    if "story_id" not in {
        row["name"] for row in db.execute("PRAGMA table_info(sessions)")
    }:
        db.execute("ALTER TABLE sessions ADD COLUMN story_id TEXT NOT NULL DEFAULT ''")


def listing(db):
    return [
        dict(row)
        for row in db.execute(
            "SELECT s.*,COUNT(e.id) entries FROM stories s LEFT JOIN story_entries e ON e.story_id=s.id GROUP BY s.id ORDER BY s.updated DESC LIMIT 200"
        )
    ]


def get(db, key):
    row = db.execute("SELECT * FROM stories WHERE id=?", (key,)).fetchone()
    if row is None:
        raise ValueError("写作项目不存在")
    return {
        **dict(row),
        "entries": [
            dict(item)
            for item in db.execute(
                "SELECT * FROM story_entries WHERE story_id=? ORDER BY position,updated",
                (key,),
            )
        ],
    }


def create(db, body):
    title, description = body.get("title"), body.get("description", "")
    if (
        not isinstance(title, str)
        or not 1 <= len(title.strip()) <= 100
        or not isinstance(description, str)
        or len(description) > 4000
    ):
        raise ValueError("项目标题或简介无效")
    if INVALID_XML.search(title + description):
        raise ValueError("文本包含不支持的控制字符")
    key = uuid.uuid4().hex
    db.execute(
        "INSERT INTO stories VALUES(?,?,?,?)",
        (key, title.strip(), description, time.time()),
    )
    return get(db, key)


def save(db, key, body):
    get(db, key)
    entry_id = body.get("id")
    old = (
        db.execute(
            "SELECT * FROM story_entries WHERE id=? AND story_id=?", (entry_id, key)
        ).fetchone()
        if entry_id
        else None
    )
    if entry_id and old is None:
        raise ValueError("写作条目不存在")
    if old and (
        type(body.get("expected_revision")) is not int
        or old["revision"] != body["expected_revision"]
    ):
        raise FileExistsError("条目已在其他窗口更新，请重新加载")
    kind, state = body.get("kind"), body.get("state", "draft")
    title, content, position = (
        body.get("title"),
        body.get("content", ""),
        body.get("position", old["position"] if old else 0),
    )
    if kind not in KINDS or state not in STATES:
        raise ValueError("条目类型或设定状态无效")
    if (
        not isinstance(title, str)
        or not 1 <= len(title.strip()) <= 200
        or not isinstance(content, str)
        or len(content) > 60000
    ):
        raise ValueError("条目标题最多 200 字符，正文最多 60000 字符")
    if INVALID_XML.search(title + content):
        raise ValueError("文本包含不支持的控制字符")
    if type(position) is not int or not 0 <= position <= 100000:
        raise ValueError("条目顺序无效")
    entry_id = entry_id or uuid.uuid4().hex
    revision = old["revision"] + 1 if old else 1
    db.execute(
        "INSERT INTO story_entries VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,content=excluded.content,state=excluded.state,position=excluded.position,revision=excluded.revision,updated=excluded.updated",
        (
            entry_id,
            key,
            kind,
            title.strip(),
            content,
            state,
            position,
            revision,
            time.time(),
        ),
    )
    item = dict(
        db.execute("SELECT * FROM story_entries WHERE id=?", (entry_id,)).fetchone()
    )
    db.execute(
        "INSERT INTO story_revisions VALUES(?,?,?,?,?)",
        (
            uuid.uuid4().hex,
            entry_id,
            revision,
            json.dumps(item, ensure_ascii=False),
            time.time(),
        ),
    )
    db.execute("UPDATE stories SET updated=? WHERE id=?", (time.time(), key))
    return item


def history(db, key, entry_id):
    if not db.execute(
        "SELECT 1 FROM story_entries WHERE id=? AND story_id=?", (entry_id, key)
    ).fetchone():
        raise ValueError("条目不存在")
    return [
        {
            "revision": row["revision"],
            "created": row["created"],
            "snapshot": json.loads(row["snapshot"]),
        }
        for row in db.execute(
            "SELECT revision,created,snapshot FROM story_revisions WHERE entry_id=? ORDER BY revision DESC",
            (entry_id,),
        )
    ]


def context(db, key, chapter_id=None, query=""):
    if (
        not isinstance(query, str)
        or len(query) > 1000
        or chapter_id is not None
        and not isinstance(chapter_id, str)
    ):
        raise ValueError("写作上下文查询无效")
    project = get(db, key)
    chapters = [item for item in project["entries"] if item["kind"] == "chapter"]
    current = next((item for item in chapters if item["id"] == chapter_id), None)
    if chapter_id and current is None:
        raise ValueError("当前章节不属于此写作项目")
    previous = (
        [item for item in chapters if item["position"] < current["position"]]
        if current
        else chapters
    )[-2:]
    facts = [
        item
        for item in project["entries"]
        if item["kind"] != "chapter" and item["state"] == "confirmed"
    ]
    terms = query.lower().split()[:12]
    facts.sort(
        key=lambda item: sum(
            term in (item["title"] + item["content"]).lower() for term in terms
        ),
        reverse=True,
    )
    selected = []
    budget = 18000
    for item in ([current] if current else []) + previous + facts:
        if budget <= 0:
            break
        excerpt = item["content"][: min(budget, 4000 if item is current else 2000)]
        selected.append(
            {
                **{
                    field: item[field]
                    for field in ("id", "kind", "title", "state", "revision")
                },
                "content": excerpt,
                "truncated": len(excerpt) < len(item["content"]),
            }
        )
        budget -= len(excerpt) + len(item["title"]) + 150
    return {
        "id": key,
        "title": project["title"],
        "description": project["description"],
        "entries": selected,
        "note": "仅已确认的设定进入默认上下文，当前章节及前两章用于衔接。未载入条目不能视为不存在。",
    }


def export(db, key, kind):
    project = get(db, key)
    chapters = [item for item in project["entries"] if item["kind"] == "chapter"]
    if not chapters:
        raise ValueError("请先创建章节")
    if sum(len(item["content"]) for item in chapters) > 2_000_000:
        raise ValueError("单次导出正文最多二百万字符")
    if kind == "md":
        return (
            "# "
            + project["title"]
            + "\n\n"
            + "\n\n".join(
                "## " + item["title"] + "\n\n" + item["content"] for item in chapters
            )
        ).encode("utf-8"), "text/markdown"
    if kind == "docx":
        output = io.BytesIO()
        paragraphs = [
            '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>'
            + html.escape(project["title"])
            + "</w:t></w:r></w:p>"
        ]
        for chapter in chapters:
            paragraphs.append(
                '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>'
                + html.escape(chapter["title"])
                + "</w:t></w:r></w:p>"
            )
            paragraphs.extend(
                '<w:p><w:r><w:t xml:space="preserve">'
                + html.escape(line)
                + "</w:t></w:r></w:p>"
                for line in chapter["content"].splitlines()
            )
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "[Content_Types].xml",
                '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
            )
            archive.writestr(
                "_rels/.rels",
                '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
            )
            archive.writestr(
                "word/_rels/document.xml.rels",
                '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
            )
            archive.writestr(
                "word/styles.xml",
                '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style></w:styles>',
            )
            archive.writestr(
                "word/document.xml",
                '<?xml version="1.0" encoding="utf-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                + "".join(paragraphs)
                + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
            )
        return (
            output.getvalue(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    if kind != "epub":
        raise ValueError("导出格式需为 Markdown、EPUB 或 DOCX")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED
        )
        archive.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        manifest = [
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        ]
        spine, navigation = [], []
        for index, chapter in enumerate(chapters):
            name = "chapter-" + str(index) + ".xhtml"
            text = "".join(
                "<p>" + html.escape(line) + "</p>"
                for line in chapter["content"].splitlines()
                if line.strip()
            )
            archive.writestr(
                "OEBPS/" + name,
                '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>'
                + html.escape(chapter["title"])
                + "</title></head><body><h1>"
                + html.escape(chapter["title"])
                + "</h1>"
                + text
                + "</body></html>",
            )
            manifest.append(
                '<item id="c'
                + str(index)
                + '" href="'
                + name
                + '" media-type="application/xhtml+xml"/>'
            )
            spine.append('<itemref idref="c' + str(index) + '"/>')
            navigation.append(
                '<li><a href="'
                + name
                + '">'
                + html.escape(chapter["title"])
                + "</a></li>"
            )
        archive.writestr(
            "OEBPS/nav.xhtml",
            '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>'
            + "".join(navigation)
            + "</ol></nav></body></html>",
        )
        archive.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">urn:uuid:'
            + key
            + "</dc:identifier><dc:title>"
            + html.escape(project["title"])
            + '</dc:title><dc:language>zh-CN</dc:language><meta property="dcterms:modified">'
            + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(project["updated"]))
            + "</meta></metadata><manifest>"
            + "".join(manifest)
            + "</manifest><spine>"
            + "".join(spine)
            + "</spine></package>",
        )
    return output.getvalue(), "application/epub+zip"
