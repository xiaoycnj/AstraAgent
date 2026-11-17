"""Session-owned native interactive documents and validated local calculations."""

import ast
import json
import math
import operator
import re
import uuid
from urllib.parse import parse_qs, urlsplit

TYPES = ("text", "metrics", "cards", "table", "chart", "checklist", "choices", "quiz", "form")
ITEM = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "label": {"type": "string"},
        "value": {"type": ["string", "number"]},
        "description": {"type": "string"},
        "checked": {"type": "boolean"},
        "correct": {"type": "boolean"},
    },
    "additionalProperties": False,
}
FIELD = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "label": {"type": "string"},
        "type": {"type": "string", "enum": ["text", "number", "range", "select", "checkbox"]},
        "default": {"type": ["string", "number", "boolean"]},
        "min": {"type": "number"},
        "max": {"type": "number"},
        "step": {"type": "number"},
        "required": {"type": "boolean"},
        "options": {"type": "array", "items": {"type": "string"}, "maxItems": 30},
    },
    "required": ["id", "label", "type"],
    "additionalProperties": False,
}
BLOCK = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "type": {"type": "string", "enum": list(TYPES)},
        "title": {"type": "string"},
        "text": {"type": "string"},
        "items": {"type": "array", "items": ITEM, "maxItems": 40},
        "columns": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
        "rows": {
            "type": "array",
            "items": {
                "type": "array",
                "items": {"type": ["string", "number", "boolean", "null"]},
                "maxItems": 12,
            },
            "maxItems": 100,
        },
        "labels": {"type": "array", "items": {"type": "string"}, "maxItems": 40},
        "series": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "values": {"type": "array", "items": {"type": "number"}, "maxItems": 40},
                },
                "required": ["label", "values"],
                "additionalProperties": False,
            },
            "maxItems": 6,
        },
        "fields": {"type": "array", "items": FIELD, "maxItems": 16},
        "outputs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "expression": {"type": "string"},
                    "unit": {"type": "string"},
                },
                "required": ["label", "expression"],
                "additionalProperties": False,
            },
            "maxItems": 8,
        },
        "prompt": {"type": "string"},
    },
    "required": ["id", "type"],
    "additionalProperties": False,
}
DEFINITION = {
    "type": "function",
    "function": {
        "name": "render_iui",
        "description": "Create or update an inline Intelligent UI when comparison, charts, choices, a checklist, quiz or interactive calculator will help. Use plain text for simple answers. "
        "Use stable block/field IDs. Forms support safe arithmetic expressions over numeric field IDs, min/max/abs/round/sqrt/sin/cos/log. No HTML or JavaScript. "
        "Returns a markdown marker to include in your answer; users can interact locally and add selected results to their next message.",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Existing UI ID to update, omit to create.",
                },
                "title": {"type": "string"},
                "description": {"type": "string"},
                "layout": {"type": "string", "enum": ["stack", "columns"]},
                "blocks": {"type": "array", "items": BLOCK, "maxItems": 24},
            },
            "required": ["title", "blocks"],
            "additionalProperties": False,
        },
    },
}
FUNCTIONS = {
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "log": math.log,
}
OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
}


def initialize(db):
    db.execute(
        """CREATE TABLE IF NOT EXISTS iui_documents(
      id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      definition TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"""
    )
    db.execute("CREATE INDEX IF NOT EXISTS iui_session ON iui_documents(session_id)")


def text(value, limit=4000, empty=True):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise ValueError("IUI 文字格式无效")
    return value


def ident(value):
    value = text(value, 64, False)
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,63}", value):
        raise ValueError("IUI 组件 ID 无效")
    return value


def finite(value):
    if type(value) not in (int, float) or abs(value) > 1e15 or not math.isfinite(value):
        raise ValueError("IUI 数值超出范围")
    return value


def expression(source, names, values=None):
    tree = ast.parse(text(source, 300, False), mode="eval")
    if len(list(ast.walk(tree))) > 80:
        raise ValueError("计算表达式过长")

    def check(node):
        if isinstance(node, ast.Constant):
            finite(node.value)
            return
        if isinstance(node, ast.Name) and node.id in names:
            return
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            check(node.operand)
            return
        if isinstance(node, ast.BinOp) and type(node.op) in {*OPERATORS, ast.Pow}:
            check(node.left)
            check(node.right)
            return
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in FUNCTIONS
            and not node.keywords
            and 1 <= len(node.args) <= 8
        ):
            for argument in node.args:
                check(argument)
            return
        raise ValueError("计算表达式仅支持字段名称与数学运算")

    check(tree.body)
    if values is None:
        return None

    def visit(node):
        if isinstance(node, ast.Constant):
            return finite(node.value)
        if isinstance(node, ast.Name) and node.id in names:
            return finite((values or {}).get(node.id, 0))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return finite(visit(node.operand) * (1 if isinstance(node.op, ast.UAdd) else -1))
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Pow):
                if abs(right) > 12:
                    raise ValueError("指数需在 -12 至 12 之间")
                return finite(left**right)
            if type(node.op) in OPERATORS:
                return finite(OPERATORS[type(node.op)](left, right))
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in FUNCTIONS
            and not node.keywords
            and 1 <= len(node.args) <= 8
        ):
            return finite(FUNCTIONS[node.func.id](*[visit(arg) for arg in node.args]))
        raise ValueError("计算表达式仅支持字段名称与数学运算")

    return visit(tree.body)


