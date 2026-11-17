"""Native UI validation, state isolation and normal model tool dispatch."""

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backend
import intelligent_ui as iui

DOCUMENT = {
    "title": "出行计划",
    "blocks": [
        {
            "id": "budget",
            "type": "form",
            "title": "预算计算",
            "fields": [
                {"id": "days", "type": "range", "label": "天数", "min": 1, "max": 30, "default": 3},
                {
                    "id": "daily",
                    "type": "number",
                    "label": "每天费用",
                    "min": 0,
                    "max": 10000,
                    "default": 200,
                },
            ],
            "outputs": [{"label": "总费用", "expression": "days * daily", "unit": "元"}],
        },
        {"id": "tasks", "type": "checklist", "items": [{"id": "book", "label": "预订住宿"}]},
        {
            "id": "mode",
            "type": "choices",
            "items": [{"id": "rail", "label": "高铁"}, {"id": "air", "label": "飞机"}],
        },
        {
            "id": "quiz",
            "type": "quiz",
            "items": [{"id": "yes", "label": "是", "correct": True}, {"id": "no", "label": "否"}],
        },
        {
            "id": "data",
            "type": "table",
            "columns": ["城市", "费用"],
            "rows": [["杭州", 200], ["上海", 300]],
        },
        {
            "id": "chart",
            "type": "chart",
            "labels": ["杭州", "上海"],
            "series": [{"label": "费用", "values": [-200, 300]}],
        },
        {
            "id": "cards",
            "type": "cards",
            "items": [{"label": "方案 A", "value": "高铁", "description": "市中心直达"}],
        },
        {"id": "metric", "type": "metrics", "items": [{"label": "候选城市", "value": 2}]},
        {"id": "note", "type": "text", "text": "<img src=x onerror=alert(1)> 费用为示例数据"},
    ],
}


