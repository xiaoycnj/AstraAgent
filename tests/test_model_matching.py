"""Reference autofill preserves connection identity and explicit model overrides."""

import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import auto_router
import backend
import model_catalog
import model_registry
import model_adapters
import security_core


class ModelMatching(unittest.TestCase):
    def setUp(self):
        self.model = {
            "id": "reference-model",
            "name": "Reference",
            "kind": "chat",
            "context_window": 32768,
            "max_output": 2048,
            "input_price": 1,
            "output_price": 2,
            "currency": "USD",
            "tier": "standard",
            "tool_calling": True,
            "multimodal": False,
            "reasoning": True,
            "reasoning_levels": ["low", "high"],
        }
        self.registry = {
            "providers": [
                {
                    "id": "one",
                    "name": "One",
                    "api": "https://one.example/v1",
                    "protocols": ["chat"],
                    "models": [self.model],
                }
            ]
        }
        self.catalogPatch = patch.object(
            model_registry, "catalog", return_value=self.registry
        )
        self.catalogPatch.start()
        self.addCleanup(self.catalogPatch.stop)

    def provider(self):
        return {
            **backend.DEFAULTS,
            "id": "saved",
            "name": "Saved",
            "base_url": "http://127.0.0.1:9/v1",
            "model": self.model["id"],
            "models": [
                {
                    "id": self.model["id"],
                    "name": "Custom alias",
                    "context_window": None,
                    "input_price": None,
                    "kind": "auto",
                }
            ],
        }

    def test_unique_proxy_reference_never_changes_transport(self):
        provider = self.provider()
        original = copy.deepcopy(provider)
        result = model_registry.lookup(provider, self.model["id"])
        self.assertEqual(result["status"], "matched")
        self.assertEqual(model_registry.match(provider, self.model["id"]), {})
        self.assertEqual(model_catalog.spec(provider)["context_window"], 32768)
        self.assertEqual(provider, original)
        self.assertEqual(
            model_registry.lookup(provider, "REFERENCE-MODEL")["status"], "unknown"
        )

    def test_ambiguous_reference_requires_provider_choice(self):
        other = copy.deepcopy(self.registry["providers"][0])
        other.update(id="two", name="Two", api="https://two.example/v1")
        other["models"][0]["input_price"] = 99
        self.registry["providers"].append(other)
        self.assertEqual(
            model_registry.lookup(self.provider(), self.model["id"])["status"],
            "ambiguous",
        )
        self.assertNotIn("context_window", model_catalog.spec(self.provider()))
        chosen = {**self.provider(), "registry_vendor": "two"}
        self.assertEqual(model_catalog.spec(chosen)["input_price"], 99)
        chosen.update(registry_vendor="auto", base_url="https://one.example/v1")
        self.assertEqual(model_catalog.spec(chosen)["input_price"], 1)

    def test_explicit_zero_false_and_context_override(self):
        provider = self.provider()
        provider["models"][0].update(
            input_price=0, tool_calling=False, context_window=65536, reasoning_levels=[]
        )
        spec = model_catalog.spec(provider)
        self.assertEqual(
            (spec["input_price"], spec["tool_calling"], spec["context_window"]),
            (0, False, 65536),
        )
        self.assertEqual(spec["reasoning_levels"], ["low", "high"])
        self.assertEqual(spec["name"], "Custom alias")

    def test_runtime_caps_output_and_maps_reasoning(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(
            backend, "DATA", Path(folder)
        ):
            backend.initialize()
            security_core.write_config(
                Path(folder) / "providers.json", [self.provider()]
            )
            config = backend.request_config(
                {"provider": "saved", "model": self.model["id"], "reasoning": "max"}
            )
            self.assertEqual(
                (config["max_output_tokens"], config["reasoning"]), (2048, "high")
            )
            self.assertEqual(config["base_url"], self.provider()["base_url"])
            self.assertEqual(config.get("vendor", "auto"), "auto")

    def test_advisory_tier_falls_back_but_user_floor_is_hard(self):
        with tempfile.TemporaryDirectory() as folder:
            request, route = auto_router.resolve(
                Path(folder), [self.provider()], {}, {"content": "全面审查代码"}, None
            )
            self.assertEqual(request["model"], self.model["id"])
            self.assertIn("建议等级", route["reason"])
            with self.assertRaises(ValueError):
                auto_router.resolve(
                    Path(folder),
                    [self.provider()],
                    {},
                    {"content": "你好", "auto_min_tier": "flagship"},
                    None,
                )

    def test_duplicate_model_id_across_providers_is_ranked(self):
        other = self.provider()
        other.update(id="second", name="Second")
        with tempfile.TemporaryDirectory() as folder:
            request, _ = auto_router.resolve(
                Path(folder),
                [self.provider(), other],
                {},
                {"content": "使用 reference-model 回答"},
                None,
            )
            self.assertEqual(request["model"], self.model["id"])

    def test_preview_reports_missing_capability_and_never_calls_judge(self):
        with tempfile.TemporaryDirectory() as folder:
            auto_router.save(
                Path(folder),
                {
                    "mode": "ai",
                    "judge_provider": "saved",
                    "judge_model": self.model["id"],
                },
            )
            result = auto_router.preview(
                Path(folder),
                [self.provider()],
                {},
                {"content": "描述图片", "vision": True},
            )
            self.assertIn("视觉", result["models"][0]["reason"])
            self.assertTrue(result["error"])
            self.assertIsNone(result["route"])

    def test_output_metadata_validates(self):
        self.assertEqual(model_catalog.validate_model(self.model)["max_output"], 2048)
        for value in [0, -1, True, "2048", 10000001]:
            with self.assertRaises(ValueError):
                model_catalog.validate_model({**self.model, "max_output": value})

    def test_reference_prices_keep_their_currency(self):
        self.model["currency"] = "CNY"
        provider = self.provider()
        provider["models"][0]["currency"] = "USD"
        self.assertEqual(model_catalog.spec(provider)["currency"], "CNY")
        provider["models"][0]["input_price"] = 77
        spec = model_catalog.spec(provider)
        self.assertEqual((spec["input_price"], spec["currency"]), (77, "USD"))
        self.assertNotIn("output_price", spec)
        provider["models"][0].update(input_price=None, currency="EUR")
        spec = model_catalog.spec(provider)
        self.assertEqual(spec["currency"], "EUR")
        self.assertNotIn("output_price", spec)

    def test_current_default_provider_stays_scoped(self):
        with tempfile.TemporaryDirectory() as folder:
            request, _ = auto_router.resolve(
                Path(folder),
                [self.provider()],
                self.provider(),
                {"content": "hello", "auto_scope": "current"},
                None,
            )
            self.assertEqual(request["provider"], "")
            result = auto_router.preview(
                Path(folder),
                [self.provider()],
                self.provider(),
                {"content": "hello", "auto_scope": "current"},
            )
            self.assertEqual(result["models"][0]["reason"], "不在当前调度范围")
            self.assertTrue(result["models"][1]["eligible"])

    def test_image_model_mention_does_not_select_it_as_chat(self):
        provider = self.provider()
        provider["models"].append({"id": "image2.5", "name": "Image", "kind": "image"})
        with tempfile.TemporaryDirectory() as folder:
            request, _ = auto_router.resolve(
                Path(folder),
                [provider],
                {},
                {"content": "使用 image2.5 生图", "allow_tools": True},
                None,
            )
            self.assertEqual(request["model"], self.model["id"])
            self.assertIn("image-generation", request["plugins"])

    def test_preview_explicit_selection_matches_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            result = auto_router.preview(
                Path(folder),
                [self.provider()],
                {},
                {"content": "使用 reference-model 回答", "auto_min_tier": "flagship"},
            )
            self.assertTrue(result["models"][0]["eligible"])
            self.assertIn("显式指定", result["models"][0]["reason"])

    def test_non_reasoning_model_omits_unsupported_parameters(self):
        self.model["reasoning"] = False
        with tempfile.TemporaryDirectory() as folder, patch.object(
            backend, "DATA", Path(folder)
        ):
            backend.initialize()
            security_core.write_config(
                Path(folder) / "providers.json", [self.provider()]
            )
            config = backend.request_config({"provider": "saved", "reasoning": "high"})
            self.assertEqual(config["reasoning"], "none")
            payload = model_adapters.prepare(
                config,
                {"model": self.model["id"], "messages": [], "reasoning_effort": "high"},
            )
            self.assertNotIn("reasoning_effort", payload)

    def test_preview_scope_and_legacy_tool_requirement(self):
        other = self.provider()
        other.update(id="second", name="Second")
        self.model["tool_calling"] = False
        with tempfile.TemporaryDirectory() as folder:
            result = auto_router.preview(
                Path(folder),
                [self.provider(), other],
                {},
                {"provider": "saved", "tools": ["calculator"]},
            )
            self.assertEqual(result["models"][0]["reason"], "工具能力未确认")
            self.assertEqual(result["models"][1]["reason"], "不在当前调度范围")


if __name__ == "__main__":
    unittest.main()
