import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import auto_router
import backend
import model_catalog
import model_registry
import security_core
import task_control


class AutoRouting(unittest.TestCase):
    def provider(self):
        models = [
            {
                "id": "basic",
                "name": "Basic",
                "tier": "standard",
                "context_window": 32768,
                "multimodal": False,
                "tool_calling": True,
                "input_price": 1,
                "output_price": 2,
            },
            {
                "id": "vision",
                "name": "Vision",
                "tier": "advanced",
                "context_window": 65536,
                "multimodal": True,
                "tool_calling": True,
                "input_price": 2,
                "output_price": 4,
            },
            {
                "id": "strong",
                "name": "Strong",
                "tier": "flagship",
                "context_window": 131072,
                "multimodal": True,
                "tool_calling": True,
                "input_price": 4,
                "output_price": 8,
            },
        ]
        return {
            **backend.DEFAULTS,
            "id": "fixture",
            "name": "Fixture",
            "base_url": "http://127.0.0.1:9/v1",
            "model": "basic",
            "type": "chat_api",
            "models": models,
        }

    def route(self, body, vision=False, settings=None, result=None):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            if settings:
                auto_router.save(data, settings)
            upstream = lambda *args: result or {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "recommended_tier": "flagship",
                                    "reasoning_effort": "high",
                                }
                            )
                        }
                    }
                ]
            }
            return auto_router.resolve(
                data,
                [self.provider()],
                {},
                {"model": auto_router.AUTO, **body},
                upstream,
                vision,
            )

    def test_rule_routing_floor_and_capabilities(self):
        self.assertEqual(self.route({"content": "你好"})[0]["model"], "basic")
        self.assertEqual(
            self.route({"content": "你好", "auto_min_tier": "flagship"})[0]["model"],
            "strong",
        )
        self.assertEqual(
            self.route({"content": "解释这张图"}, True)[0]["model"], "vision"
        )
        self.assertEqual(self.route({"content": "全面审查代码"})[0]["model"], "strong")

    def test_explicit_model_is_preserved_and_incompatible_model_errors(self):
        self.assertEqual(
            self.route({"content": "使用 basic 回答你好", "auto_min_tier": "flagship"})[
                0
            ]["model"],
            "basic",
        )
        with self.assertRaises(ValueError):
            self.route({"content": "使用 basic 看这张图片"}, True)

    def test_ai_judge_and_visible_fallback(self):
        settings = {"mode": "ai", "judge_provider": "fixture", "judge_model": "basic"}
        self.assertEqual(
            self.route({"content": "Hello"}, settings=settings)[0]["model"], "strong"
        )
        body, route = self.route(
            {"content": "Hello"},
            settings=settings,
            result={"choices": [{"message": {"content": "invalid json"}}]},
        )
        self.assertEqual(body["model"], "basic")
        self.assertIn("规则", route["reason"])

    def test_judge_cannot_bypass_tools_or_vision_filter(self):
        provider = self.provider()
        for model in provider["models"]:
            model["tool_calling"] = False
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
            auto_router.resolve(
                Path(folder),
                [provider],
                {},
                {"content": "Hello", "allow_tools": True},
                lambda *a: None,
            )

    def test_only_configured_providers_are_candidates(self):
        with self.assertRaises(ValueError):
            self.route({"content": "Hello", "provider": "missing"})
        provider = self.provider()
        provider["models"][2]["enabled"] = False
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
            auto_router.resolve(
                Path(folder),
                [provider],
                {},
                {"content": "Hello", "auto_min_tier": "flagship"},
                lambda *a: None,
            )

    def test_image_intent_loads_plugin_without_changing_permission(self):
        body, route = self.route(
            {"content": "生成一张图片", "allow_tools": True, "access_policy": "ask"}
        )
        self.assertIn("image-generation", body["plugins"])
        self.assertEqual(body["access_policy"], "ask")

    def test_backend_resolves_pseudo_model_and_records_trace(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(
            backend, "DATA", Path(folder)
        ):
            backend.initialize()
            security_core.write_config(
                Path(folder) / "providers.json", [self.provider()]
            )
            config = backend.request_config(
                {
                    "model": auto_router.AUTO,
                    "content": "你好",
                    "auto_min_tier": "advanced",
                }
            )
            self.assertEqual(config["model"], "vision")
            self.assertEqual(config["_routing"]["requested_model"], auto_router.AUTO)
            manual = backend.request_config(
                {"provider": "fixture", "model": "basic", "content": "全面审查代码"}
            )
            self.assertEqual(manual["model"], "basic")
            self.assertNotIn("_routing", manual)

    def test_registry_exact_identity_and_user_override(self):
        providers = {row["id"] for row in model_registry.catalog()["providers"]}
        self.assertTrue(
            {
                "openai",
                "anthropic",
                "deepseek",
                "zhipuai",
                "alibaba",
                "moonshotai",
                "minimax",
                "xiaomi",
                "google",
                "longcat",
                "stepfun",
                "volcengine",
            }
            <= providers
        )
        self.assertEqual(
            model_registry.match(
                {"base_url": "https://proxy.invalid/v1"}, "gpt-6-astra"
            ),
            {},
        )
        config = {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-6-astra",
            "models": [{"id": "gpt-6-astra", "input_price": 123, "tier": "standard"}],
        }
        model = model_catalog.spec(config)
        self.assertEqual(model["input_price"], 123)
        self.assertEqual(model["tier"], "standard")
        self.assertGreater(model["context_window"], 1000)
        self.assertEqual(
            model_registry.match(
                {
                    "registry_vendor": "anthropic",
                    "base_url": "https://proxy.invalid/v1",
                    "api_protocol": "responses",
                },
                "claude-opus-5-5",
            ),
            {},
        )

    def test_ai_routing_is_deferred_and_cancel_prevents_execution(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(
            backend, "DATA", Path(folder)
        ):
            data = Path(folder)
            backend.initialize()
            security_core.write_config(data / "providers.json", [self.provider()])
            auto_router.save(
                data,
                {"mode": "ai", "judge_provider": "fixture", "judge_model": "basic"},
            )
            with patch.object(backend, "upstream") as invoke:
                config = backend.request_config(
                    {"model": auto_router.AUTO, "content": "Hello"}
                )
                invoke.assert_not_called()
            token = task_control.Token()
            config["_cancel_token"] = token

            def judge(*args):
                token.cancel()
                return {
                    "choices": [
                        {
                            "message": {
                                "content": '{"recommended_tier":"flagship","reasoning_effort":"high"}'
                            }
                        }
                    ]
                }

            with patch.object(
                backend, "upstream", side_effect=judge
            ) as invoke, self.assertRaises(task_control.Cancelled):
                backend.completion(config, [{"role": "user", "content": "Hello"}])
            self.assertEqual(invoke.call_count, 1)

    def test_provider_never_inherits_other_provider_secret_or_catalog(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(
            backend, "DATA", Path(folder)
        ):
            data = Path(folder)
            backend.initialize()
            security_core.write_config(
                data / "settings.json",
                {
                    **backend.DEFAULTS,
                    "api_key": "private-default",
                    "vendor": "openai",
                    "registry_vendor": "openai",
                    "models": [{"id": "basic", "input_price": 100}],
                },
            )
            security_core.write_config(
                data / "providers.json",
                [
                    {
                        "id": "legacy",
                        "name": "Legacy",
                        "base_url": "http://127.0.0.1:9/v1",
                        "model": "basic",
                    }
                ],
            )
            config = backend.request_config({"provider": "legacy"})
            self.assertEqual(config["api_key"], "")
            self.assertNotIn("models", config)
            self.assertNotIn("registry_vendor", config)

    def test_pending_judge_and_resolved_choice_have_distinct_checkpoints(self):
        import execution_state
        with tempfile.TemporaryDirectory() as folder,patch.object(backend,'DATA',Path(folder)):
            backend.initialize()
            with backend.database() as db:
                db.execute("INSERT INTO sessions(id,title) VALUES('route','Route')")
                db.execute("INSERT INTO runs(id,session_id,status,events) VALUES('run','route','running','[]')")
                db.execute("INSERT INTO stream_requests(id,session_id,hash,run_id,status,input) VALUES('request','route','fixture','run','running','{}')")
                config={**self.provider(),'access_policy':'ask','_routing_deferred':{'body':{}},'tools':[]}
                execution_state.create(db,'request','route',{'model':auto_router.AUTO,'auto_min_tier':'advanced'},config)
            state=execution_state.State(backend.database,'request')
            try:
                pending=json.loads(state.db.execute("SELECT options FROM executions WHERE request_id='request'").fetchone()['options'])
                self.assertEqual(pending['model'],auto_router.AUTO);self.assertEqual(pending['provider'],'')
                self.assertEqual(pending['auto_min_tier'],'advanced')
                config.update(model='strong',reasoning='high',runtime_plugins=[],_routing={'resolved_model':'strong'})
                state.resolve_model(config)
                done=json.loads(state.db.execute("SELECT options FROM executions WHERE request_id='request'").fetchone()['options'])
                self.assertEqual(done['model'],'strong');self.assertEqual(done['_auto_route']['resolved_model'],'strong')
            finally:state.close()
