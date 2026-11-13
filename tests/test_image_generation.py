"""Image API integration and its actual agent authorization boundary."""

import base64, json, sys, tempfile, threading, unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend, attachments, security_core, task_control
from modules import image_generation, catalog

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII="
)


class ImageAPI(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        raw_body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.headers.get_content_type() == "multipart/form-data":
            from email.parser import BytesParser
            from email.policy import default

            document = BytesParser(policy=default).parsebytes(
                ("Content-Type: " + self.headers["Content-Type"] + "\r\n\r\n").encode()
                + raw_body
            )
            body = {
                part.get_param("name", header="content-disposition"): (
                    part.get_payload(decode=True)
                    if part.get_filename()
                    else part.get_payload(decode=True).decode()
                )
                for part in document.iter_parts()
            }
        else:
            body = json.loads(raw_body)
        self.calls.append((self.path, body, self.headers.get("Authorization")))
        raw = json.dumps(
            {"data": [{"b64_json": base64.b64encode(PNG).decode()}]}
        ).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class ImageGeneration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name).resolve()
        self.old = backend.DATA
        backend.DATA = self.data
        backend.initialize()
        ImageAPI.calls = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ImageAPI)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.provider = {
            "id": "image-fixture",
            "name": "Fixture",
            "type": "image_api",
            "base_url": "http://127.0.0.1:" + str(self.server.server_port) + "/v1",
            "api_key": "fixture-only",
            "model": "gpt-image-1",
            "timeout": 10,
        }
        security_core.write_config(self.data / "providers.json", [self.provider])
        with backend.database() as db:
            db.execute("INSERT INTO sessions(id,title) VALUES('image','Image')")

    def tearDown(self):
        backend.DATA = self.old
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def config(self):
        return {
            "model": "mock",
            "tools": ["generate_image"],
            "access_policy": "ask",
            "_session_id": "image",
        }

    def replies(self):
        return [
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "image-call",
                                    "function": {
                                        "name": "generate_image",
                                        "arguments": '{"prompt":"A small blue star"}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
            {"choices": [{"message": {"content": "完成"}}]},
        ]

    def test_agent_approval_real_request_and_durable_output(self):
        events = []
        with patch.object(
            backend, "stream_upstream", side_effect=self.replies()
        ), patch.object(backend, "approve_tool", return_value=True) as approve:
            self.assertEqual(
                backend.completion(
                    self.config(),
                    [{"role": "user", "content": "画星星"}],
                    events.append,
                ),
                "完成",
            )
        self.assertEqual(approve.call_count, 1)
        self.assertEqual(ImageAPI.calls[0][0], "/v1/images/generations")
        self.assertEqual(ImageAPI.calls[0][2], "Bearer fixture-only")
        self.assertNotIn("response_format", ImageAPI.calls[0][1])
        item = next(
            e["result"]["attachment"] for e in events if e["type"] == "image_generated"
        )
        self.assertEqual(item["kind"], "image")
        self.assertEqual(
            (attachments.location(self.data, item["id"]) / "content").read_bytes(), PNG
        )
        with backend.database() as db:
            self.assertEqual(
                attachments.resources(db, self.data, "image")["outputs"][0]["id"],
                item["id"],
            )
        self.assertNotIn("fixture-only", (self.data / "providers.json").read_text())

    def test_denied_tool_never_calls_image_api(self):
        with patch.object(
            backend, "stream_upstream", side_effect=self.replies()
        ), patch.object(backend, "approve_tool", return_value=False):
            backend.completion(
                self.config(), [{"role": "user", "content": "拒绝"}], lambda e: None
            )
        self.assertEqual(ImageAPI.calls, [])
        with backend.database() as db:
            self.assertEqual(
                db.execute("SELECT COUNT(*) FROM session_outputs").fetchone()[0], 0
            )

    def test_cancel_after_network_result_does_not_store(self):
        token = task_control.Token()
        config = self.config()
        config["_cancel_token"] = token

        def result(*args):
            token.cancel()
            return PNG

        with patch.object(
            image_generation, "request_image", side_effect=result
        ), self.assertRaises(task_control.Cancelled):
            image_generation.execute(
                {"prompt": "x"},
                config,
                {
                    "data": self.data,
                    "providers": backend.profiles,
                    "database": backend.database,
                },
            )
        self.assertFalse(list((self.data / "attachments").glob("**/content")))

    def test_provider_type_validation_and_chat_rejection(self):
        with self.assertRaises(backend.ApiError):
            backend.request_config({"provider": "image-fixture"})
        value = backend.validate_config(
            {
                **self.provider,
                "base_url": self.provider["base_url"] + "/images/generations",
            },
            backend.DEFAULTS,
        )
        self.assertEqual(value["base_url"], self.provider["base_url"])
        with self.assertRaises(backend.ApiError):
            backend.validate_config({"type": "unknown"}, backend.DEFAULTS)

    def test_invalid_credentials_never_reach_tool_output(self):
        provider = {**self.provider, "api_key": "private-fixture\ninvalid"}
        with self.assertRaises(ValueError) as caught:
            image_generation.request_image(provider, {"prompt": "x"}, {})
        self.assertNotIn("private-fixture", str(caught.exception))
        self.assertEqual(ImageAPI.calls, [])

    def test_disabled_image_module_blocks_before_api(self):
        catalog.set_enabled(self.data, "image-generation", False)
        with self.assertRaises(ValueError):
            catalog.execute(
                "generate_image",
                {"prompt": "x"},
                {},
                {
                    "data": self.data,
                    "providers": backend.profiles,
                    "database": backend.database,
                },
            )
        self.assertEqual(ImageAPI.calls, [])

    def test_modules_keep_core_behavior(self):
        self.assertEqual(
            catalog.execute("calculator", {"expression": "(2+3)*4"}, {}, {}),
            {"result": 20},
        )
        self.assertEqual(
            len({d["function"]["name"] for d in backend.TOOL_DEFS}),
            len(backend.TOOL_DEFS),
        )

    def test_reference_image_and_selected_model_use_multipart_edits(self):
        item = attachments.upload(
            self.data, {"name": "reference.png", "data": base64.b64encode(PNG).decode()}
        )
        provider = {
            **self.provider,
            "models": [
                {
                    "id": "image2.5",
                    "name": "Image 2.5",
                    "kind": "image",
                    "multimodal": True,
                }
            ],
        }
        security_core.write_config(self.data / "providers.json", [provider])
        config = self.config()
        config["_attachment_ids"] = [item["id"]]
        arguments = {
            "prompt": "Refined prompt",
            "model": "image2.5",
            "size": "1024*1024",
            "file": item["id"],
            "quality": "high",
        }
        replies = self.replies()
        replies[0]["choices"][0]["message"]["tool_calls"][0]["function"] = {
            "name": "image_gen",
            "arguments": json.dumps(arguments),
        }
        with patch.object(
            backend, "stream_upstream", side_effect=replies
        ), patch.object(backend, "approve_tool", return_value=True):
            self.assertEqual(
                backend.completion(
                    {**config, "tools": ["image_gen"]},
                    [
                        {
                            "role": "user",
                            "content": attachments.assemble(
                                self.data, "Draw", [item["id"]]
                            ),
                        }
                    ],
                    lambda e: None,
                ),
                "完成",
            )
        path, body, key = ImageAPI.calls[0]
        self.assertEqual(path, "/v1/images/edits")
        self.assertEqual(body["image"], PNG)
        self.assertEqual(body["model"], "image2.5")
        self.assertEqual(body["prompt"], "Refined prompt")
        self.assertEqual(body["size"], "1024x1024")
        self.assertEqual(body["quality"], "high")

    def test_reference_from_other_session_never_reaches_network(self):
        item = attachments.upload(
            self.data, {"name": "private.png", "data": base64.b64encode(PNG).decode()}
        )
        for value in (item["id"], "C:/secret.png", "https://example.org/image.png"):
            with self.assertRaises(ValueError):
                image_generation.execute(
                    {"prompt": "x", "file": value},
                    self.config(),
                    {
                        "data": self.data,
                        "providers": backend.profiles,
                        "database": backend.database,
                    },
                )
        self.assertEqual(ImageAPI.calls, [])

    def test_image_model_discovery_hides_credentials(self):
        result = catalog.execute(
            "list_image_models",
            {},
            self.config(),
            {
                "data": self.data,
                "providers": backend.profiles,
                "database": backend.database,
            },
        )
        self.assertEqual(result["providers"][0]["id"], self.provider["id"])
        self.assertNotIn("api_key", json.dumps(result))
        self.assertEqual(ImageAPI.calls, [])


if __name__ == "__main__":
    unittest.main()
