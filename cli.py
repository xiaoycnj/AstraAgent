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
    result = {'app': 'AstraAgent', 'version': '3.0.1', 'edition': release['edition'], 'python': sys.version.split()[0], 'python_path': sys.executable,
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


def chat(client, session, content, options, json_output=False):
    key = uuid.uuid4().hex
    payload = {'content': content, 'stream': True, 'request_id': key, 'allow_tools': True, **options}
    shown = ''
    try:
        with client.call('/api/sessions/' + session + '/chat', 'POST', payload, stream=True) as response:
            for raw in response:
                if not raw.startswith(b'data:'):
                    continue
                event = json.loads(raw[5:])
                if json_output:
                    print_json(event)
                elif event['type'] == 'delta':
                    shown += event['text']
                    print(event['text'], end='', flush=True)
                elif event['type'] in ('tool_start', 'checkpoint', 'verification'):
                    print('\n[' + event.get('name', event['type']) + ']', file=sys.stderr, flush=True)
                if event['type'] == 'approval':
                    allow = False
                    if sys.stdin.isatty() and not json_output:
                        print('\nApproval: ' + event['name'] + '\n' + json.dumps(event['args'], ensure_ascii=False, indent=2), file=sys.stderr)
                        allow = input('Allow once? [y/N] ').strip().lower() in ('y', 'yes')
                    client.call('/api/approvals', 'POST', {'id': event['id'], 'allow': allow})
                if event['type'] in ('done', 'cancelled'):
                    answer = event.get('content', '')
                    if not json_output:
                        if answer.startswith(shown): print(answer[len(shown):])
                        elif answer != shown: print('\n' + answer)
                        else: print()
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
        print('\nCancelled. Existing output and project checkpoints are retained.', file=sys.stderr)
        return 130
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
    args = parser.parse_args(argv)
    if args.command == 'doctor':
        return doctor()
    if args.command in ('serve', 'desktop'):
        file = 'server.py' if args.command == 'serve' else 'desktop.py'
        arguments = [sys.executable, str(ROOT / file), '--data-dir', str(args.data_dir.resolve())]
        if args.command == 'serve':
            arguments.extend(['--port', str(args.port)])
            if args.open: arguments.append('--open')
        return subprocess.call(arguments, cwd=ROOT)
    client = Client(args.data_dir.resolve())
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
        options = {'access_policy': args.permission,'file_permission':args.files,'command_permission':args.commands,'command_mode':args.command_mode}
        for key in ('model', 'provider'):
            if getattr(args, key): options[key] = getattr(args, key)
        project = project_for(client, args.project)
        if project: options['project_id'] = project
        session = args.session or client.call('/api/sessions', 'POST', {'title': 'CLI chat'})['id']
        if args.prompt:
            return chat(client, session, ' '.join(args.prompt), options, args.json)
        print('AstraAgent CLI. /new starts a new chat. /quit exits. Ctrl+C stops the current task.')
        while True:
            try: content = input('\nastra> ').strip()
            except (EOFError, KeyboardInterrupt): print(); return 0
            if content in ('/quit', '/exit'): return 0
            if content == '/new':
                session = client.call('/api/sessions', 'POST', {'title': 'CLI chat'})['id']
            elif content:
                try: chat(client, session, content, options, args.json)
                except ValueError as error: print(str(error), file=sys.stderr)
    except (ValueError, OSError, URLError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == '__main__':
    raise SystemExit(main())
