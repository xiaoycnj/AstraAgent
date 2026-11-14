"""Immutable creative outputs and optimistic version updates."""

import base64
import hashlib
import html
import io
import json
import re
from pathlib import Path
import time
import uuid
import zipfile
from urllib.parse import urlsplit, unquote
from html.parser import HTMLParser
import attachments

PREVIEW_POLICY = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"


class StaticHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.output = []
        self.blocked = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "iframe", "object"):
            self.blocked.append(tag)
            return
        if self.blocked or tag in ("base", "meta", "link", "embed", "frame", "portal"):
            return
        kept = []
        for key, value in attrs:
            if key.startswith("on") or key in (
                "srcdoc",
                "action",
                "formaction",
                "ping",
                "autofocus",
                "download",
            ):
                continue
            if key in ("href", "xlink:href") and not (value or "").startswith("#"):
                continue
            if key in ("src", "poster", "background") and not (
                value or ""
            ).lower().startswith(
                (
                    "data:image/png;base64,",
                    "data:image/jpeg;base64,",
                    "data:image/webp;base64,",
                )
            ):
                continue
            if key == "srcset":
                continue
            kept.append(
                " "
                + key
                + (
                    '="' + html.escape(value, quote=True) + '"'
                    if value is not None
                    else ""
                )
            )
        self.output.append("<" + tag + "".join(kept) + ">")
        self.in_style = tag == "style"

    def handle_endtag(self, tag):
        if self.blocked:
            if tag == self.blocked[-1]:
                self.blocked.pop()
            return
        if tag in (
            "base",
            "meta",
            "link",
            "embed",
            "frame",
            "portal",
            "script",
            "iframe",
            "object",
        ):
            return
        self.output.append("</" + tag + ">")
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if not self.blocked:
            self.output.append(data if self.in_style else html.escape(data))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in (
            "img",
            "input",
            "br",
            "hr",
            "meta",
            "link",
            "base",
            "embed",
            "frame",
        ):
            self.handle_endtag(tag)


