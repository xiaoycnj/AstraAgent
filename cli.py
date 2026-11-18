"""Terminal client for the same durable agent API used by the desktop UI."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

import security_core
import runtime_paths
import task_control

ROOT = Path(__file__).resolve().parent
runtime_paths.configure_environment(ROOT)

from cli_render import TerminalDisplay, expand_iui


class Client:
    def __init__(self, data, port=8787):
        self.data = data
        self.base = 'http://127.0.0.1:' + str(port)
        self.token = ''
        self.process = None
        self.log = None

    def call(self, path, method='GET', body=None, stream=False):
        request = Request(self.base + path, method=method,
                          data=json.dumps(body).encode() if body is not None else None,
                          headers={'Content-Type': 'application/json', 'X-App-Token': self.token})
        try:
            response = urlopen(request, timeout=180 if stream else 15)
        except HTTPError as error:
            with error:
                try: message = json.load(error).get('error', 'Request failed')
                except ValueError: message = 'HTTP ' + str(error.code)
            raise ValueError(message) from None
        if stream:
            return response
        with response:
            return json.load(response)

    def connect(self):
        if self.data == ROOT / 'data':
            try:
                health = self.call('/api/health')
                if health.get('app') == 'astra-agent' and health.get('workspace_id') == runtime_paths.workspace_id(self.data):
                    self.token = security_core.capability(self.data)
                    self.token = self.call('/api/bootstrap')['token']
                    return
            except (OSError, URLError, ValueError):
                pass
        self.data.mkdir(parents=True, exist_ok=True)
        logs = self.data / 'logs'
        logs.mkdir(exist_ok=True)
        path = logs / ('cli-' + uuid.uuid4().hex[:8] + '.log')
        self.log = path.open('wb')
        self.process = subprocess.Popen([sys.executable, '-u', str(ROOT / 'server.py'), '--port', '0', '--data-dir', str(self.data)],
                                        cwd=ROOT, stdout=self.log, stderr=subprocess.STDOUT,
                                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        for _ in range(100):
            if self.process.poll() is not None:
                raise ValueError('Backend exited. See ' + str(path))
            match = re.search(r'http://127\.0\.0\.1:\d+', path.read_text(encoding='utf-8', errors='replace'))
            if match:
                self.base = match[0]
                self.token = security_core.capability(self.data)
                self.token = self.call('/api/bootstrap')['token']
                return
            time.sleep(.1)
        raise ValueError('Backend startup timed out. See ' + str(path))

    def close(self):
        if self.process and self.process.poll() is None:
            task_control.kill_process(self.process)
        if self.log:
            self.log.close()


def print_json(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def doctor():
    release = runtime_paths.release_info(ROOT)
    result = {'app': 'AstraAgent', 'version': '3.18.0', 'edition': release['edition'], 'python': sys.version.split()[0], 'python_path': sys.executable,
              'portable_python': (ROOT / 'runtimes/python/python.exe').is_file(),
              'webview2': bool(runtime_paths.webview_runtime(ROOT))}
    node = ROOT / 'runtimes/node/node.exe'
    if node.is_file():
        result['node'] = subprocess.check_output([str(node), '--version'], text=True).strip()
        npm = ROOT / 'runtimes/node/node_modules/npm/bin/npm-cli.js'
        result['npm'] = subprocess.check_output([str(node), str(npm), '--version'], text=True).strip()
    else:
        installed_node = shutil.which('node.exe' if os.name == 'nt' else 'node')
        result['node'] = subprocess.check_output([installed_node, '--version'], text=True).strip() if installed_node else None
    result['webview2_source'] = 'bundled' if result['webview2'] else 'system (desktop requires installed WebView2)'
    result['node_required'] = False
    import ui_locale
    languages, errors = ui_locale.packs(ROOT)
    result['languages'] = list(languages)
    result['language_errors'] = errors
    print_json(result)
    if release['edition'] == 'standard':
        return 0 if result['portable_python'] and result['node'] and result['webview2'] else 1
    return 0


def project_for(client, folder):
    if not folder:
        return None
    path = Path(folder).resolve()
    existing = client.call('/api/projects')
    project = next((item for item in existing if Path(item['path']) == path), None)
    if not project:
        project = client.call('/api/projects', 'PUT', {'name': path.name, 'path': str(path)})
    return project['id']


def chat(client, session, content, options, json_output=False, display=None):
    key = uuid.uuid4().hex
    payload = {'content': content, 'stream': True, 'request_id': key, 'allow_tools': True, **options}
    display = display or TerminalDisplay(plain=json_output)
    if not json_output:
        display.begin()
    try:
        with client.call('/api/sessions/' + session + '/chat', 'POST', payload, stream=True) as response:
            for raw in response:
                if not raw.startswith(b'data:'):
                    continue
                event = json.loads(raw[5:])
                if json_output:
                    print_json(event)
                elif event['type'] == 'delta':
                    display.delta(event['text'])
                else:
                    display.event(event)
                if event['type'] == 'approval':
                    allow = False
                    if sys.stdin.isatty() and not json_output:
                        allow = display.approval(event)
                    client.call('/api/approvals', 'POST', {'id': event['id'], 'allow': allow})
                if event['type'] in ('done', 'cancelled'):
                    if not json_output:
                        answer = event.get('content', '')
                        if display.rich:
                            answer = expand_iui(answer, client, session)
                        display.finish(answer)
                    return 130 if event['type'] == 'cancelled' else 0
                if event['type'] == 'error':
                    raise ValueError(event.get('message', 'Task failed'))
    except KeyboardInterrupt:
        client.call('/api/stream/' + key + '/cancel', 'POST', {})
        for _ in range(50):
            job = client.call('/api/sessions/' + session + '/stream')
            if job.get('status') != 'running':
                break
            time.sleep(.1)
        display.close()
        display.notice('Cancelled. Existing output and project checkpoints are retained.', 'yellow')
        return 130
    finally:
        if not json_output:
            display.close()
    raise ValueError('Stream ended before the task completed. Request ' + key)


def main(argv=None):
    parser = argparse.ArgumentParser(prog='astra', description='AstraAgent portable terminal client')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    commands = parser.add_subparsers(dest='command')
    commands.add_parser('doctor', help='Check bundled runtimes without using an API')
    serve = commands.add_parser('serve', help='Start the local web backend')
    serve.add_argument('--port', type=int, default=8787)
    serve.add_argument('--open', action='store_true')
    commands.add_parser('desktop', help='Open the native desktop app')
    stt=commands.add_parser('stt',help='Run the optional CPU speech service without starting the app backend')
    stt.add_argument('--model',default='base');stt.add_argument('--port',type=int,default=8790)
    stt.add_argument('--threads',type=int,default=4);stt.add_argument('--language',default='zh')
    stt.add_argument('--download-model',action='store_true')
    commands.add_parser('sessions', help='List local chat sessions')
    config = commands.add_parser('config', help='Save an OpenAI-compatible API configuration')
    config.add_argument('--base-url', required=True)
    config.add_argument('--model', required=True)
    config.add_argument('--api-key-env', help='Read the API key from this environment variable')
    prompt = commands.add_parser('chat', help='Run one prompt, or start an interactive chat')
    prompt.add_argument('prompt', nargs='*')
    prompt.add_argument('--session')
    prompt.add_argument('--project', type=Path)
    prompt.add_argument('--model')
    prompt.add_argument('--provider')
    prompt.add_argument('--permission', choices=['deny', 'ask', 'trusted', 'full'], default='ask')
    prompt.add_argument('--files',choices=['none','ask','read','all'],default='ask',help='File access for agent tools')
    prompt.add_argument('--commands',choices=['none','ask','all'],default='ask',help='Command execution permission')
    prompt.add_argument('--command-mode',choices=['sandbox','host'],default='sandbox')
    prompt.add_argument('--json', action='store_true', help='Emit JSON events. Approval requests are denied when non-interactive.')
    prompt.add_argument('--plain', action='store_true', help='Print raw Markdown without terminal formatting')
    prompt.add_argument('--color', choices=['auto','always','never'], default='auto', help='Control terminal colors; respects NO_COLOR and FORCE_COLOR in auto mode')
    prompt.add_argument('--theme', choices=['dark','light'], default='dark', help='Code highlighting theme for your terminal background')
    args = parser.parse_args(argv)
    if args.command == 'doctor':
        return doctor()
    if args.command=='stt':
        executable=ROOT/'.local-stt/runtime/python.exe'
        if not executable.is_file():executable=ROOT/'.local-stt/venv/Scripts/python.exe' if os.name=='nt' else ROOT/'.local-stt/venv/bin/python'
        if not executable.is_file():
            print('Install optional speech support with scripts/install_local_stt.ps1 first.',file=sys.stderr);return 1
        arguments=[str(executable),str(ROOT/'local_stt.py'),'--model',args.model,'--port',str(args.port),'--threads',str(args.threads)]
        if args.language:arguments.extend(['--language',args.language])
        if args.download_model:arguments.append('--download-only')
        return subprocess.call(arguments,cwd=ROOT)
    if args.command in ('serve', 'desktop'):
        file = 'server.py' if args.command == 'serve' else 'desktop.py'
        arguments = [sys.executable, str(ROOT / file), '--data-dir', str(args.data_dir.resolve())]
        if args.command == 'serve':
            arguments.extend(['--port', str(args.port)])
            if args.open: arguments.append('--open')
        return subprocess.call(arguments, cwd=ROOT)
    client = Client(args.data_dir.resolve())
    display = None
    try:
        client.connect()
        if args.command == 'config':
            body = {'base_url': args.base_url, 'model': args.model}
            if args.api_key_env:
                if args.api_key_env not in os.environ: raise ValueError('API key environment variable is missing')
                body['api_key'] = os.environ[args.api_key_env]
            client.call('/api/settings', 'PUT', body)
            print('API configuration saved locally.')
            return 0
        if args.command == 'sessions':
            for session in client.call('/api/sessions'):
                print_json({key: session[key] for key in ('id', 'title', 'project_id', 'archived')})
            return 0
        if args.command is None:
            args = parser.parse_args(['--data-dir', str(args.data_dir), 'chat'])
        display = TerminalDisplay(plain=args.plain or args.json, color='never' if args.json else args.color, theme=args.theme)
        if args.permission in ('trusted','full'):client.call('/api/runtime','PUT',{'access_policy':args.permission})
        options = {'access_policy': args.permission,'file_permission':args.files,'command_permission':args.commands,'command_mode':args.command_mode}
        for key in ('model', 'provider'):
            if getattr(args, key): options[key] = getattr(args, key)
        project = project_for(client, args.project)
        if project: options['project_id'] = project
        session = args.session or client.call('/api/sessions', 'POST', {'title': 'CLI chat'})['id']
        if args.prompt:
            return chat(client, session, ' '.join(args.prompt), options, args.json, display)
        if args.json:
            print('AstraAgent CLI. /new, /help, /quit. Ctrl+C stops the current task.', file=sys.stderr)
        else:
            display.welcome()
        while True:
            try: content = display.prompt(args.json).strip()
            except (EOFError, KeyboardInterrupt):
                print(file=sys.stderr if args.json else sys.stdout)
                return 0
            if content in ('/quit', '/exit'): return 0
            if content == '/help':
                display.notice('/new 新会话 · /quit 退出 · Ctrl+C 停止生成\n启动选项 --plain · --color auto|always|never · --theme dark|light')
            elif content == '/new':
                session = client.call('/api/sessions', 'POST', {'title': 'CLI chat'})['id']
            elif content:
                try: chat(client, session, content, options, args.json, display)
                except ValueError as error: display.notice(str(error), 'red')
    except (ValueError, OSError, URLError) as error:
        if display: display.notice(str(error), 'red')
        else: print(str(error), file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