def validate(value):
    if not isinstance(value, dict) or set(value) - {
        "id",
        "title",
        "description",
        "layout",
        "blocks",
    }:
        raise ValueError("IUI 文档字段无效")
    result = {
        "title": text(value.get("title"), 160, False),
        "description": text(value.get("description", ""), 1000),
        "layout": value.get("layout", "stack"),
        "blocks": [],
    }
    if result["layout"] not in ("stack", "columns"):
        raise ValueError("IUI 布局无效")
    blocks = value.get("blocks")
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= 24:
        raise ValueError("IUI 需包含 1–24 个组件")
    seen = set()
    for raw in blocks:
        if not isinstance(raw, dict) or set(raw) - set(BLOCK["properties"]):
            raise ValueError("IUI 组件字段无效")
        key = ident(raw.get("id"))
        kind = raw.get("type")
        if key in seen or kind not in TYPES:
            raise ValueError("IUI 组件重复或类型无效")
        seen.add(key)
        block = {
            "id": key,
            "type": kind,
            "title": text(raw.get("title", ""), 160),
            "text": text(raw.get("text", ""), 8000),
        }
        if kind in ("metrics", "cards", "checklist", "choices", "quiz"):
            items = raw.get("items")
            if not isinstance(items, list) or not 1 <= len(items) <= 40:
                raise ValueError("IUI 选项数量无效")
            ids = set()
            clean = []
            for index, item in enumerate(items):
                if not isinstance(item, dict) or set(item) - set(ITEM["properties"]):
                    raise ValueError("IUI 选项字段无效")
                item_id = ident(item.get("id", "item" + str(index)))
                if item_id in ids:
                    raise ValueError("IUI 选项 ID 重复")
                ids.add(item_id)
                entry = {
                    "id": item_id,
                    "label": text(item.get("label"), 200, False),
                    "description": text(item.get("description", ""), 2000),
                }
                scalar = item.get("value", "")
                if type(scalar) in (int, float):
                    finite(scalar)
                elif not isinstance(scalar, str):
                    raise ValueError("IUI 指标值无效")
                entry["value"] = text(scalar, 500) if isinstance(scalar, str) else scalar
                for flag in ("checked", "correct"):
                    if type(item.get(flag, False)) is not bool:
                        raise ValueError("IUI 选项开关无效")
                    entry[flag] = item.get(flag, False)
                clean.append(entry)
            if kind == "quiz" and sum(item["correct"] for item in clean) != 1:
                raise ValueError("选择题需有一个正确答案")
            block["items"] = clean
        if kind == "table":
            columns = raw.get("columns")
            rows = raw.get("rows")
            if (
                not isinstance(columns, list)
                or not 1 <= len(columns) <= 12
                or not isinstance(rows, list)
                or len(rows) > 100
            ):
                raise ValueError("IUI 表格大小无效")
            block["columns"] = [text(column, 120, False) for column in columns]
            block["rows"] = []
            for row in rows:
                if not isinstance(row, list) or len(row) != len(columns):
                    raise ValueError("IUI 表格列数不一致")
                clean = []
                for cell in row:
                    if type(cell) in (int, float):
                        clean.append(finite(cell))
                    elif type(cell) is bool or cell is None:
                        clean.append(cell)
                    else:
                        clean.append(text(cell, 2000))
                block["rows"].append(clean)
        if kind == "chart":
            labels = raw.get("labels")
            series = raw.get("series")
            if (
                not isinstance(labels, list)
                or not 1 <= len(labels) <= 40
                or not isinstance(series, list)
                or not 1 <= len(series) <= 6
            ):
                raise ValueError("IUI 图表大小无效")
            block["labels"] = [text(label, 120, False) for label in labels]
            block["series"] = []
            for item in series:
                if (
                    not isinstance(item, dict)
                    or set(item) - {"label", "values"}
                    or not isinstance(item.get("values"), list)
                    or len(item["values"]) != len(labels)
                ):
                    raise ValueError("IUI 图表序列无效")
                block["series"].append(
                    {
                        "label": text(item.get("label"), 120, False),
                        "values": [finite(number) for number in item["values"]],
                    }
                )
        if kind == "form":
            fields = raw.get("fields")
            outputs = raw.get("outputs", [])
            if (
                not isinstance(fields, list)
                or not 1 <= len(fields) <= 16
                or not isinstance(outputs, list)
                or len(outputs) > 8
            ):
                raise ValueError("IUI 表单大小无效")
            clean = []
            ids = set()
            for field in fields:
                if not isinstance(field, dict) or set(field) - set(FIELD["properties"]):
                    raise ValueError("IUI 表单字段无效")
                field_id = ident(field.get("id"))
                field_type = field.get("type")
                if field_id in ids or field_type not in (
                    "text",
                    "number",
                    "range",
                    "select",
                    "checkbox",
                ):
                    raise ValueError("IUI 表单字段 ID 或类型无效")
                ids.add(field_id)
                entry = {
                    "id": field_id,
                    "label": text(field.get("label"), 120, False),
                    "type": field_type,
                    "required": field.get("required", False),
                }
                if type(entry["required"]) is not bool:
                    raise ValueError("IUI 必填开关无效")
                if field_type in ("number", "range"):
                    entry.update(
                        min=finite(field.get("min", -1e12 if field_type == "number" else 0)),
                        max=finite(field.get("max", 1e12 if field_type == "number" else 100)),
                        step=finite(field.get("step", 1)),
                    )
                    if entry["min"] >= entry["max"] or entry["step"] <= 0:
                        raise ValueError("IUI 数值范围无效")
                if field_type == "select":
                    options = field.get("options")
                    if not isinstance(options, list) or not 1 <= len(options) <= 30:
                        raise ValueError("IUI 下拉选项无效")
                    entry["options"] = [text(option, 120, False) for option in options]
                default = field.get(
                    "default",
                    (
                        False
                        if field_type == "checkbox"
                        else (
                            entry["options"][0]
                            if field_type == "select"
                            else (
                                max(entry["min"], min(entry["max"], 0))
                                if field_type in ("number", "range")
                                else ""
                            )
                        )
                    ),
                )
                entry["default"] = field_value(entry, default)
                clean.append(entry)
            block["fields"] = clean
            block["outputs"] = []
            numeric = {field["id"] for field in clean if field["type"] in ("number", "range")}
            for output in outputs:
                if not isinstance(output, dict) or set(output) - {"label", "expression", "unit"}:
                    raise ValueError("IUI 计算结果字段无效")
                formula = text(output.get("expression"), 300, False)
                try:
                    expression(formula, numeric)
                except (SyntaxError, ValueError) as error:
                    raise ValueError("IUI 计算表达式无效：" + str(error)) from None
                block["outputs"].append(
                    {
                        "label": text(output.get("label"), 120, False),
                        "expression": formula,
                        "unit": text(output.get("unit", ""), 40),
                    }
                )
        block["prompt"] = text(raw.get("prompt", ""), 2000)
        result["blocks"].append(block)
    if len(json.dumps(result, ensure_ascii=False).encode()) > 256_000:
        raise ValueError("IUI 文档超过大小限制")
    return result


