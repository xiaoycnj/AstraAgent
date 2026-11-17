"""Terminal presentation for the CLI, with a plain stream fallback."""

import json
import os
from pathlib import Path
import re
import sys
import time

VENDOR = str(Path(__file__).resolve().parent / "vendor_python")
if VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

try:
    from rich.console import Console
    from rich.live import Live
    from rich.markdown import Markdown
    from rich.panel import Panel
    from rich.segment import Segment
    from rich.syntax import Syntax
    from rich.text import Text
    from pygments.lexers._mapping import LEXERS

    BUILTIN_LEXERS = frozenset(alias for lexer in LEXERS.values() for alias in lexer[2])
except ImportError:
    Console = None


class TerminalText:
    """Drop terminal control sequences, including sequences split across deltas."""

    def __init__(self):
        self.state = "text"

    def feed(self, value):
        output = []
        for character in value:
            number = ord(character)
            if self.state == "text":
                if character == "\x1b":
                    self.state = "escape"
                elif character in ("\x90", "\x9d", "\x9e", "\x9f"):
                    self.state = "string"
                elif character == "\x9b":
                    self.state = "csi"
                elif character in ("\n", "\t") or number >= 32 and not 127 <= number < 160:
                    output.append(character)
            elif self.state == "escape":
                if character == "[":
                    self.state = "csi"
                elif character in "]P^_X":
                    self.state = "string"
                elif not 32 <= number <= 47:
                    self.state = "text"
            elif self.state == "csi":
                if 64 <= number <= 126:
                    self.state = "text"
            elif self.state == "string":
                if character in ("\a", "\x9c"):
                    self.state = "text"
                elif character == "\x1b":
                    self.state = "string_escape"
            elif self.state == "string_escape":
                self.state = "text" if character == "\\" else "string"
        return "".join(output)


def safe_text(value):
    return TerminalText().feed(str(value))


def supports_color(stream, preference):
    if preference != "auto":
        return preference == "always"
    if "NO_COLOR" in os.environ:
        return False
    if os.environ.get("FORCE_COLOR", "0") not in ("", "0"):
        return True
    return bool(stream.isatty() and os.environ.get("TERM") not in ("dumb", "unknown"))


def markdown_document(source, theme):
    document = Markdown(source, code_theme=theme, hyperlinks=False)
    # A model-controlled fence may select a builtin lexer, never an installed plugin.
    for token in document.parsed:
        if token.type == "fence":
            language = token.info.partition(" ")[0].lower()
            token.info = language if language in BUILTIN_LEXERS else "text"
    return document


class LiveTail:
    """Keep the changing preview within the terminal; the final answer prints in full."""

    def __init__(self, source, theme):
        self.source = source
        self.theme = theme

    def __rich_console__(self, console, options):
        source = self.source
        if len(source) > 12000:
            cut = source.find("\n", len(source) - 12000)
            cut = cut + 1 if cut >= 0 else len(source) - 12000
            fence = None
            for match in re.finditer(r"^ {0,3}(`{3,}|~{3,})([^\n]*)$", source[:cut], re.MULTILINE):
                marker, language = match.groups()
                if (
                    fence
                    and marker[0] == fence[0][0]
                    and len(marker) >= len(fence[0])
                    and not language.strip()
                ):
                    fence = None
                elif fence is None:
                    fence = (marker, language)
            source = source[cut:]
            if fence:
                source = fence[0] + fence[1] + "\n" + source
        renderable = (
            markdown_document(source, self.theme) if source else Text("正在生成…", style="dim")
        )
        lines = console.render_lines(renderable, options.update(height=None), pad=False)
        height = max(1, console.size.height - 5)
        if len(lines) > height:
            yield Text("…", style="dim")
        for line in lines[-height:]:
            yield from line
            yield Segment.line()


