from pathlib import Path
import tempfile
import unittest
import backend
import model_catalog
import runtime_engine
import usage_meter


class MediaModels(unittest.TestCase):
    def config(self, **extra):
        return {
            "model": "fixture",
            "models": [
                {
                    "id": "fixture",
                    "name": "Fixture",
                    "context_window": 4096,
                    "input_price": 2,
                    "output_price": 8,
                    "cached_input_price": 0.5,
                    "currency": "USD",
                }
            ],
            **extra,
        }

    def test_provider_categories_and_metadata_validation(self):
        for kind in ("image_api", "video_api", "multimodal_api"):
            result = backend.validate_config(
                {
                    "type": kind,
                    "models": [
                        {
                            "id": "fixture",
                            "name": "Fixture",
                            "context_window": 8192,
                            "input_price": 0,
                            "output_price": 3,
                            "multimodal": True,
                        }
                    ],
                },
                backend.DEFAULTS,
            )
            self.assertEqual(result["models"][0]["context_window"], 8192)
            self.assertEqual(result["models"][0]["input_price"], 0)
            self.assertEqual(result["capabilities"], list(model_catalog.TYPES[kind]))
        for invalid in (True, -1, float("nan"), float("inf"), "2"):
            with self.assertRaises(ValueError):
                model_catalog.validate_model({"id": "x", "input_price": invalid})

    def test_selected_model_controls_context_and_legacy_fallback(self):
        messages = [{"role": "user", "content": "x" * 9000}]
        self.assertTrue(
            model_catalog.needs_compaction(self.config(context_chars=200000), messages)
        )
        self.assertFalse(
            model_catalog.needs_compaction({"context_chars": 200000}, messages)
        )
        other = self.config(model="unconfigured", context_chars=200000)
        self.assertFalse(model_catalog.needs_compaction(other, messages))
        image = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "hello"},
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64," + "A" * 100000},
                    },
                ],
            }
        ]
        self.assertLess(model_catalog.estimate_tokens(image), 2000)

    def test_context_compaction_uses_model_window(self):
        messages = [{"role": "system", "content": "system"}] + [
            {"role": "user" if i % 2 == 0 else "assistant", "content": "x" * 1800}
            for i in range(10)
        ]
        payload = {"messages": messages}
        config = self.config(
            auto_compact=True, context_chars=200000, max_output_tokens=1024
        )
        calls = []

        def upstream(*args):
            calls.append(args)
            return {"choices": [{"message": {"content": "checkpoint"}}]}

        runtime_engine.compact_payload(config, payload, upstream, None)
        self.assertTrue(calls)
        self.assertLess(len(payload["messages"]), len(messages))

    def test_costs_snapshot_prices_and_separate_currencies(self):
        estimate = model_catalog.cost(self.config(), 1000, 100, 400)
        self.assertAlmostEqual(estimate["amount"], 0.0022)
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            usage = {
                "input_tokens": 1000,
                "output_tokens": 100,
                "input_tokens_details": {"cached_tokens": 400},
            }
            usage_meter.record(
                data,
                "a",
                "fixture",
                "api_key",
                "completed",
                usage,
                config=self.config(),
            )
            alternative = self.config()
            alternative["models"][0]["currency"] = "CNY"
            usage_meter.record(
                data, "b", "fixture", "api_key", "completed", usage, config=alternative
            )
            usage_meter.record(data, "unknown", "fixture", "api_key", "completed", None)
            value = usage_meter.activity(data)
            self.assertEqual(
                {row["currency"] for row in value["costs"]}, {"USD", "CNY"}
            )
            self.assertEqual(value["unpriced_calls"], 1)
        self.assertIsNone(model_catalog.cost({}, 100, 100))

    def test_multimodal_service_can_chat_and_uses_selected_output_budget(self):
        import security_core
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as folder, patch.object(
            backend, "DATA", Path(folder)
        ):
            backend.initialize()
            provider = {
                **backend.DEFAULTS,
                **self.config(),
                "id": "media",
                "name": "Media",
                "type": "multimodal_api",
                "capabilities": ["chat", "image"],
                "base_url": "http://127.0.0.1:9/v1",
            }
            security_core.write_config(Path(folder) / "providers.json", [provider])
            config = backend.request_config({"provider": "media"})
            self.assertEqual(config["max_output_tokens"], 1024)
            self.assertTrue(model_catalog.supports(provider, "image"))

    def test_text_only_model_receives_reference_ids_without_image_bytes(self):
        from unittest.mock import patch

        config = self.config()
        config["models"][0]["multimodal"] = False
        content = [
            {"type": "text", "text": "Reference attachment abc123"},
            {
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64,PRIVATEIMAGE"},
            },
        ]
        payloads = []

        def upstream(c, endpoint, payload):
            payloads.append(payload)
            return {"choices": [{"message": {"content": "Done"}}]}

        with patch.object(backend, "upstream", side_effect=upstream), patch.object(
            backend.local_account, "context", return_value=""
        ), patch.object(
            backend.local_account, "profile", return_value={"use_memory": False}
        ):
            self.assertEqual(
                backend.completion(config, [{"role": "user", "content": content}]),
                "Done",
            )
        self.assertNotIn("PRIVATEIMAGE", str(payloads))
        self.assertIn("abc123", str(payloads))