class IntelligentUI(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.old = backend.ROOT, backend.DATA
        backend.ROOT = Path(self.folder.name)
        backend.DATA = backend.ROOT / "data"
        skill = backend.ROOT / "skills/general"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("# General\nHelp", encoding="utf-8")
        backend.initialize()
        backend.local_account.save_profile(backend.DATA, {"use_memory": False})
        with backend.database() as db:
            db.executemany(
                "INSERT INTO sessions(id,title) VALUES(?,?)", [("one", "One"), ("two", "Two")]
            )

    def tearDown(self):
        backend.security_audit.flush_pending()
        backend.ROOT, backend.DATA = self.old
        self.folder.cleanup()

    def create(self, operation="run:step"):
        with backend.database() as db:
            return iui.render(db, "one", DOCUMENT, operation)["iui_id"]

    def test_roundtrip_calculation_and_conflict(self):
        key = self.create()
        with backend.database() as db:
            first = iui.get(db, key, "one")
        self.assertEqual(first["outputs"]["budget"][0]["value"], 600)
        with backend.database() as db:
            result, conflict = iui.update(db, key, "one", 0, {"budget/days": 5, "tasks/book": True})
        self.assertIsNone(conflict)
        self.assertEqual(result["outputs"]["budget"][0]["value"], 1000)
        with backend.database() as db:
            result, conflict = iui.update(db, key, "one", 0, {"mode": "rail"})
        self.assertIsNone(result)
        self.assertTrue(conflict["state"]["tasks/book"])

    def test_idempotent_replay_preserves_state_and_owner(self):
        key = self.create()
        with backend.database() as db:
            iui.update(db, key, "one", 0, {"budget/days": 7})
        self.assertEqual(self.create(), key)
        with backend.database() as db:
            self.assertEqual(iui.get(db, key, "one")["state"]["budget/days"], 7)
            self.assertEqual(db.execute("SELECT count(*) FROM iui_documents").fetchone()[0], 1)
        with self.assertRaises(ValueError), backend.database() as db:
            iui.get(db, key, "two")
        with self.assertRaises(ValueError), backend.database() as db:
            iui.render(db, "two", {**DOCUMENT, "id": key}, "other")

    def test_branch_and_delete(self):
        key = self.create()
        with backend.database() as db:
            db.execute(
                "INSERT INTO messages(session_id,role,content) VALUES(?,?,?)",
                ("two", "assistant", "[[iui:" + key + "]]"),
            )
            iui.clone_session(db, "one", "two")
            content = db.execute(
                "SELECT content FROM messages WHERE session_id=?", ("two",)
            ).fetchone()[0]
            copied = content[6:-2]
            self.assertNotEqual(copied, key)
            self.assertEqual(iui.get(db, copied, "two")["outputs"]["budget"][0]["value"], 600)
            db.execute("DELETE FROM sessions WHERE id=?", ("one",))
        with backend.database() as db:
            self.assertIsNone(
                db.execute("SELECT id FROM iui_documents WHERE id=?", (key,)).fetchone()
            )

    def test_invalid_states_are_atomic(self):
        key = self.create()
        for patch_value in [
            {"budget/days": 31},
            {"tasks/book": 1},
            {"mode": "javascript"},
            {"bad": True},
            {"budget/daily": float("nan")},
        ]:
            with self.subTest(patch=patch_value), self.assertRaises(
                ValueError
            ), backend.database() as db:
                iui.update(db, key, "one", 0, patch_value)
        with backend.database() as db:
            self.assertEqual(iui.get(db, key, "one")["revision"], 0)

    def test_expression_validation_visits_every_branch(self):
        for source in [
            '__import__("os")',
            "(1/0) + secret()",
            "days.__class__",
            "[days]",
            "max(days, **daily)",
            "True",
        ]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                iui.expression(source, {"days", "daily"})
        self.assertEqual(
            iui.expression("max(days * daily, 0)", {"days", "daily"}, {"days": 2, "daily": 3}), 6
        )
        with self.assertRaises(ValueError):
            iui.expression("days ** daily", {"days", "daily"}, {"days": 2, "daily": 30})

    def test_invalid_document_limits(self):
        for change in [
            {"blocks": []},
            {"layout": "absolute"},
            {"javascript": "alert(1)"},
            {"blocks": [DOCUMENT["blocks"][0]] * 25},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                iui.validate({**DOCUMENT, **change})

    def test_normal_completion_advertises_and_saves_ui_with_tools_off(self):
        c = backend.request_config({"model": "mock", "allow_tools": False})
        c.update(_session_id="one", _run_id="fixture")
        responses = [
            {
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "render",
                                    "type": "function",
                                    "function": {
                                        "name": "render_iui",
                                        "arguments": json.dumps(DOCUMENT),
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
            {"choices": [{"message": {"content": None}}]},
        ]
        requests = []

        def model(config, path, payload):
            requests.append(copy.deepcopy(payload))
            return responses.pop(0)

        with patch.object(backend, "upstream", side_effect=model):
            answer = backend.completion(c, [{"role": "user", "content": "帮我比较出行方案"}])
        self.assertIn("[[iui:", answer)
        self.assertEqual(
            [tool["function"]["name"] for tool in requests[0]["tools"]], ["render_iui"]
        )
        self.assertEqual(c["tools"], [])
        with backend.database() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM iui_documents").fetchone()[0], 1)

    def test_ui_disabled_and_text_only_models(self):
        for options in [
            {"iui_enabled": False},
            {"models": [{"id": "mock", "tool_calling": False}]},
        ]:
            c = backend.request_config(
                {
                    "model": "mock",
                    "allow_tools": False,
                    **({"iui_enabled": False} if "iui_enabled" in options else {}),
                }
            )
            c.update(_session_id="one", **options)
            with patch.object(
                backend, "upstream", return_value={"choices": [{"message": {"content": "你好"}}]}
            ) as model:
                self.assertEqual(backend.completion(c, []), "你好")
                self.assertNotIn("tools", model.call_args.args[2])


if __name__ == "__main__":
    unittest.main()
