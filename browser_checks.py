"""Bounded static rendering with an installed Chromium browser and bundled Node."""

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from contextlib import nullcontext
import attachments
import creation_store
import runtime_paths
import security_server
import task_control


def browser():
    candidates = [
        shutil.which(name) for name in ("msedge", "google-chrome", "chromium", "chrome")
    ]
    for base in (
        os.environ.get("PROGRAMFILES(X86)"),
        os.environ.get("PROGRAMFILES"),
        os.environ.get("LOCALAPPDATA"),
    ):
        if base:
            candidates += [
                str(Path(base) / "Microsoft/Edge/Application/msedge.exe"),
                str(Path(base) / "Google/Chrome/Application/chrome.exe"),
            ]
    return next(
        (value for value in candidates if value and Path(value).is_file()), None
    )


@security_server.bounded
def render(root, data, db_factory, key, config, width=1440, pdf=False, version_id=None):
    if (
        type(width) is not int
        or width not in (390, 768, 1440, 1920)
        or type(pdf) is not bool
    ):
        raise ValueError("预览宽度或导出参数无效")
    executable = browser()
    if not executable:
        raise ValueError("未检测到 Edge 或 Chrome，无法执行静态浏览器验收")
    with db_factory() as db:
        creation, version = creation_store.selected(db, data, key, version_id)
        if (
            config.get("_session_id")
            and config["_session_id"] != creation["session_id"]
        ):
            raise ValueError("模型只能检查当前会话的作品")
        document = creation_store.document(db, data, creation, version)
    task_control.check(config)
    with tempfile.TemporaryDirectory(prefix="astra-static-") as folder:
        folder = Path(folder)
        (folder / "request.json").write_text(
            json.dumps({"html": document, "width": width, "pdf": pdf}), encoding="utf-8"
        )
        argv = runtime_paths.command_argv(
            root,
            ["node", str(root / "scripts/static_browser.cjs"), executable, str(folder)],
        )
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            token = config.get("_cancel_token")
            try:
                with (
                    token.resource(lambda: task_control.kill_process(process))
                    if token
                    else nullcontext()
                ):
                    process.wait(timeout=40)
            except subprocess.TimeoutExpired:
                task_control.kill_process(process)
                raise ValueError("静态浏览器验收超时，已请求终止进程") from None
            finally:
                if process.poll() is None:
                    task_control.kill_process(process)
            if process.returncode or not (folder / "report.json").is_file():
                raise ValueError("浏览器渲染失败，请检查 Node.js 22+ 与浏览器安装")
        task_control.check(config)
        report = json.loads((folder / "report.json").read_text(encoding="utf-8"))
        created = []
        try:
            for name, path in [
                ("preview.png", folder / "screenshot.png"),
                ("preview.pdf", folder / "document.pdf"),
            ]:
                if not path.exists():
                    continue
                if path.stat().st_size > attachments.MAX_FILE:
                    raise ValueError("预览导出超过 5 MB 附件限制")
                item = attachments.upload(
                    data,
                    {
                        "name": name,
                        "data": base64.b64encode(path.read_bytes()).decode(),
                    },
                )
                created.append(item)
            task_control.check(config)
            with db_factory() as db:
                # The inspected version remains immutable even if its head changed.
                creation_store.selected(db, data, key, version["id"])
                for item in created:
                    db.execute(
                        "INSERT INTO session_outputs(session_id,attachment_id) VALUES(?,?)",
                        (creation["session_id"], item["id"]),
                    )
        except BaseException:
            for item in created:
                stored = attachments.location(data, item["id"])
                (stored / "content").unlink(missing_ok=True)
                (stored / "meta.json").unlink(missing_ok=True)
                stored.rmdir()
            raise
    image = next(item for item in created if item["kind"] == "image")
    return {
        "ok": True,
        "creation_id": key,
        "version_id": version["id"],
        "report": report,
        "attachment": image,
        "outputs": created,
        "url": "/api/attachments/" + image["id"] + "/content",
        "markdown": "![静态布局截图](/api/attachments/" + image["id"] + "/content)",
    }