def initialize(db):
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS creations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,logical_key TEXT NOT NULL,title TEXT NOT NULL,head TEXT NOT NULL,updated REAL NOT NULL,UNIQUE(session_id,logical_key));
        CREATE TABLE IF NOT EXISTS creation_versions(id TEXT PRIMARY KEY,creation_id TEXT NOT NULL REFERENCES creations(id) ON DELETE CASCADE,attachment_id TEXT NOT NULL,parent TEXT,metadata TEXT NOT NULL,created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS creation_versions_attachment ON creation_versions(attachment_id);
    """
    )


def owned(db, data, sid, key):
    resources = attachments.resources(db, data, sid)
    if key not in {
        item["id"] for kind in ("sources", "outputs") for item in resources[kind]
    }:
        raise ValueError("作品附件必须来自所属会话")
    return attachments.meta(data, key)


def register(db, sid, item, logical_key=None, metadata=None, parent_attachment=None):
    if not sid:
        raise ValueError("作品需要关联会话")
    row = None
    if parent_attachment:
        row = db.execute(
            "SELECT c.* FROM creations c JOIN creation_versions v ON v.creation_id=c.id WHERE c.session_id=? AND v.attachment_id=? ORDER BY v.created DESC LIMIT 1",
            (sid, parent_attachment),
        ).fetchone()
    logical_key = logical_key or "attachment:" + item["id"]
    if row is None:
        row = db.execute(
            "SELECT * FROM creations WHERE session_id=? AND logical_key=?",
            (sid, logical_key),
        ).fetchone()
    key = row["id"] if row else uuid.uuid4().hex
    version = uuid.uuid4().hex
    if row is None:
        db.execute(
            "INSERT INTO creations VALUES(?,?,?,?,?,?)",
            (key, sid, logical_key, item["name"], version, time.time()),
        )
    db.execute(
        "INSERT INTO creation_versions VALUES(?,?,?,?,?,?)",
        (
            version,
            key,
            item["id"],
            row["head"] if row else None,
            json.dumps(metadata or {}, ensure_ascii=False),
            time.time(),
        ),
    )
    db.execute(
        "UPDATE creations SET head=?,updated=? WHERE id=?", (version, time.time(), key)
    )
    return {"id": key, "version": version}


def get(db, data, key):
    row = db.execute("SELECT * FROM creations WHERE id=?", (key,)).fetchone()
    if row is None:
        raise ValueError("作品不存在")
    result = dict(row)
    result["versions"] = []
    for version in db.execute(
        "SELECT * FROM creation_versions WHERE creation_id=? ORDER BY created DESC",
        (key,),
    ):
        item = dict(version)
        item["metadata"] = json.loads(item["metadata"])
        try:
            item["attachment"] = attachments.public(
                attachments.meta(data, item["attachment_id"])
            )
        except ValueError:
            item["attachment"] = {
                "id": item["attachment_id"],
                "name": "附件不可用",
                "unavailable": True,
            }
        result["versions"].append(item)
    return result


def listing(db, data, sid=None):
    rows = db.execute(
        "SELECT id FROM creations WHERE (? IS NULL OR session_id=?) ORDER BY updated DESC LIMIT 200",
        (sid, sid),
    ).fetchall()
    return [get(db, data, row["id"]) for row in rows]


def create(db, data, body):
    sid = body.get("session_id")
    if (
        not isinstance(sid, str)
        or not db.execute("SELECT 1 FROM sessions WHERE id=?", (sid,)).fetchone()
    ):
        raise ValueError("请选择作品所属会话")
    metadata = body.get("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("作品信息无效")
    assets = metadata.get("assets", [])
    if (
        not isinstance(assets, list)
        or len(assets) > 19
        or any(not isinstance(key, str) for key in assets)
    ):
        raise ValueError("资源列表无效")
    for key in assets:
        owned(db, data, sid, key)
    fresh = "content" in body
    if fresh:
        content = body["content"]
        if not isinstance(content, str) or not 0 < len(content) <= 60000:
            raise ValueError("作品正文需为 1–60000 字符")
        item = attachments.upload(
            data,
            {
                "name": body.get("name", "index.html"),
                "data": base64.b64encode(content.encode("utf-8")).decode(),
            },
        )
    else:
        item = attachments.public(owned(db, data, sid, body.get("attachment_id")))
    try:
        db.execute(
            "INSERT OR IGNORE INTO session_outputs(session_id,attachment_id) VALUES(?,?)",
            (sid, item["id"]),
        )
        return register(db, sid, item, metadata={"assets": assets})
    except BaseException:
        if fresh:
            folder = attachments.location(data, item["id"])
            (folder / "content").unlink(missing_ok=True)
            (folder / "meta.json").unlink(missing_ok=True)
            folder.rmdir()
        raise


def selected(db, data, key, version_id=None):
    creation = get(db, data, key)
    version = next(
        (
            item
            for item in creation["versions"]
            if item["id"] == (version_id or creation["head"])
        ),
        None,
    )
    if version is None or version["attachment"].get("unavailable"):
        raise ValueError("作品版本或附件不可用")
    return creation, version


def text(data, item):
    if Path(item["name"]).suffix.lower() not in attachments.TEXT_EXT:
        raise ValueError("此格式不支持文本编辑")
    raw = (attachments.location(data, item["id"]) / "content").read_bytes()
    if len(raw) > 500000:
        raise ValueError("作品编辑上限为 500 KB")
    return raw.decode("utf-8-sig")


def update(db, data, key, body):
    creation, version = selected(db, data, key)
    if body.get("expected_head") != creation["head"]:
        raise FileExistsError("作品已在其他窗口更新，请重新加载版本")
    if "assets" in body:
        assets = body["assets"]
        if (
            not isinstance(assets, list)
            or len(assets) > 19
            or any(not isinstance(value, str) for value in assets)
        ):
            raise ValueError("资源附件最多十九个")
        for attachment_id in assets:
            owned(db, data, creation["session_id"], attachment_id)
        item = version["attachment"]
        metadata = {**version["metadata"], "assets": list(dict.fromkeys(assets))}
    elif body.get("image_data"):
        if version["attachment"]["kind"] != "image":
            raise ValueError("仅图片作品支持转换参考图")
        _, source = selected(db, data, key, body.get("source_version"))
        if (
            not isinstance(body["image_data"], str)
            or len(body["image_data"]) > 7_000_000
        ):
            raise ValueError("PNG 参考图数据超过限制或格式无效")
        raw = base64.b64decode(body["image_data"], validate=True)
        if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("参考图需为 PNG")
        item = attachments.upload(
            data, {"name": "edit-source.png", "data": body["image_data"]}
        )
        metadata = {**source["metadata"], "converted_from": source["id"]}
    elif body.get("restore_version"):
        _, old = selected(db, data, key, body["restore_version"])
        item = old["attachment"]
        metadata = {**old["metadata"], "restored_from": old["id"]}
    else:
        content = body.get("content")
        if (
            not isinstance(content, str)
            or not 0 < len(content.encode("utf-8")) <= 500000
        ):
            raise ValueError("作品正文需为 1 字节至 500 KB")
        text(data, version["attachment"])
        item = attachments.upload(
            data,
            {
                "name": version["attachment"]["name"],
                "data": base64.b64encode(content.encode("utf-8")).decode(),
            },
        )
        metadata = {**version["metadata"], "edited": True}
    try:
        db.execute(
            "INSERT OR IGNORE INTO session_outputs(session_id,attachment_id) VALUES(?,?)",
            (creation["session_id"], item["id"]),
        )
        return register(
            db, creation["session_id"], item, creation["logical_key"], metadata
        )
    except BaseException:
        if not body.get("restore_version") and "assets" not in body:
            folder = attachments.location(data, item["id"])
            (folder / "content").unlink(missing_ok=True)
            (folder / "meta.json").unlink(missing_ok=True)
            folder.rmdir()
        raise


def preview(content, name):
    suffix = Path(name).suffix.lower()
    if suffix == ".svg":
        content = (
            '<div style="display:grid;place-items:center;min-height:90vh">'
            + content
            + "</div>"
        )
    elif suffix not in (".html", ".htm"):
        content = (
            '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.7 sans-serif">'
            + html.escape(content)
            + "</pre>"
        )
    parser = StaticHTML()
    parser.feed(content)
    parser.close()
    return (
        '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'
        + html.escape(PREVIEW_POLICY, quote=True)
        + '"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
        + "".join(parser.output)
        + "</body></html>"
    )


def document(db, data, creation, version):
    """Inline explicitly associated same-directory CSS and raster assets before sanitizing."""
    assets = {}
    for key in version["metadata"].get("assets", []):
        item = owned(db, data, creation["session_id"], key)
        if item["name"] in assets:
            raise ValueError("资源文件名重复")
        assets[item["name"]] = item

    def resource(value):
        url = urlsplit(value or "")
        if (
            url.scheme
            or url.netloc
            or url.path.startswith("/")
            or "/" in url.path.removeprefix("./")
        ):
            return None
        return assets.get(unquote(url.path.removeprefix("./")))

    def image_uri(value):
        item = resource(value)
        if not item or item["mime"] not in ("image/png", "image/jpeg", "image/webp"):
            return value
        raw = (attachments.location(data, item["id"]) / "content").read_bytes()
        return (
            "data:" + item["mime"] + ";base64," + base64.b64encode(raw).decode("ascii")
        )

    class Assets(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.output = []

        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if tag == "link" and (values.get("rel") or "").lower() == "stylesheet":
                item = resource(values.get("href"))
                if item and Path(item["name"]).suffix.lower() == ".css":
                    css = text(data, item)
                    css = re.sub(
                        r"url\(\s*[\"\']?([^\"\')]+)[\"\']?\s*\)",
                        lambda match: 'url("' + image_uri(match[1]) + '")',
                        css,
                    )
                    self.output.append("<style>" + css + "</style>")
                    return
            if tag == "img" and values.get("src"):
                attrs = [
                    (key, image_uri(value) if key == "src" else value)
                    for key, value in attrs
                ]
            self.output.append(
                "<"
                + tag
                + "".join(
                    " "
                    + key
                    + (
                        '="' + html.escape(value, quote=True) + '"'
                        if value is not None
                        else ""
                    )
                    for key, value in attrs
                )
                + ">"
            )

        def handle_endtag(self, tag):
            self.output.append("</" + tag + ">")

        def handle_data(self, value):
            self.output.append(value)

        def handle_entityref(self, value):
            self.output.append("&" + value + ";")

        def handle_charref(self, value):
            self.output.append("&#" + value + ";")

        def handle_startendtag(self, tag, attrs):
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    source = text(data, version["attachment"])
    if (
        Path(version["attachment"]["name"]).suffix.lower() in (".html", ".htm")
        and assets
    ):
        parser = Assets()
        parser.feed(source)
        parser.close()
        source = "".join(parser.output)
    return preview(source, version["attachment"]["name"])


def bundle(db, data, key, version_id=None):
    creation, version = selected(db, data, key, version_id)
    ids = [version["attachment_id"], *version["metadata"].get("assets", [])]
    if len(ids) > 20:
        raise ValueError("作品资源最多二十个")
    result = io.BytesIO()
    names = set()
    total = 0
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        manifest = []
        for attachment_id in dict.fromkeys(ids):
            item = owned(db, data, creation["session_id"], attachment_id)
            name = item["name"].replace("\\", "/").split("/")[-1]
            if name in names or name in ("", ".", "..", "astra-manifest.json"):
                raise ValueError("资源文件名重复或无效，请先重命名")
            names.add(name)
            raw = (attachments.location(data, attachment_id) / "content").read_bytes()
            total += len(raw)
            if total > 25_000_000:
                raise ValueError("作品包最多 25 MB")
            archive.writestr(name, raw)
            manifest.append({"name": name, "sha256": hashlib.sha256(raw).hexdigest()})
        archive.writestr(
            "astra-manifest.json",
            json.dumps(
                {"creation": key, "version": version["id"], "files": manifest},
                ensure_ascii=False,
                indent=2,
            ),
        )
    return result.getvalue()
