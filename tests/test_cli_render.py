"""Rich terminal rendering and the public CLI entry point."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import cli
import cli_render
from rich.console import Console
from rich.text import Text

ANSWER = '# 结果\n\n**中文加粗** 与 `value`\n\n> 引用\n\n- 第一项\n- 第二项\n\n| 模型 | 速度 |\n| --- | --- |\n| Astra | 42 |\n\n```python\nprint("你好")\n```\n'


class TTY(io.StringIO):
    def isatty(self):
        return True


class Events(io.BytesIO):
    def __init__(self, *events):
        super().__init__(
            b"".join(b"data: " + json.dumps(event).encode() + b"\n\n" for event in events)
        )


class Rendering(unittest.TestCase):
    def display(self, **options):
        output, errors = options.pop("stream", io.StringIO()), io.StringIO()
        return (
            cli_render.TerminalDisplay(stream=output, errors=errors, width=64, **options),
            output,
            errors,
        )

    def test_markdown_color_and_literal_markup(self):
        display, output, _ = self.display(color="always")
        display.begin()
        display.delta(ANSWER[:30])
        display.delta(ANSWER[30:])
        display.finish(ANSWER + "\n[red]literal[/red]")
        rendered = output.getvalue()
        self.assertIn("\x1b[", rendered)
        plain = Text.from_ansi(rendered).plain
        for expected in (
            "中文加粗",
            "第一项",
            "第二项",
            "模型",
            "速度",
            "Astra",
            "42",
            "print",
            "你好",
            "[red]literal[/red]",
        ):
            self.assertIn(expected, plain)
        self.assertNotIn("```", plain)
        self.assertNotIn("**中文加粗**", plain)

    def test_plain_pipe_and_missing_dependency(self):
        for options in ({}, {"plain": True, "color": "always"}):
            display, output, _ = self.display(**options)
            display.begin()
            display.delta(ANSWER[:10])
            display.delta(ANSWER[10:])
            display.finish(ANSWER)
            display.close()
            self.assertEqual(output.getvalue(), ANSWER + "\n")
        with patch.object(cli_render, "Console", None):
            display, output, _ = self.display(color="always")
            display.begin()
            display.delta("fallback")
            display.close()
            self.assertEqual(output.getvalue(), "fallback\n")

    def test_color_preferences_and_monochrome_markdown(self):
        with patch.dict(
            os.environ, {"NO_COLOR": "1", "TERM": "xterm", "FORCE_COLOR": "1"}, clear=True
        ):
            self.assertFalse(cli_render.supports_color(TTY(), "auto"))
            self.assertTrue(cli_render.supports_color(TTY(), "always"))
            self.assertFalse(cli_render.supports_color(TTY(), "never"))
            display, output, _ = self.display(stream=TTY(), color="never")
            display.begin()
            display.finish("**中文**")
            self.assertIn("中文", output.getvalue())
            self.assertNotIn("**", output.getvalue())
            self.assertNotIn("\x1b", output.getvalue())
        with patch.dict(os.environ, {"TERM": "dumb"}, clear=True):
            self.assertFalse(cli_render.supports_color(TTY(), "auto"))
            display, output, _ = self.display(color="always", theme="light")
            display.begin()
            display.finish("```python\nx = 1\n```")
            self.assertIn("\x1b[", output.getvalue())
            self.assertEqual(display.code_theme, "ansi_light")
        with patch.dict(os.environ, {"FORCE_COLOR": "1"}, clear=True):
            self.assertTrue(cli_render.supports_color(io.StringIO(), "auto"))
        with patch.dict(os.environ, {"FORCE_COLOR": "1", "TERM": "dumb"}, clear=True):
            display, output, _ = self.display()
            display.begin()
            display.finish("**forced**")
            self.assertTrue(display.rich)
            self.assertIn("\x1b[", output.getvalue())

    def test_controls_split_across_deltas(self):
        sanitizer = cli_render.TerminalText()
        chunks = [
            "你好\x1b[3",
            "1m红\x1b[0m\x1b]52;c;",
            "clipboard\x1b",
            "\\继续\r\x00\x9b2J\x9dtitle\x9c\n结束",
        ]
        self.assertEqual("".join(sanitizer.feed(chunk) for chunk in chunks), "你好红继续\n结束")

    def test_unknown_fence_never_loads_lexer_plugins(self):
        from pygments import lexers

        with patch.object(
            lexers, "find_plugin_lexers", side_effect=AssertionError("plugin loaded")
        ):
            display, output, _ = self.display(color="always")
            display.begin()
            display.finish("```unknown-model-language\nhello\n```\n\n```Python\nprint(1)\n```")
            self.assertIn("hello", output.getvalue())

    def test_live_preview_is_bounded_and_final_answer_is_complete(self):
        output = TTY()
        with patch.dict(os.environ, {"TERM": "xterm"}, clear=True):
            display, _, _ = self.display(stream=output, color="always")
            display.begin()
            display.delta("```python\n" + "\n".join("value_%d = %d" % (i, i) for i in range(1200)))
            display.refresh(force=True)
            self.assertIsNotNone(display.live)
            display.notice("工具完成", "green")
            self.assertIsNone(display.live)
            display.delta("\n```\n最后一行")
            display.finish(display.source)
            self.assertIsNone(display.live)
            self.assertIn("value_0", Text.from_ansi(output.getvalue()).plain)
            self.assertIn("value_1199", Text.from_ansi(output.getvalue()).plain)
            self.assertIn("最后一行", Text.from_ansi(output.getvalue()).plain)
        console = Console(file=io.StringIO(), width=32, height=12, color_system=None)
        tail = cli_render.LiveTail("\n".join("第%d行" % i for i in range(100)), "ansi_dark")
        lines = console.render_lines(tail)
        self.assertLessEqual(len(lines), 9)
        self.assertIn("第99行", "".join(segment.text for line in lines for segment in line))

    def test_errors_flush_partial_and_json_has_no_rendering(self):
        client = unittest.mock.Mock()
        client.call.return_value = Events(
            {"type": "delta", "text": "partial"}, {"type": "error", "message": "failed"}
        )
        display, output, _ = self.display(color="always")
        with self.assertRaisesRegex(ValueError, "failed"):
            cli.chat(client, "session", "hello", {}, display=display)
        self.assertTrue(display.finished)
        self.assertIn("partial", output.getvalue())
        events = [
            {"type": "delta", "text": "**answer**"},
            {"type": "done", "content": "**answer**"},
        ]
        client.call.return_value = Events(*events)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.chat(client, "session", "hello", {}, True, display), 0)
        self.assertEqual([json.loads(line) for line in output.getvalue().splitlines()], events)

    def test_approval_is_literal_and_cancellation_restores_display(self):
        display, _, errors = self.display(color="always")
        with patch("builtins.input", return_value="YES"):
            self.assertTrue(display.approval({"name": "[red]tool", "args": {"file": "中文"}}))
        self.assertIn("[red]tool", Text.from_ansi(errors.getvalue()).plain)
        client = unittest.mock.Mock()
        client.call.side_effect = [KeyboardInterrupt(), {}, {"status": "cancelled"}]
        self.assertEqual(cli.chat(client, "session", "hello", {}, display=display), 130)
        self.assertTrue(display.finished)
        self.assertIn("/cancel", client.call.call_args_list[1].args[0])

    def test_iui_cards_expand_with_valid_tables(self):
        client = unittest.mock.Mock()
        client.call.return_value = {
            "document": {
                "title": "请选择",
                "purpose": "question",
                "blocks": [
                    {
                        "id": "table",
                        "type": "table",
                        "columns": ["模型", "速度"],
                        "rows": [["Astra", 42]],
                    },
                    {
                        "id": "choices",
                        "type": "choices",
                        "items": [{"id": "one", "label": "第一项"}],
                    },
                ],
            },
            "state": {},
        }
        marker = "[[iui:" + "a" * 32 + "]]"
        result = cli_render.expand_iui(marker + "\n" + marker, client, "session")
        self.assertIn("| 模型 | 速度 |\n| --- | --- |\n| Astra | 42 |", result)
        self.assertIn("第一项", result)
        self.assertIn("下一条消息", result)
        self.assertEqual(client.call.call_count, 1)


class CLIIntegration(unittest.TestCase):
    @unittest.skipUnless((ROOT / "runtimes/python/python.exe").exists(), "Bundled CPython required")
    def test_real_config_chat_and_json_repl(self):
        class Model(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "text/event-stream" if payload.get("stream") else "application/json",
                )
                self.end_headers()
                if payload.get("stream"):
                    for chunk in (ANSWER[:20], ANSWER[20:]):
                        self.wfile.write(
                            (
                                "data: "
                                + json.dumps({"choices": [{"delta": {"content": chunk}}]})
                                + "\n\n"
                            ).encode()
                        )
                    self.wfile.write(b"data: [DONE]\n\n")
                else:
                    self.wfile.write(
                        json.dumps(
                            {"choices": [{"message": {"content": '{"memories":[]}'}}]}
                        ).encode()
                    )

        server = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                prefix = [
                    str(ROOT / "runtimes/python/python.exe"),
                    str(ROOT / "cli.py"),
                    "--data-dir",
                    str(Path(temporary) / "data"),
                ]
                env = {**os.environ, "PYTHONUTF8": "1", "NO_COLOR": "1", "TERM": "dumb"}

                def run(*arguments, input=None):
                    result = subprocess.run(
                        prefix + list(arguments),
                        input=input,
                        env=env,
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        timeout=30,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    return result

                run(
                    "config",
                    "--base-url",
                    "http://127.0.0.1:%d/v1" % server.server_port,
                    "--model",
                    "fixture",
                )
                raw = run("chat", "hello", "--permission", "deny")
                self.assertIn(ANSWER, raw.stdout)
                self.assertNotIn("\x1b", raw.stdout)
                colored = run("chat", "hello", "--permission", "deny", "--color", "always")
                self.assertIn("\x1b[", colored.stdout)
                self.assertNotIn("```", colored.stdout)
                plain = run("chat", "hello", "--permission", "deny", "--plain", "--color", "always")
                self.assertIn(ANSWER, plain.stdout)
                self.assertNotIn("\x1b", plain.stdout)
                events = run(
                    "chat",
                    "--json",
                    "--color",
                    "always",
                    "--permission",
                    "deny",
                    input="hello\n/quit\n",
                )
                parsed = [json.loads(line) for line in events.stdout.splitlines()]
                self.assertTrue(
                    any(event["type"] == "done" and event["content"] == ANSWER for event in parsed)
                )
                self.assertIn("astra>", events.stderr)
                self.assertNotIn("\x1b", events.stdout)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
