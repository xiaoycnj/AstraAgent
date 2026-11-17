"""Chat mode limits apply to schemas, tool dispatch and restored execution context."""

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backend
import execution_state
import intelligent_ui as iui
import runtime_engine

QUESTION = {
    "title": "选择学习计划",
    "purpose": "question",
    "blocks": [
        {
            "id": "goal",
            "type": "choices",
            "title": "目标",
            "items": [{"id": "math", "label": "数学"}, {"id": "english", "label": "英语"}],
        },
        {
            "id": "schedule",
            "type": "form",
            "fields": [
                {
                    "id": "hours",
                    "label": "每天时长",
                    "type": "number",
                    "min": 1,
                    "max": 8,
                    "default": "",
                    "required": True,
                }
            ],
        },
    ],
}


def tool_result(name, arguments):
    return {
        "choices": [
            {
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call",
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ],
                }
            }
        ]
    }


class ConversationModes(unittest.TestCase):
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
        runtime_engine.save_settings(backend.DATA, {"access_policy": "full"})
        with backend.database() as db:
            db.execute("INSERT INTO sessions(id,title) VALUES('session','Modes')")

    def tearDown(self):
        backend.security_audit.flush_pending()
        backend.ROOT, backend.DATA = self.old
        self.folder.cleanup()

    def config(self, mode="chat", **options):
        result = backend.request_config({"model": "mock", "conversation_mode": mode, **options})
        result["_session_id"] = "session"
        return result

    def test_chat_ignores_agent_options_before_reading_project_or_plugins(self):
        with patch.object(
            backend, "configure_project", side_effect=AssertionError("project read")
        ), patch.object(
            backend.mcp_client, "definitions", side_effect=AssertionError("MCP scanned")
        ), patch.object(
            backend.extensions, "catalog", side_effect=AssertionError("plugins scanned")
        ):
            config = self.config(
                allow_tools=True,
                tools=["write_file"],
                plugins=["agent-dispatch"],
                file_permission="all",
                command_permission="all",
                memory_policy="auto",
                auto_memory=True,
                project_id="local-project",
                story_id="local-story",
                access_policy="full",
            )
        self.assertTrue(set(config["tools"]) <= runtime_engine.CHAT_TOOLS)
        self.assertIn("image_gen", config["tools"])
        self.assertEqual(config["file_permission"], "none")
        self.assertEqual(config["command_permission"], "none")
        self.assertEqual(config["runtime_plugins"], [])
        self.assertEqual(config["project_id"], "")
        self.assertFalse(config["auto_memory"])
        self.assertNotIn("get_environment", config["system_prompt"])

    def test_model_receives_only_chat_schemas(self):
        config = self.config(allow_tools=False)
        with patch.object(
            backend, "upstream", return_value={"choices": [{"message": {"content": "你好"}}]}
        ) as model, patch.object(
            backend.mcp_client, "definitions", side_effect=AssertionError("MCP scanned")
        ):
            self.assertEqual(backend.completion(config, []), "你好")
        names = {tool["function"]["name"] for tool in model.call_args.args[2]["tools"]}
        self.assertTrue(names <= runtime_engine.CHAT_TOOLS)
        self.assertIn("render_iui", names)
        self.assertIn("image_gen", names)

    def test_forged_tools_are_rejected_before_execution(self):
        for name in (
            "read_file",
            "write_file",
            "execute_command",
            "load_tools",
            "load_plugin",
            "get_environment",
            "dispatch_session",
            "mcp_fake",
        ):
            with self.subTest(name=name), patch.object(
                backend, "upstream", return_value=tool_result(name, {})
            ), patch.object(
                backend, "run_file_tool", side_effect=AssertionError("file accessed")
            ), patch.object(
                backend.agent_environment, "command", side_effect=AssertionError("command ran")
            ):
                with self.assertRaises(backend.ApiError) as error:
                    backend.completion(self.config(), [])
                self.assertEqual(error.exception.code, 502)

    def test_image_generation_is_available_without_agent_tools_toggle(self):
        responses = [
            tool_result("image_gen", {"prompt": "A tree"}),
            {"choices": [{"message": {"content": "已生成"}}]},
        ]
        with patch.object(backend, "upstream", side_effect=responses), patch.object(
            backend.feature_modules, "execute", return_value={"ok": False, "message": "fixture"}
        ) as execute:
            self.assertEqual(backend.completion(self.config(allow_tools=False), []), "已生成")
        self.assertEqual(execute.call_args.args[0], "image_gen")

    def test_restored_context_cannot_expand_chat_permissions(self):
        config = self.config()
        cached = {
            "context": {
                "tools": ["calculator", "execute_command", "read_file"],
                "runtime_plugins": ["agent-dispatch"],
            }
        }
        execution_state.State.restore(None, cached, config)
        self.assertEqual(config["tools"], ["calculator"])
        self.assertEqual(config["runtime_plugins"], [])
        self.assertFalse(runtime_engine.authorize("execute_command", {}, config, None, None))
        self.assertIn(
            "error", backend.capability_tool("load_tools", {"names": ["read_file"]}, config, None)
        )

    def test_cross_dispatch_obeys_target_chat_mode(self):
        with backend.database() as db:
            db.execute(
                "INSERT INTO sessions(id,title,conversation_mode,project_id) VALUES('target','Target','chat','local-project')"
            )
        try:
            with patch.object(
                backend, "configure_project", side_effect=AssertionError("project read")
            ), patch.object(backend, "start_durable_chat") as start:
                result = backend.session_tool(
                    "dispatch_session",
                    {"session_id": "target", "content": "总结一下"},
                    self.config("agent", allow_tools=True),
                    None,
                )
            self.assertTrue(result["ok"])
            config = start.call_args.args[3]
            self.assertEqual(config["conversation_mode"], "chat")
            self.assertTrue(set(config["tools"]) <= runtime_engine.CHAT_TOOLS)
            self.assertEqual(config["project_id"], "")
        finally:
            backend.BUSY.discard("target")

    def test_legacy_sessions_keep_agent_mode(self):
        with backend.database() as db:
            self.assertEqual(
                db.execute("SELECT conversation_mode FROM sessions WHERE id='session'").fetchone()[
                    0
                ],
                "agent",
            )
        config = self.config("agent", allow_tools=True, file_permission="all")
        self.assertIn("load_tools", config["tools"])
        with self.assertRaises(backend.ApiError):
            self.config("invalid")

    def test_chat_with_text_only_model_omits_tool_schemas(self):
        with patch.object(backend.model_catalog, "spec", return_value={"tool_calling": False}):
            config = self.config()
            with patch.object(
                backend, "upstream", return_value={"choices": [{"message": {"content": "你好"}}]}
            ) as model:
                self.assertEqual(backend.completion(config, []), "你好")
            self.assertNotIn("tools", model.call_args.args[2])

    def create_card(self, document):
        with backend.database() as db:
            key = iui.render(db, "session", document, "question-fixture")["iui_id"]
        return key

    def test_question_validates_answers_and_preserves_free_text(self):
        key = self.create_card(QUESTION)
        with self.assertRaises(ValueError), backend.database() as db:
            iui.answer(db, key, "session", 0)
        with backend.database() as db:
            iui.update(
                db,
                key,
                "session",
                0,
                {"goal": "math", "schedule/hours": 2, "$reply": "周末可以多一点"},
            )
        with backend.database() as db:
            result, conflict = iui.answer(db, key, "session", 1)
        self.assertIsNone(conflict)
        self.assertIn("数学", result["content"])
        self.assertIn("每天时长 = 2", result["content"])
        self.assertIn("周末可以多一点", result["content"])
        with backend.database() as db:
            result, conflict = iui.answer(db, key, "session", 0)
        self.assertIsNone(result)
        self.assertEqual(conflict["revision"], 1)

    def test_confirmation_requires_explicit_decision_and_can_cancel(self):
        document = {**QUESTION, "purpose": "confirmation"}
        key = self.create_card(document)
        with self.assertRaises(ValueError), backend.database() as db:
            iui.answer(db, key, "session", 0)
        with backend.database() as db:
            iui.update(db, key, "session", 0, {"$decision": "cancel"})
        with backend.database() as db:
            result, _ = iui.answer(db, key, "session", 1)
        self.assertIn("决定 · 取消", result["content"])

    def test_confirmation_reply_contains_the_displayed_scope(self):
        document = {
            "title": "确认整理",
            "purpose": "confirmation",
            "description": "只整理本次选择",
            "blocks": [{"id": "scope", "type": "text", "text": "仅处理草稿文件夹中的三个条目"}],
        }
        key = self.create_card(document)
        with backend.database() as db:
            iui.update(db, key, "session", 0, {"$decision": "confirm"})
        with backend.database() as db:
            result, _ = iui.answer(db, key, "session", 1)
        self.assertIn("只整理本次选择", result["content"])
        self.assertIn("仅处理草稿文件夹中的三个条目", result["content"])

    def test_free_text_can_answer_an_unlisted_option(self):
        document = {"title": "想去哪里", "purpose": "question", "blocks": [QUESTION["blocks"][0]]}
        key = self.create_card(document)
        with backend.database() as db:
            iui.update(db, key, "session", 0, {"$reply": "我有别的目标"})
        with backend.database() as db:
            result, _ = iui.answer(db, key, "session", 1)
        self.assertIn("我有别的目标", result["content"])

    def test_question_pauses_before_other_tools_in_same_batch(self):
        result = tool_result("write_file", {"path": "danger.txt", "content": "wrong"})
        question = tool_result("render_iui", QUESTION)["choices"][0]["message"]["tool_calls"][0]
        question["id"] = "question"
        result["choices"][0]["message"]["tool_calls"].append(question)
        config = self.config("agent", allow_tools=True, tools=["write_file"])
        with patch.object(backend, "upstream", return_value=result) as model, patch.object(
            backend, "run_file_tool", side_effect=AssertionError("tool ran after question")
        ):
            answer = backend.completion(config, [])
        self.assertIn("[[iui:", answer)
        self.assertEqual(model.call_count, 1)
        self.assertTrue(config["_waiting_for_user"])


if __name__ == "__main__":
    unittest.main()
