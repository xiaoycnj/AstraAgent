import copy
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import anthropic_messages as claude
import model_adapters as adapters
import openai_responses
import usage_meter
import backend


class AdapterTests(unittest.TestCase):
    def config(self, vendor="deepseek", model="deepseek-flash", **extra):
        return {
            "vendor": vendor,
            "model": model,
            "reasoning": "high",
            "api_key": "fixture",
            "base_url": "https://api.example/v1",
            "timeout": 10,
            **extra,
        }

    def payload(self):
        return {
            "model": "fixture",
            "messages": [
                {"role": "system", "content": "Stable prefix"},
                {"role": "user", "content": "Hello"},
            ],
        }

    def test_auto_detection_never_guesses_from_model_name(self):
        self.assertEqual(adapters.vendor({"auth_type": "openai_oauth"}), "openai")
        self.assertEqual(
            adapters.vendor(
                {"base_url": "https://proxy.example/v1", "model": "claude-opus-5"}
            ),
            "generic",
        )
        self.assertEqual(
            adapters.vendor({"base_url": "https://api.deepseek.com/v1"}), "deepseek"
        )

    def test_deepseek_mapping_and_disabled_effort(self):
        for effort, expected in [
            ("minimal", "low"),
            ("medium", "high"),
            ("xhigh", "high"),
            ("max", "max"),
        ]:
            value = adapters.prepare(self.config(reasoning=effort), self.payload())
            self.assertEqual(value["reasoning_effort"], expected)
        value = adapters.prepare(self.config(reasoning="none"), self.payload())
        self.assertEqual(value["thinking"]["type"], "disabled")
        self.assertNotIn("reasoning_effort", value)

    def test_glm_versions_have_distinct_contracts(self):
        value = adapters.prepare(
            self.config("glm", "glm-5.3", reasoning="none"), self.payload()
        )
        self.assertEqual(value["thinking"]["type"], "enabled")
        self.assertEqual(value["reasoning_effort"], "low")
        value = adapters.prepare(self.config("glm", "glm-4.7"), self.payload())
        self.assertNotIn("reasoning_effort", value)
        value = adapters.prepare(
            self.config("glm", "glm-5.2", reasoning="minimal"), self.payload()
        )
        self.assertEqual(value["thinking"]["type"], "disabled")

    def test_prepare_does_not_mutate_prefix_or_tools(self):
        value = self.payload()
        value["tools"] = [
            {
                "type": "function",
                "function": {"name": "test", "parameters": {"type": "object"}},
            }
        ]
        before = copy.deepcopy(value)
        adapters.prepare(self.config(), value)
        self.assertEqual(value, before)

    def test_openai_cache_key_stable_and_scoped(self):
        config = self.config("openai", "gpt-6", reasoning="max")
        a = adapters.prepare(config, self.payload())
        changed = self.payload()
        changed["messages"][-1]["content"] = "Next question"
        b = adapters.prepare(config, changed)
        self.assertEqual(a["prompt_cache_key"], b["prompt_cache_key"])
        self.assertEqual(a["reasoning_effort"], "max")
        self.assertNotEqual(
            a["prompt_cache_key"],
            adapters.prepare({**config, "model": "gpt-6-mini"}, changed)[
                "prompt_cache_key"
            ],
        )
        self.assertNotIn(
            "prompt_cache_key",
            adapters.prepare({**config, "cache_mode": "off"}, changed),
        )

    def test_openai_nonreasoning_models_omit_effort(self):
        for model in ("gpt-6-sol", "gpt-6-luna"):
            self.assertEqual(
                adapters.prepare(
                    self.config("openai", model, reasoning="none"), self.payload()
                )["reasoning_effort"],
                "none",
            )
        self.assertNotIn(
            "reasoning_effort",
            adapters.prepare(self.config("openai", "gpt-4o"), self.payload()),
        )
        self.assertEqual(
            adapters.prepare(
                self.config("openai", "o3", reasoning="max"), self.payload()
            )["reasoning_effort"],
            "high",
        )

    def test_reasoning_is_retained_for_tool_turns(self):
        message = adapters.assistant_message(
            {"content": "", "reasoning_content": "provider fixture", "tool_calls": []}
        )
        self.assertEqual(message["reasoning_content"], "provider fixture")
        value = self.payload()
        value["messages"].append(message)
        self.assertEqual(
            adapters.prepare(self.config(), value)["messages"][-1]["reasoning_content"],
            "provider fixture",
        )

    def test_claude_conversion_preserves_signed_blocks(self):
        blocks = [
            {"type": "thinking", "thinking": "fixture", "signature": "signed"},
            {"type": "tool_use", "id": "tool1", "name": "test", "input": {}},
        ]
        payload = self.payload()
        payload["model"] = "claude-sonnet-4-6"
        payload["messages"] += [
            {"role": "assistant", "content": "", "_anthropic_content": blocks},
            {"role": "tool", "tool_call_id": "tool1", "content": "result"},
        ]
        value = claude.payload_for(
            self.config("anthropic", "claude-sonnet-4-6", cache_mode="1h"), payload
        )
        self.assertEqual(value["thinking"]["type"], "adaptive")
        self.assertEqual(value["system"][-1]["cache_control"]["ttl"], "1h")
        self.assertEqual(value["messages"][1]["content"], blocks)
        self.assertEqual(value["messages"][2]["content"][0]["type"], "tool_result")

    def test_claude_legacy_budget_is_bounded(self):
        value = claude.payload_for(
            self.config(
                "anthropic",
                "claude-sonnet-4-5",
                reasoning="max",
                max_output_tokens=8192,
            ),
            self.payload(),
        )
        self.assertLess(value["thinking"]["budget_tokens"], value["max_tokens"])

    def test_anthropic_usage_includes_reads_and_writes(self):
        self.assertEqual(
            usage_meter.counts(
                {
                    "input_tokens": 10,
                    "cache_read_input_tokens": 80,
                    "cache_creation_input_tokens": 20,
                    "output_tokens": 5,
                }
            ),
            (110, 5, 115, 80),
        )

    def test_provider_state_is_encrypted_and_identity_scoped(self):
        with tempfile.TemporaryDirectory() as folder:
            db = sqlite3.connect(":memory:")
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY)")
            db.execute("INSERT INTO messages VALUES(1)")
            adapters.initialize(db)
            config = self.config()
            config["_last_provider_message"] = {
                "content": "answer",
                "reasoning_content": "fixture private thinking",
            }
            adapters.save_state(db, config, 1)
            self.assertNotIn(
                b"fixture private thinking",
                db.execute("SELECT payload FROM provider_message_state").fetchone()[0],
            )
            config["_context_history"] = {"ids": [1], "roles": ["assistant"]}
            messages = [
                {"role": "assistant", "content": "answer"},
                {"role": "user", "content": "next"},
            ]
            adapters.hydrate(db, config, messages)
            self.assertEqual(
                messages[0]["reasoning_content"], "fixture private thinking"
            )
            alternate = copy.deepcopy(config)
            alternate["api_key"] = "different fixture"
            messages = [
                {"role": "assistant", "content": "answer"},
                {"role": "user", "content": "next"},
            ]
            adapters.hydrate(db, alternate, messages)
            self.assertNotIn("reasoning_content", messages[0])
            edited = [
                {"role": "assistant", "content": "edited answer"},
                {"role": "user", "content": "next"},
            ]
            adapters.hydrate(db, config, edited)
            self.assertNotIn("reasoning_content", edited[0])
            config["_last_provider_message"]["tool_calls"] = [{"id": "unfinished"}]
            adapters.save_state(db, config, 1)
            self.assertIsNone(
                db.execute("SELECT payload FROM provider_message_state").fetchone()
            )
            db.close()

    def test_validation_rejects_unbounded_budget(self):
        with self.assertRaises(ValueError):
            adapters.validate({"thinking_mode": "budget", "thinking_budget": 16384}, {})
        with self.assertRaises(ValueError):
            adapters.validate({"vendor": "arbitrary-code"}, {})

    def test_claude_stream_handles_tool_json_signatures_and_usage(self):
        events = [
            {
                "type": "message_start",
                "message": {"usage": {"input_tokens": 4, "cache_read_input_tokens": 8}},
            },
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "thinking", "thinking": "", "signature": ""},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "fixture"},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "signature_delta", "signature": "signature"},
            },
            {
                "type": "content_block_start",
                "index": 1,
                "content_block": {
                    "type": "tool_use",
                    "id": "t",
                    "name": "test",
                    "input": {},
                },
            },
            {
                "type": "content_block_delta",
                "index": 1,
                "delta": {"type": "input_json_delta", "partial_json": '{"a":1}'},
            },
            {"type": "message_delta", "usage": {"output_tokens": 5}},
            {"type": "message_stop"},
        ]
        raw = "".join(
            "data: " + json.dumps(event) + "\n\n" for event in events
        ).encode()
        config = self.config("anthropic", "claude-sonnet-4-6")
        payload = self.payload()
        with patch.object(claude.security_net, "opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(raw)
            value = claude.call(
                config, "/chat/completions", payload, lambda event: None
            )
        self.assertEqual(
            value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
            '{"a": 1}',
        )
        self.assertEqual(
            value["choices"][0]["message"]["_anthropic_content"][0]["signature"],
            "signature",
        )
        self.assertEqual(value["usage"]["output_tokens"], 5)
        with patch.object(claude.security_net, "opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(
                raw[: raw.rfind(b"data:")]
            )
            with self.assertRaises(ValueError):
                claude.call(config, "/chat/completions", payload, lambda event: None)

    def test_gpt_51_and_52_effort_subsets(self):
        for model, effort, expected in [
            ("gpt-5.1", "none", "none"),
            ("gpt-5.1", "minimal", "none"),
            ("gpt-5.2", "minimal", "low"),
            ("gpt-5.2", "max", "xhigh"),
            ("gpt-5", "none", "minimal"),
        ]:
            self.assertEqual(
                adapters.prepare(
                    self.config("openai", model, reasoning=effort), self.payload()
                )["reasoning_effort"],
                expected,
            )

    def test_always_thinking_models_map_none_to_low(self):
        payload = self.payload()
        payload["model"] = "claude-opus-5-5"
        value = claude.payload_for(
            self.config(
                "anthropic", "claude-opus-5-5", reasoning="none", thinking_mode="budget"
            ),
            payload,
        )
        self.assertEqual(value["thinking"]["type"], "adaptive")
        self.assertEqual(value["output_config"]["effort"], "low")
        self.assertEqual(
            adapters.prepare(
                self.config("openai", "gpt-6-astra", reasoning="none"), self.payload()
            )["reasoning_effort"],
            "low",
        )

    def test_native_claude_http_tool_roundtrip_uses_existing_permission_loop(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import runtime_engine, security_core, local_account

        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                requests.append(
                    {
                        "path": self.path,
                        "key": self.headers.get("x-api-key"),
                        "body": json.loads(
                            self.rfile.read(int(self.headers["Content-Length"]))
                        ),
                    }
                )
                if len(requests) == 1:
                    blocks = [
                        {
                            "type": "thinking",
                            "thinking": "fixture",
                            "signature": "signed-fixture",
                        },
                        {
                            "type": "tool_use",
                            "id": "calculate",
                            "name": "calculator",
                            "input": {"expression": "8*8"},
                        },
                    ]
                else:
                    blocks = [{"type": "text", "text": "64"}]
                events = [
                    {
                        "type": "message_start",
                        "message": {
                            "usage": {"input_tokens": 5, "cache_read_input_tokens": 10}
                        },
                    }
                ]
                events += [
                    {"type": "content_block_start", "index": i, "content_block": block}
                    for i, block in enumerate(blocks)
                ]
                events += [
                    {"type": "message_delta", "usage": {"output_tokens": 3}},
                    {"type": "message_stop"},
                ]
                raw = "".join(
                    "data: " + json.dumps(event) + "\n\n" for event in events
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "data"
            skill = root / "skills/general"
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text("# General\nHelp")
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                with patch.object(backend, "ROOT", root), patch.object(
                    backend, "DATA", data
                ):
                    backend.initialize()
                    local_account.save_profile(
                        data, {"inject_profile": False, "use_memory": False}
                    )
                    security_core.write_config(
                        data / "settings.json",
                        self.config(
                            "anthropic",
                            "claude-sonnet-4-6",
                            base_url="http://127.0.0.1:"
                            + str(server.server_port)
                            + "/v1",
                        ),
                    )
                    runtime_engine.save_settings(data, {"access_policy": "full"})
                    config = backend.request_config(
                        {"allow_tools": True, "reasoning": "high"}
                    )
                    answer = backend.completion(
                        config,
                        [{"role": "user", "content": "Calculate"}],
                        lambda event: None,
                    )
                    self.assertEqual(answer, "64")
            finally:
                server.shutdown()
                server.server_close()
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0]["path"], "/v1/messages")
        self.assertEqual(requests[0]["key"], "fixture")
        self.assertEqual(
            requests[1]["body"]["messages"][1]["content"][0]["signature"],
            "signed-fixture",
        )
        self.assertEqual(
            requests[1]["body"]["messages"][2]["content"][0]["tool_use_id"], "calculate"
        )

    def test_api_key_responses_keeps_opaque_reasoning_and_cache_settings(self):
        output = [
            {
                "type": "reasoning",
                "id": "r1",
                "encrypted_content": "fixture-encrypted",
                "summary": [],
            },
            {
                "type": "message",
                "id": "m1",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Answer"}],
            },
        ]
        event = {
            "type": "response.completed",
            "response": {
                "status": "completed",
                "output": output,
                "usage": {
                    "input_tokens": 20,
                    "output_tokens": 3,
                    "input_tokens_details": {"cached_tokens": 10},
                },
            },
        }
        stream = io.BytesIO(("data: " + json.dumps(event) + "\n\n").encode())
        config = self.config(
            "openai",
            "gpt-6-astra",
            api_protocol="responses",
            reasoning="max",
            verbosity="low",
        )
        payload = self.payload()
        payload["model"] = config["model"]
        with patch.object(openai_responses.security_net, "opener") as transport:
            transport.return_value.open.return_value = stream
            result = openai_responses.call(
                Path("."), config, "/chat/completions", payload
            )
            request = transport.return_value.open.call_args.args[0]
        body = json.loads(request.data)
        self.assertEqual(request.full_url, "https://api.example/v1/responses")
        self.assertEqual(request.get_header("Authorization"), "Bearer fixture")
        self.assertEqual(body["reasoning"]["effort"], "max")
        self.assertEqual(body["prompt_cache_options"], {"mode": "implicit"})
        self.assertEqual(body["text"], {"verbosity": "low"})
        self.assertFalse(body["store"])
        self.assertEqual(result["choices"][0]["message"]["_response_items"], output)
        followup = openai_responses.payload_for(
            {
                "model": config["model"],
                "messages": [
                    adapters.assistant_message(result["choices"][0]["message"]),
                    {"role": "user", "content": "Next"},
                ],
            }
        )
        self.assertEqual(followup["input"][:2], output)

    def test_gpt6_tools_route_to_responses_and_keep_opaque_items(self):
        config = self.config("openai", "gpt-6.1-sol", api_protocol="chat")
        payload = self.payload()
        payload["tools"] = [
            {
                "type": "function",
                "function": {"name": "test", "parameters": {"type": "object"}},
            }
        ]
        payload["messages"].append(
            {
                "role": "assistant",
                "content": "Answer",
                "_response_items": [
                    {"type": "reasoning", "encrypted_content": "fixture"}
                ],
            }
        )
        self.assertTrue(adapters.use_responses(config, payload))
        self.assertIn(
            "_response_items", adapters.prepare(config, payload)["messages"][-1]
        )
        with patch.object(
            backend.openai_responses, "call", return_value={"choices": []}
        ) as invoke:
            backend._upstream(config, "/chat/completions", payload)
            invoke.assert_called_once()
        self.assertFalse(
            adapters.use_responses({**config, "vendor": "generic"}, payload)
        )
