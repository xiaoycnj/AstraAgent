"""Prefer the app's portable tools without changing the user's machine settings."""
import os
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def release_info(root):
    path = Path(root) / 'release.json'
    if path.is_file():
        return json.loads(path.read_text(encoding='utf-8'))
    return {'edition': 'development', 'version': '3.0.1'}


def workspace_id(data):
    path = os.path.normcase(str(Path(data).resolve()))
    return hashlib.sha256(path.encode()).hexdigest()[:16]


def configure_environment(root):
    root = Path(root).resolve()
    paths = [root / 'runtimes/python', root / 'runtimes/python/Scripts', root / 'runtimes/node']
    if os.name == 'nt' and os.environ.get('WINDIR'):
        paths.append(Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0')
    existing = os.environ.get('PATH', '').split(os.pathsep)
    additions = [str(path) for path in paths if path.is_dir() and str(path) not in existing]
    os.environ['PATH'] = os.pathsep.join(additions + existing)
    os.environ['PYTHONUTF8'] = '1'
    os.environ['PYTHONNOUSERSITE'] = '1'
    os.environ.setdefault('npm_config_cache', str(root / 'data/npm-cache'))
    return root / 'runtimes'


def webview_runtime(root):
    folder = Path(root) / 'runtimes/webview2'
    candidates = [folder, *sorted(folder.glob('*'))] if folder.exists() else []
    return next((path for path in candidates if (path / 'msedgewebview2.exe').is_file()), None)


def prepare_webview_runtime(root, data):
    runtime = webview_runtime(root)
    if not runtime or os.name != 'nt' or sys.getwindowsversion().build >= 22000:
        return runtime
    runtime = runtime.resolve()
    allowed = (Path(root) / 'runtimes/webview2').resolve()
    if not runtime.is_relative_to(allowed):
        raise ValueError('WebView2 runtime must stay inside the bundled runtime folder')
    marker = Path(data) / 'webview-permissions.json'
    try:
        if json.loads(marker.read_text(encoding='utf-8')).get('runtime') == str(runtime):
            return runtime
    except (ValueError, OSError, AttributeError):
        pass
    icacls = Path(os.environ['WINDIR']) / 'System32/icacls.exe'
    for identity in ('S-1-15-2-2', 'S-1-15-2-1'):
        result = subprocess.run([str(icacls), str(runtime), '/grant', '*' + identity + ':(OI)(CI)(RX)'],
                                capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise ValueError('Cannot grant application-container read access to the bundled WebView2 folder')
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({'runtime': str(runtime)}), encoding='utf-8')
    return runtime


def command_argv(root, argv):
    """Use bundled interpreters for conventional tool names, preserving explicit paths."""
    runtimes = Path(root) / 'runtimes'
    name = argv[0].lower()
    python = runtimes / 'python/python.exe'
    node = runtimes / 'node/node.exe'
    if name in ('python', 'python3', 'py') and python.is_file():
        args = argv[1:]
        if name == 'py' and args and args[0].startswith('-3'):
            if args[0] not in ('-3', '-3.14'):
                return argv
            args = args[1:]
        return [str(python), *args]
    if name == 'node' and node.is_file():
        return [str(node), *argv[1:]]
    if name in ('npm', 'npx') and node.is_file():
        script = runtimes / 'node/node_modules/npm/bin' / (name + '-cli.js')
        return [str(node), str(script), *argv[1:]]
    return argv