def field_value(field, value):
    kind = field["type"]
    if kind == "checkbox":
        if type(value) is not bool:
            raise ValueError("IUI 开关值无效")
    elif kind in ("number", "range"):
        if value == "":
            return ""
        finite(value)
        if not field["min"] <= value <= field["max"]:
            raise ValueError("IUI 输入超出范围")
    else:
        text(value, 4000)
        if kind == "select" and value not in field["options"]:
            raise ValueError("IUI 选项不存在")
    return value


def state_fields(document):
    result = {}
    for block in document["blocks"]:
        key = block["id"]
        kind = block["type"]
        if kind == "checklist":
            for item in block["items"]:
                result[key + "/" + item["id"]] = {"type": "checkbox", "default": item["checked"]}
        elif kind in ("choices", "quiz"):
            result[key] = {
                "type": "select",
                "options": [""] + [item["id"] for item in block["items"]],
                "default": "",
            }
        elif kind == "form":
            for field in block["fields"]:
                result[key + "/" + field["id"]] = field
    return result


def snapshot(row):
    result = dict(row)
    result["document"] = json.loads(result.pop("definition"))
    result["state"] = json.loads(result["state"])
    outputs = {}
    for block in result["document"]["blocks"]:
        if block["type"] != "form":
            continue
        values = {
            field["id"]: result["state"][block["id"] + "/" + field["id"]]
            for field in block["fields"]
            if field["type"] in ("number", "range")
        }
        outputs[block["id"]] = []
        for output in block["outputs"]:
            try:
                value = expression(output["expression"], set(values), values)
                error = None
            except (ArithmeticError, ValueError, TypeError, OverflowError):
                value = None
                error = "填写有效数值后显示结果"
            outputs[block["id"]].append(
                {"label": output["label"], "unit": output["unit"], "value": value, "error": error}
            )
    result["outputs"] = outputs
    return result