class TerminalDisplay:
    def __init__(
        self, plain=False, color="auto", theme="dark", stream=None, errors=None, width=None
    ):
        self.stream = stream if stream is not None else sys.stdout
        self.errors = errors if errors is not None else sys.stderr
        self.color = supports_color(self.stream, color) and not plain
        self.rich = bool(
            Console
            and not plain
            and (self.stream.isatty() or self.color)
            and (os.environ.get("TERM") not in ("dumb", "unknown") or self.color)
        )
        self.code_theme = "ansi_light" if theme == "light" else "ansi_dark"
        self.console = self.error_console = None
        if Console:
            force_ansi = self.color and (
                not self.stream.isatty() or os.environ.get("TERM") in ("dumb", "unknown")
            )
            self.console = Console(
                file=self.stream,
                force_terminal=self.color,
                color_system="standard" if force_ansi else "auto" if self.color else None,
                legacy_windows=False if force_ansi else None,
                no_color=not self.color,
                markup=False,
                highlight=False,
                width=width,
            )
            error_color = supports_color(self.errors, color) and not plain
            error_ansi = error_color and (
                not self.errors.isatty() or os.environ.get("TERM") in ("dumb", "unknown")
            )
            self.error_console = Console(
                file=self.errors,
                force_terminal=error_color,
                color_system="standard" if error_ansi else "auto" if error_color else None,
                legacy_windows=False if error_ansi else None,
                no_color=not error_color,
                markup=False,
                highlight=False,
                width=width,
            )
        self.live = None
        self.source = ""
        self.sanitizer = TerminalText()
        self.last_refresh = 0.0
        self.finished = True

    def begin(self):
        self.source = ""
        self.sanitizer = TerminalText()
        self.finished = False
        if self.rich:
            self.console.rule("AstraAgent", style="cyan")
            self.refresh(force=True)

    def refresh(self, force=False):
        if not self.rich or not self.color or not self.stream.isatty():
            return
        now = time.monotonic()
        if not force and now - self.last_refresh < 0.15:
            return
        self.last_refresh = now
        preview = LiveTail(
            re.sub(r"\[\[iui:[a-f0-9]{32}\]\]", "交互卡片正在载入…", self.source), self.code_theme
        )
        if self.live is None:
            self.live = Live(
                preview,
                console=self.console,
                auto_refresh=False,
                transient=True,
                redirect_stdout=False,
                redirect_stderr=False,
                vertical_overflow="crop",
            )
            self.live.start(refresh=True)
        else:
            self.live.update(preview, refresh=True)

    def delta(self, value):
        value = self.sanitizer.feed(value)
        self.source += value
        if self.rich:
            self.refresh()
        else:
            self.stream.write(value)
            self.stream.flush()

    def pause(self):
        if self.live is not None:
            self.live.stop()
            self.live = None

    def finish(self, answer):
        self.pause()
        answer = safe_text(answer)
        if self.rich:
            self.console.print(markdown_document(answer, self.code_theme))
        else:
            if answer.startswith(self.source):
                self.stream.write(answer[len(self.source) :])
            elif answer != self.source:
                self.stream.write("\n" + answer)
            self.stream.write("\n")
            self.stream.flush()
        self.finished = True

    def close(self):
        if not self.finished:
            self.finish(self.source)
        self.pause()

    def notice(self, message, style="cyan"):
        self.pause()
        if self.error_console:
            self.error_console.print(Text(safe_text(message), style=style))
        else:
            print(safe_text(message), file=self.errors, flush=True)

    def event(self, event):
        kind = event["type"]
        if kind in ("tool_start", "checkpoint", "verification", "routing", "budget"):
            self.notice("› " + str(event.get("name") or event.get("resolved_model") or kind))
        elif kind == "tool" and self.errors.isatty():
            failed = isinstance(event.get("result"), dict) and bool(event["result"].get("error"))
            self.notice(
                ("失败 · " if failed else "完成 · ") + str(event.get("name", "")),
                "red" if failed else "green",
            )

    def approval(self, event):
        self.pause()
        title = "批准工具调用 · " + safe_text(event["name"])
        arguments = safe_text(json.dumps(event["args"], ensure_ascii=False, indent=2))
        if self.error_console and self.errors.isatty():
            self.error_console.print(
                Panel(
                    Syntax(arguments, "json", theme=self.code_theme, word_wrap=True),
                    title=title,
                    border_style="yellow",
                )
            )
        else:
            self.notice(title + "\n" + arguments, "yellow")
        self.notice("仅本次允许？[y/N] ", "yellow")
        return input().strip().lower() in ("y", "yes")

    def welcome(self):
        if self.rich:
            self.console.print(Text("AstraAgent CLI", style="bold cyan"))
            self.console.print(
                Text("/new 新会话   /help 帮助   /quit 退出   Ctrl+C 停止生成", style="dim")
            )
        else:
            self.stream.write(
                "AstraAgent CLI. /new starts a new chat. /help shows help. /quit exits. Ctrl+C stops the current task.\n"
            )

    def prompt(self, json_output=False):
        if json_output:
            print("\nastra> ", end="", file=self.errors, flush=True)
            return input()
        if self.rich:
            self.console.print(Text("\nastra> ", style="bold cyan"), end="")
            return input()
        return input("\nastra> ")


def expand_iui(answer, client, session):
    """Present session-owned native cards as readable Markdown in the terminal."""
    documents = {}

    def replace(match):
        key = match[1]
        if key in documents:
            return documents[key]
        try:
            record = client.call("/api/iui/" + key + "?session=" + session)
            document, state = record["document"], record["state"]
            lines = ["### " + document["title"], document.get("description", "")]
            for block in document["blocks"]:
                if block.get("title"):
                    lines.append("#### " + block["title"])
                if block.get("text"):
                    lines.append(block["text"])
                for item in block.get("items", []):
                    mark = "[x]" if state.get(block["id"] + "/" + item["id"], False) else "[ ]"
                    prefix = mark + " " if block["type"] == "checklist" else ""
                    lines.append(
                        "- "
                        + prefix
                        + item["label"]
                        + (" · " + str(item["value"]) if item.get("value", "") != "" else "")
                        + (" — " + item["description"] if item.get("description") else "")
                    )
                for field in block.get("fields", []):
                    value = state.get(block["id"] + "/" + field["id"], "")
                    lines.append(
                        "- "
                        + field["label"]
                        + (" *" if field.get("required") else "")
                        + " = "
                        + str(value)
                    )
                for output in record.get("outputs", {}).get(block["id"], []):
                    lines.append(
                        "- "
                        + output["label"]
                        + " = "
                        + str(output["value"])
                        + " "
                        + output.get("unit", "")
                    )
                if block["type"] == "table":
                    table = []
                    for row in [block["columns"], ["---"] * len(block["columns"]), *block["rows"]]:
                        cells = [str(cell).replace("|", "\\|").replace("\n", " ") for cell in row]
                        table.append("| " + " | ".join(cells) + " |")
                    lines.append("\n".join(table))
                if block["type"] == "chart":
                    for index, label in enumerate(block["labels"]):
                        lines.append(
                            "- "
                            + label
                            + " · "
                            + " / ".join(
                                series["label"] + " " + str(series["values"][index])
                                for series in block["series"]
                            )
                        )
            if document.get("purpose") in ("question", "confirmation"):
                lines.append("可以在下一条消息中用文字回答或说明确认／取消。")
            documents[key] = "\n\n".join(lines)
        except (ValueError, OSError, KeyError):
            documents[key] = "交互卡片 · " + key + "（请在桌面会话中查看）"
        return documents[key]

    return re.sub(r"\[\[iui:([a-f0-9]{32})\]\]", replace, answer)
