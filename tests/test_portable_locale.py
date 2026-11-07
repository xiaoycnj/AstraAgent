"""Resource pack validation and the real portable CLI entry point."""
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ui_locale
import runtime_paths
import agent_environment

ROOT = Path(__file__).resolve().parents[1]


def isolated_app(folder):
    folder.mkdir()
    for name in ['tool_provenance.py','native_frame.py','security_core.py','security_audit.py','security_net.py','security_server.py','cli.py','backend.py','server.py','watchdog.py','extensions.py','local_account.py',
                 'agent_environment.py','workbench.py','attachments.py','workspace_tools.py','agent_hub.py',
                 'stream_journal.py','runtime_engine.py','mcp_client.py','storage_manager.py',
                 'project_workspace.py','task_control.py','usage_meter.py','runtime_paths.py','ui_locale.py','openai_oauth.py','openai_responses.py']:
        shutil.copyfile(ROOT / name, folder / name)
    shutil.copytree(ROOT/'modules',folder/'modules',ignore=shutil.ignore_patterns('__pycache__'))
    skill = folder / 'skills/general'
    skill.mkdir(parents=True)
    (skill / 'SKILL.md').write_text('# General\nBe helpful.', encoding='utf-8')
    return folder


class LocaleResources(unittest.TestCase):
    def test_pack_install_selection_and_invalid_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pack = {'code':'fr-FR','name':'Français','messages':{'设置':'Paramètres'}}
            ui_locale.install(root, pack)
            self.assertEqual(ui_locale.packs(root)[0]['fr-FR']['messages']['设置'], 'Paramètres')
            ui_locale.save_preference(root, root / 'data', 'fr-FR')
            self.assertEqual(ui_locale.translator(root, root / 'data')('设置'), 'Paramètres')
            self.assertEqual(ui_locale.translator(root, root / 'data')('not in pack'), 'not in pack')
            (root / 'i18n/broken.json').write_text('{broken')
            self.assertEqual(len(ui_locale.packs(root)[1]), 1)
            for invalid in ('../escape', 'en', 'zh-CN'):
                with self.assertRaises(ValueError):ui_locale.install(root, {**pack,'code':invalid})
            with self.assertRaises(ValueError):ui_locale.validate({**pack,'messages':{'x':{'html':'bad'}}})
            with self.assertRaises(ValueError):ui_locale.save_preference(root, root / 'data', 'missing')

    def test_builtins_and_plain_text(self):
        available, errors = ui_locale.packs(ROOT)
        self.assertEqual(errors, [])
        self.assertIn('zh-CN', available)
        self.assertEqual(available['en']['messages']['常规'], 'General')
        self.assertGreater(len(available['en']['messages']), 700)
        self.assertEqual(ui_locale.validate({'code':'xx','name':'Test','messages':{'x':'<script>alert(1)</script>'}})['messages']['x'], '<script>alert(1)</script>')

    @unittest.skipUnless(os.name == 'nt', 'Windows-specific runtime permissions')
    def test_windows10_runtime_permission_scope(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            runtime=root/'runtimes/webview2/version'
            runtime.mkdir(parents=True)
            (runtime/'msedgewebview2.exe').write_bytes(b'test')
            with patch.object(sys,'getwindowsversion',return_value=SimpleNamespace(build=19045)),patch.object(subprocess,'run',return_value=SimpleNamespace(returncode=0)) as command:
                self.assertEqual(runtime_paths.prepare_webview_runtime(root,root/'data'),runtime.resolve())
                self.assertEqual(command.call_count,2)
                for call in command.call_args_list:self.assertEqual(call.args[0][1],str(runtime.resolve()))
                runtime_paths.prepare_webview_runtime(root,root/'data')
                self.assertEqual(command.call_count,2)

    @unittest.skipUnless((ROOT / 'runtimes/python/python.exe').exists(), 'Portable runtime archive required')
    def test_bundled_tool_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            for argv in [['python','-c','import sys; print(sys.version_info[:2])'],
                         ['py','-3','-c','import sys; print(sys.version_info[:2])'],
                         ['node','--version'],['npm','--version'],['npx','--version']]:
                config={'command_mode':'host','command_permission':'all','access_policy':'full','_authorized_tool':'execute_command'}
                result=agent_environment.command(ROOT,Path(directory),{'argv':argv},config,None,lambda *args:False)
                self.assertEqual(result.get('exit_code'),0,(argv,result))

    @unittest.skipUnless((ROOT / 'runtimes/python/python.exe').exists(), 'Portable runtime archive required')
    def test_clean_path_cli_doctor_and_streaming(self):
        python = ROOT / 'runtimes/python/python.exe'
        env = {**os.environ, 'PATH':str(Path(os.environ.get('WINDIR','C:/Windows')) / 'System32')}
        env.pop('PYTHONHOME', None)
        env.pop('PYTHONPATH', None)
        result = subprocess.run([str(python), str(ROOT / 'cli.py'), 'doctor'], env=env, capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        doctor = json.loads(result.stdout)
        self.assertTrue(doctor['portable_python'])
        self.assertTrue(doctor['webview2'])
        self.assertTrue(doctor['node'].startswith('v24.'))
        class AI(BaseHTTPRequestHandler):
            def log_message(self, *args):pass
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if payload.get('stream'):
                    self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
                    self.wfile.write(b'data: {"choices":[{"delta":{"content":"portable-cli-ok"}}]}\n\ndata: [DONE]\n\n')
                else:
                    self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
                    self.wfile.write(json.dumps({'choices':[{'message':{'content':'{"memories":[]}'}}]}).encode())
        server = ThreadingHTTPServer(('127.0.0.1',0), AI)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                data = Path(directory) / 'data'
                app = isolated_app(Path(directory) / 'app')
                prefix = [str(python),str(app / 'cli.py'),'--data-dir',str(data)]
                configured = subprocess.run(prefix + ['config','--base-url','http://127.0.0.1:' + str(server.server_port) + '/v1','--model','mock'], env=env, capture_output=True, text=True, encoding='utf-8', timeout=20)
                self.assertEqual(configured.returncode, 0, configured.stderr)
                replied = subprocess.run(prefix + ['chat','hello','--permission','deny'], env=env, capture_output=True, text=True, encoding='utf-8', timeout=20)
                self.assertEqual(replied.returncode, 0, replied.stderr)
                self.assertIn('portable-cli-ok', replied.stdout)
        finally:server.shutdown();server.server_close()

    @unittest.skipUnless((ROOT / 'runtimes/python/python.exe').exists(), 'Portable runtime archive required')
    def test_watchdog_avoids_other_workspace_service(self):
        class Other(BaseHTTPRequestHandler):
            def log_message(self, *args):pass
            def do_GET(self):
                self.send_response(200);self.end_headers()
                self.wfile.write(b'{"app":"astra-agent","workspace_id":"another-workspace"}')
        server = ThreadingHTTPServer(('127.0.0.1',0),Other)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                app=isolated_app(root/'app')
                data=root/'data'
                process=subprocess.Popen([str(ROOT/'runtimes/python/python.exe'),str(app/'watchdog.py'),
                                          '--data-dir',str(data),'--port',str(server.server_port),'--parent',str(os.getpid())],
                                         stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                try:
                    state=None
                    for _ in range(100):
                        try:state=json.loads((data/'desktop-state.json').read_text())
                        except (ValueError,OSError):pass
                        if state and state['status']=='ready':break
                        time.sleep(.1)
                    self.assertEqual(state['status'],'ready')
                    self.assertNotEqual(state['url'],'http://127.0.0.1:'+str(server.server_port))
                finally:
                    (data/'desktop-stop').write_text('stop')
                    process.wait(timeout=12)
        finally:server.shutdown();server.server_close()


if __name__ == '__main__':unittest.main()
