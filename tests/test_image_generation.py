"""Image API integration and its actual agent authorization boundary."""

import base64, json, sys, tempfile, threading, unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend, attachments, security_core, task_control
from modules import image_generation, image_requests, catalog

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
            self.assertRegex(
                backend.completion(
                    self.config(),
                    [{"role": "user", "content": "画星星"}],
                    events.append,
                ),
                r"完成\s+!\[生成的图片\]\(/api/attachments/[a-f0-9]{32}/content\)",
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
            self.assertRegex(
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
                r"完成\s+!\[生成的图片\]",
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

    def test_seedream_reference_is_json_generation_without_n(self):
        provider = {**self.provider, 'model': 'doubao-seedream-4-5-251128'}
        raw = image_generation.request_image(provider, {'prompt': '星星', 'size': '2k', 'watermark': False}, {}, [('image/png', PNG)])
        self.assertEqual(raw, PNG)
        path, body, auth = ImageAPI.calls[-1]
        self.assertEqual(path, '/v1/images/generations')
        self.assertEqual(body['image'], 'data:image/png;base64,' + base64.b64encode(PNG).decode())
        self.assertEqual(body['size'], '2K')
        self.assertFalse(body['watermark'])
        self.assertNotIn('n', body)
        self.assertEqual(body['sequential_image_generation'], 'disabled')

    def test_gpt_image_edit_uses_json_image_references(self):
        provider = {**self.provider, 'model': 'gpt-image-2'}
        image_generation.request_image(provider, {'prompt': '星星', 'size': '1536*864', 'background': 'transparent'}, {}, [('image/png', PNG)])
        path, body, auth = ImageAPI.calls[-1]
        self.assertEqual(path, '/v1/images/edits')
        self.assertTrue(body['images'][0]['image_url'].startswith('data:image/png;base64,'))
        self.assertEqual(body['output_format'], 'png')
        self.assertNotIn('response_format', body)

    def test_actual_pixels_are_sent_after_all_tool_results(self):
        replies = self.replies()
        second = json.loads(json.dumps(replies[0]['choices'][0]['message']['tool_calls'][0]))
        second['id'] = 'image-second'
        second['function']['arguments'] = '{"prompt":"A second star"}'
        replies[0]['choices'][0]['message']['tool_calls'].append(second)
        captured = []
        def upstream(config, payload, emit):
            captured.append(json.loads(json.dumps(payload)))
            return replies.pop(0)
        config = {**self.config(), 'models': [{'id': 'mock', 'multimodal': True}]}
        with patch.object(backend, 'stream_upstream', side_effect=upstream), patch.object(backend, 'approve_tool', return_value=True):
            answer = backend.completion(config, [{'role': 'user', 'content': '画两张星星'}], lambda e: None)
        messages = captured[-1]['messages']
        self.assertEqual([message['role'] for message in messages[-3:]], ['tool', 'tool', 'user'])
        images = [part for part in messages[-1]['content'] if part['type'] == 'image_url']
        self.assertEqual(len(images), 2)
        for part in images:
            self.assertEqual(base64.b64decode(part['image_url']['url'].split(',', 1)[1]), PNG)
        self.assertEqual(answer.count('![生成的图片]'), 2)

    def test_text_only_model_receives_honest_visual_status(self):
        replies = self.replies()
        captured = []
        def upstream(config, payload, emit):
            captured.append(json.loads(json.dumps(payload)))
            return replies.pop(0)
        with patch.object(backend, 'stream_upstream', side_effect=upstream), patch.object(backend, 'approve_tool', return_value=True):
            backend.completion({**self.config(), 'models': [{'id': 'mock', 'multimodal': False}]}, [{'role': 'user', 'content': '画图'}], lambda e: None)
        self.assertIn('尚未视觉检查', captured[-1]['messages'][-1]['content'])
        self.assertNotIn('data:image/', json.dumps(captured[-1]))

    def test_delivered_file_has_download_and_durable_session_output(self):
        replies = self.replies()
        call = replies[0]['choices'][0]['message']['tool_calls'][0]
        call['function'] = {'name': 'write_file', 'arguments': json.dumps({'path': 'demo/pelican.html', 'content': '<!doctype html><h1>鹈鹕</h1>', 'deliver': True})}
        events = []
        with patch.object(backend, 'stream_upstream', side_effect=replies), patch.object(backend, 'approve_tool', return_value=True):
            answer = backend.completion({**self.config(), 'tools': ['write_file'], 'file_permission': 'all'}, [{'role': 'user', 'content': '直接给我 HTML 文件'}], events.append)
        item = next(event['result']['attachment'] for event in events if event['type'] == 'file_generated')
        self.assertEqual(item['name'], 'pelican.html')
        self.assertIn('[下载文件](/api/attachments/' + item['id'] + '/content)', answer)
        self.assertEqual((attachments.location(self.data, item['id']) / 'content').read_text(encoding='utf-8'), '<!doctype html><h1>鹈鹕</h1>')
        with backend.database() as db:
            self.assertEqual(attachments.resources(db, self.data, 'image')['outputs'][0]['id'], item['id'])

    def test_delivery_does_not_bypass_write_denial_or_path_boundary(self):
        for path, approved in [('demo.html', False), ('../escape.html', True)]:
            replies = self.replies()
            replies[0]['choices'][0]['message']['tool_calls'][0]['function'] = {'name': 'write_file', 'arguments': json.dumps({'path': path, 'content': 'test', 'deliver': True})}
            with patch.object(backend, 'stream_upstream', side_effect=replies), patch.object(backend, 'approve_tool', return_value=approved):
                backend.completion({**self.config(), 'tools': ['write_file'], 'file_permission': 'all'}, [{'role': 'user', 'content': 'x'}], lambda e: None)
        with backend.database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM session_outputs').fetchone()[0], 0)
        self.assertFalse((self.data / 'escape.html').exists())

    def test_generated_attachment_can_be_used_for_next_edit(self):
        turn = 0
        def upstream(config, payload, emit):
            nonlocal turn
            turn += 1
            if turn == 1:
                return self.replies()[0]
            if turn == 2:
                tool = next(message for message in reversed(payload['messages']) if message['role'] == 'tool')
                output = json.loads(tool['content'])
                return {'choices': [{'message': {'tool_calls': [{'id': 'edit-call', 'function': {'name': 'generate_image', 'arguments': json.dumps({'prompt': 'Make it larger', 'file': output['attachment']['id']})}}]}}]}
            return self.replies()[1]
        with patch.object(backend, 'stream_upstream', side_effect=upstream), patch.object(backend, 'approve_tool', return_value=True):
            backend.completion({**self.config(), 'models': [{'id': 'mock', 'multimodal': True}]}, [{'role': 'user', 'content': '画完检查并改进'}], lambda e: None)
        self.assertEqual(len(ImageAPI.calls), 2)
        self.assertEqual(ImageAPI.calls[1][0], '/v1/images/edits')
        self.assertEqual(base64.b64decode(ImageAPI.calls[1][1]['images'][0]['image_url'].split(',', 1)[1]), PNG)

    def test_delivery_failure_keeps_successful_write(self):
        replies = self.replies()
        replies[0]['choices'][0]['message']['tool_calls'][0]['function'] = {'name': 'write_file', 'arguments': '{"path":"demo.unknown","content":"saved","deliver":true}'}
        events = []
        with patch.object(backend, 'stream_upstream', side_effect=replies), patch.object(backend, 'approve_tool', return_value=True):
            backend.completion({**self.config(), 'tools': ['write_file'], 'file_permission': 'all'}, [{'role': 'user', 'content': 'x'}], events.append)
        result = next(event['result'] for event in events if event['type'] == 'tool')
        self.assertTrue(result['ok'])
        self.assertIn('delivery_error', result)
        self.assertEqual((self.data / 'files/demo.unknown').read_text(), 'saved')
        self.assertFalse(any(event['type'] == 'file_generated' for event in events))


class ImageParameters(unittest.TestCase):
    def body(self, model, **args):
        return image_requests.parameters({'model': model}, {'prompt': '星星', **args}, [])[0]

    def test_model_defaults_and_legacy_parameters(self):
        self.assertEqual(self.body('chatgpt-image-latest')['size'], 'auto')
        self.assertNotIn('response_format', self.body('chatgpt-image-latest'))
        self.assertNotIn('size', self.body('doubao-seedream-4-5-251128'))
        body = self.body('dall-e-3', quality='hd', style='natural', size='1792x1024')
        self.assertEqual(body['quality'], 'hd')
        self.assertEqual(body['style'], 'natural')
        self.assertEqual(body['n'], 1)

    def test_invalid_parameters_fail_before_network(self):
        cases = [
            ('gpt-image-1.5', {'size': '512x512'}),
            ('gpt-image-2', {'size': '1537x864'}),
            ('gpt-image-2', {'quality': 'hd'}),
            ('gpt-image-2', {'output_format': 'jpeg', 'background': 'transparent'}),
            ('gpt-image-2', {'output_compression': 90}),
            ('dall-e-3', {'quality': 'high'}),
            ('dall-e-3', {'size': '1536x1024'}),
            ('doubao-seedream-4-5-251128', {'size': '1024x1024'}),
            ('doubao-seedream-4-5-251128', {'quality': 'high'}),
            ('doubao-seedream-4-5-251128', {'output_format': 'png'}),
            ('doubao-seedream-5-5-261028', {'size': '4K'}),
            ('doubao-seedream-5-0-lite', {'size': '1K'}),
            ('doubao-seedream-5-0-lite', {'seed': True}),
            ('doubao-seedream-5-0-lite', {'watermark': 'false'}),
            ('doubao-seedream-5.0-pro', {'background': 'auto'}),
            ('doubao-seedream-5-0-flash', {'background': 'transparent'}),
        ]
        for model, args in cases:
            with self.subTest(model=model, args=args), self.assertRaises(ValueError):
                self.body(model, **args)

    def test_seedream_pixel_limits_follow_model_version(self):
        for model, size in [('doubao-seedream-4-5-251128', '3750x1250'), ('doubao-seedream-4-0-250828', '1600x600'), ('doubao-seedream-5-5-261028', '2880x1440')]:
            with self.subTest(model=model):
                self.assertEqual(self.body(model, size=size)['size'], size)

    def test_gateway_alias_can_explicitly_select_protocol(self):
        body, endpoint = image_requests.parameters({'model': 'image2.5'}, {'prompt': 'x', 'image_protocol': 'gpt-image'}, [('image/png', PNG)])
        self.assertEqual(endpoint, '/images/edits')
        self.assertIn('images', body)
        self.assertNotIn('response_format', body)
        with self.assertRaises(ValueError):
            self.body('image2.5', image_protocol='arbitrary')

    def test_legacy_reference_edit_rejected(self):
        for model in ('dall-e-2', 'dall-e-3'):
            with self.subTest(model=model), self.assertRaises(ValueError):
                image_requests.parameters({'model': model}, {'prompt': 'x'}, [('image/png', PNG)])


if __name__ == "__main__":
    unittest.main()