def get(db, key, session):
    if not isinstance(key, str) or not re.fullmatch("[a-f0-9]{32}", key):
        raise ValueError("IUI 标识无效")
    row = db.execute(
        "SELECT * FROM iui_documents WHERE id=? AND session_id=?", (key, session)
    ).fetchone()
    if not row:
        raise ValueError("IUI 不属于当前会话或已删除")
    return snapshot(row)


def render(db, session, args, operation):
    if not session or not db.execute("SELECT 1 FROM sessions WHERE id=?", (session,)).fetchone():
        raise ValueError("IUI 需要有效的所属会话")
    document = validate(args)
    key = args.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, operation).hex
    if not isinstance(key, str) or not re.fullmatch("[a-f0-9]{32}", key):
        raise ValueError("IUI 标识无效")
    db.execute("BEGIN IMMEDIATE")
    old = db.execute("SELECT * FROM iui_documents WHERE id=?", (key,)).fetchone()
    if old and old["session_id"] != session:
        raise ValueError("IUI 不能跨会话修改")
    previous = json.loads(old["state"]) if old else {}
    state = {}
    for path, field in state_fields(document).items():
        try:
            state[path] = field_value(field, previous.get(path, field["default"]))
        except ValueError:
            state[path] = field["default"]
    db.execute(
        "INSERT INTO iui_documents(id,session_id,definition,state) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,state=excluded.state,revision=iui_documents.revision+1,updated=CURRENT_TIMESTAMP",
        (
            key,
            session,
            json.dumps(document, ensure_ascii=False),
            json.dumps(state, ensure_ascii=False),
        ),
    )
    return {
        "iui_id": key,
        "title": document["title"],
        "markdown": "[[iui:" + key + "]]",
        "message": "Native UI created. Include the markdown marker in your answer. User interactions persist locally; user may add results to the conversation.",
    }


def clone_session(db, source, target):
    """Copy referenced documents so branches own independent interaction state."""
    rows = db.execute("SELECT id,content FROM messages WHERE session_id=?", (target,)).fetchall()
    replacements = {}
    for row in rows:
        content = row["content"]
        for key in re.findall(r"\[\[iui:([a-f0-9]{32})\]\]", content):
            if key not in replacements:
                new_key = uuid.uuid4().hex
                copied = db.execute(
                    "INSERT INTO iui_documents(id,session_id,definition,state,revision) "
                    "SELECT ?,?,definition,state,revision FROM iui_documents WHERE id=? AND session_id=?",
                    (new_key, target, key, source),
                )
                if copied.rowcount:
                    replacements[key] = new_key
            if key in replacements:
                content = content.replace(
                    "[[iui:" + key + "]]", "[[iui:" + replacements[key] + "]]"
                )
        if content != row["content"]:
            db.execute("UPDATE messages SET content=? WHERE id=?", (content, row["id"]))


def update(db, key, session, revision, patch):
    if type(revision) is not int or not isinstance(patch, dict) or len(patch) > 100:
        raise ValueError("IUI 状态请求无效")
    db.execute("BEGIN IMMEDIATE")
    current = get(db, key, session)
    if current["revision"] != revision:
        return None, current
    fields = state_fields(current["document"])
    if set(patch) - set(fields):
        raise ValueError("IUI 状态字段不存在")
    state = current["state"]
    for path, value in patch.items():
        state[path] = field_value(fields[path], value)
    db.execute(
        "UPDATE iui_documents SET state=?,revision=revision+1,updated=CURRENT_TIMESTAMP WHERE id=?",
        (json.dumps(state, ensure_ascii=False), key),
    )
    return get(db, key, session), None


def handle_request(handler, database):
    url = urlsplit(handler.path)
    match = re.fullmatch(r"/api/iui/([a-f0-9]{32})(/state)?", url.path)
    if not match:
        return False
    if handler.command == "GET" and not match[2]:
        session = parse_qs(url.query).get("session", [""])[0]
        with database() as db:
            handler.reply(200, get(db, match[1], session))
    elif handler.command == "POST" and match[2]:
        body = handler.body()
        with database() as db:
            result, conflict = update(
                db, match[1], body.get("session_id"), body.get("revision"), body.get("patch")
            )
            handler.reply(
                409 if conflict else 200,
                {"error": "交互状态已更新，请重试", "current": conflict} if conflict else result,
            )
    else:
        raise ValueError("IUI 请求方法无效")
    return True
