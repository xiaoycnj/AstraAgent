"""Real-project edit, verification, rollback and cooperative cancellation regressions."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend
import agent_environment
import project_workspace as projects
import task_control


class ProjectWorkflow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / 'data'
        self.project = self.root / 'example'
        self.project.mkdir()
        self.old = backend.ROOT, backend.DATA
        backend.ROOT, backend.DATA = self.root, self.data
        folder = self.root / 'skills/general'
        folder.mkdir(parents=True)
        (folder / 'SKILL.md').write_text('# General\nHelp')
        backend.initialize()
        self.record = projects.save(self.data, {'name': 'Example', 'path': str(self.project)})
        self.key = self.record['id']

    def tearDown(self):
        projects.LEASES.pop(self.key, None)
        backend.ROOT, backend.DATA = self.old
        self.temp.cleanup()

    def test_checkpoint_restores_existing_user_changes_and_added_deleted_files(self):
        (self.project / 'user.txt').write_text('uncommitted user edit\n')
        (self.project / 'deleted.txt').write_bytes(b'original\x00binary')
        point = projects.checkpoint(self.data, self.key, 'before')
        (self.project / 'user.txt').write_text('agent edit\n')
        (self.project / 'deleted.txt').unlink()
        (self.project / 'new.txt').write_text('new')
        result = projects.diff(self.data, self.key, point['id'])
        self.assertEqual({change['kind'] for change in result['changes']}, {'modified', 'added', 'deleted'})
        undo = projects.rollback(self.data, self.key, point['id'], result['revision'])
        self.assertEqual((self.project / 'user.txt').read_text(), 'uncommitted user edit\n')
        self.assertEqual((self.project / 'deleted.txt').read_bytes(), b'original\x00binary')
        self.assertFalse((self.project / 'new.txt').exists())
        preview = projects.diff(self.data, self.key, undo['undo_checkpoint'])
        projects.rollback(self.data, self.key, undo['undo_checkpoint'], preview['revision'])
        self.assertEqual((self.project / 'user.txt').read_text(), 'agent edit\n')
        self.assertTrue((self.project / 'new.txt').exists())

    def test_stale_preview_and_project_lease_protect_files(self):
        file = self.project / 'x.txt'
        file.write_text('before')
        point = projects.checkpoint(self.data, self.key, 'before')
        file.write_text('edited')
        preview = projects.diff(self.data, self.key, point['id'])
        file.write_text('external change')
        with self.assertRaises(FileExistsError):
            projects.rollback(self.data, self.key, point['id'], preview['revision'])
        self.assertEqual(file.read_text(), 'external change')
        projects.acquire(self.key, 'one')
        with self.assertRaises(ValueError):
            projects.acquire(self.key, 'two')
        projects.release(self.key, 'one')

    def test_boundaries_and_size_limits(self):
        for path in ('../escape', '.git/config', 'node_modules/x', str(self.root / 'outside')):
            with self.assertRaises(ValueError):
                projects.target(self.project, path)
        (self.project / 'node_modules').mkdir()
        (self.project / 'node_modules/package').write_text('excluded')
        (self.project / 'a').write_text('kept')
        self.assertEqual(list(projects.scan(self.data, self.record)), ['a'])
        with patch.object(projects, 'MAX_FILE_BYTES', 1):
            with self.assertRaises(ValueError):
                projects.checkpoint(self.data, self.key, 'too large')

    def test_model_reads_edits_and_verifies_actual_project(self):
        file = self.project / 'answer.py'
        file.write_text('VALUE = 1\n')
        (self.project / 'AGENTS.md').write_text('Keep the module readable.')
        check = {'name': 'Value check', 'argv': [sys.executable, '-c', 'import answer; assert answer.VALUE == 2; print("verified-two")']}
        projects.save(self.data, {**self.record, 'checks': [check], 'instructions': 'Saved instruction'})
        config = backend.request_config({'project_id': self.key, 'allow_tools': True, 'access_policy': 'full', 'auto_memory': False})
        config['model'] = 'mock'
        self.assertIn('Keep the module readable.', config['system_prompt'])
        self.assertIn('Saved instruction', config['system_prompt'])
        point = projects.checkpoint(self.data, self.key, 'before')
        count = 0

        def model(c, payload, emit):
            nonlocal count
            count += 1
            if count == 1:
                name, args = 'read_file', {'path': 'answer.py'}
            elif count == 2:
                read = json.loads(payload['messages'][-1]['content'])
                name, args = 'write_file', {'path': 'answer.py', 'content': 'VALUE = 2\n', 'revision': read['revision']}
            elif count == 3:
                self.assertNotIn('error', json.loads(payload['messages'][-1]['content']))
                name, args = 'project_verify', {}
            else:
                verification = json.loads(payload['messages'][-1]['content'])
                self.assertEqual(verification['verdict'], 'passed')
                self.assertIn('verified-two', verification['results'][0]['output'])
                return {'choices': [{'message': {'content': 'Updated and verified.'}}]}
            return {'choices': [{'message': {'tool_calls': [{'id': str(count), 'function': {'name': name, 'arguments': json.dumps(args)}}]}}]}

        with patch.object(backend, 'stream_upstream', side_effect=model), patch.object(backend,'approve_tool',return_value=True) as approval:
            result = backend.completion(config, [{'role': 'user', 'content': 'Set value to two and verify.'}], lambda event: None)
        self.assertEqual(result, 'Updated and verified.')
        self.assertEqual(file.read_text(), 'VALUE = 2\n')
        self.assertIn('answer.py', [change['path'] for change in projects.diff(self.data, self.key, point['id'])['changes']])

    def test_verification_failed_and_missing_are_factual(self):
        result = projects.verify(self.data, self.key, [], lambda check: self.fail())
        self.assertEqual(result['verdict'], 'unverified')
        result = projects.verify(self.data, self.key, [{'name': 'Fail', 'argv': ['mock']}], lambda check: {'exit_code': 1, 'output': 'failed'})
        self.assertEqual(result['verdict'], 'failed')

    def test_cancel_running_process_and_approval(self):
        token = task_control.Token()
        config = {'command_mode': 'host', 'command_permission': 'all', '_authorized_tool': 'execute_command', '_cancel_token': token, 'project_root': str(self.project)}
        started = threading.Event()
        original = subprocess.Popen

        def process(*args, **kwargs):
            result = original(*args, **kwargs)
            if args and isinstance(args[0], list) and sys.executable in args[0]:
                started.set()
            return result

        failure = []
        def run():
            try:
                agent_environment.command(self.root, self.data, {'argv': [sys.executable, '-c', 'import time; time.sleep(60)']}, config, None, lambda *args: False)
            except task_control.Cancelled:
                failure.append('cancelled')
        with patch('subprocess.Popen', side_effect=process):
            worker = threading.Thread(target=run)
            worker.start()
            self.assertTrue(started.wait(5))
            token.cancel()
            worker.join(8)
        self.assertFalse(worker.is_alive())
        self.assertEqual(failure, ['cancelled'])
        with self.assertRaises(task_control.Cancelled):
            backend.approve_tool('write_file', {}, lambda event: None, token)

    def test_http_project_binding_edit_diff_and_rollback(self):
        file = self.project / 'answer.py'
        file.write_text('VALUE = 1\n')
        projects.save(self.data, {**self.record, 'checks': [{'name': 'Validate', 'argv': [sys.executable, '-c', 'import answer; assert answer.VALUE == 2']}]})
        app = backend.LocalServer(('127.0.0.1', 0), backend.Handler)
        threading.Thread(target=app.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:' + str(app.server_port)
        with urlopen(Request(base + '/api/bootstrap',headers={'X-App-Token':backend.TOKEN})) as response:
            token = json.load(response)['token']
        def call(path, method='GET', body=None):
            request = Request(base + path, method=method, headers={'Content-Type':'application/json','X-App-Token':token}, data=json.dumps(body).encode() if body is not None else None)
            with urlopen(request, timeout=8) as response:
                return response.read().decode()
        count = 0
        def model(config, payload, emit):
            nonlocal count
            count += 1
            if count == 1:
                name, args = 'read_file', {'path':'answer.py'}
            elif count == 2:
                revision = json.loads(payload['messages'][-1]['content'])['revision']
                name, args = 'write_file', {'path':'answer.py','content':'VALUE = 2\n','revision':revision}
            else:
                return {'choices':[{'message':{'content':'Changed the project.'}}]}
            return {'choices':[{'message':{'tool_calls':[{'id':str(count),'function':{'name':name,'arguments':json.dumps(args)}}]}}]}
        try:
            session = json.loads(call('/api/sessions', 'POST', {'title':'Project'}))
            call('/api/settings', 'PUT', {'base_url':'http://127.0.0.1:9/v1','model':'mock'})
            with patch.object(backend, 'stream_upstream', side_effect=model), patch.object(backend,'approve_tool',return_value=True) as approval:
                raw = call('/api/sessions/' + session['id'] + '/chat', 'POST', {'request_id':'project-workflow-http','content':'Set value to two','stream':True,'project_id':self.key,'allow_tools':True,'access_policy':'full','auto_memory':False})
            events = [json.loads(line[5:]) for line in raw.splitlines() if line.startswith('data:')]
            self.assertEqual(events[-1]['type'], 'done')
            self.assertEqual(events[-1]['verdict'], 'passed')
            self.assertEqual(count, 3)
            sessions = json.loads(call('/api/sessions'))
            self.assertEqual(sessions[0]['project_id'], self.key)
            history = json.loads(call('/api/projects/' + self.key + '/history'))
            preview = json.loads(call('/api/projects/' + self.key + '/diff', 'POST', {'checkpoint_id':history['checkpoints'][0]['id']}))
            self.assertEqual(len(preview['changes']), 1)
            call('/api/projects/' + self.key + '/rollback', 'POST', {'checkpoint_id':preview['checkpoint_id'],'revision':preview['revision']})
            self.assertEqual(file.read_text(), 'VALUE = 1\n')
            branch = json.loads(call('/api/sessions/' + session['id'] + '/branch', 'POST', {}))
            self.assertEqual(branch['project_id'], self.key)
        finally:
            app.shutdown()
            app.server_close()

    def test_http_cancel_stream_retains_partial_answer(self):
        sent = threading.Event()
        finish = threading.Event()
        class SlowAI(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Content-Type','text/event-stream')
                self.end_headers()
                self.wfile.write(b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
                self.wfile.flush()
                sent.set()
                finish.wait(10)
        ai = ThreadingHTTPServer(('127.0.0.1', 0), SlowAI)
        app = backend.LocalServer(('127.0.0.1', 0), backend.Handler)
        for server in (ai, app):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:' + str(app.server_port)
        with urlopen(Request(base + '/api/bootstrap',headers={'X-App-Token':backend.TOKEN})) as response:
            token = json.load(response)['token']
        def request(path, body=None, method='POST'):
            return Request(base + path, method=method, headers={'Content-Type':'application/json','X-App-Token':token}, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(request('/api/settings', {'base_url':'http://127.0.0.1:' + str(ai.server_port) + '/v1','model':'mock'}, 'PUT')) as response:
                response.read()
            with urlopen(request('/api/sessions', {'title':'Cancel'})) as response:
                sid = json.load(response)['id']
            stream = urlopen(request('/api/sessions/' + sid + '/chat', {'request_id':'cancel-project-stream','content':'Wait','stream':True,'project_id':self.key,'allow_tools':False,'auto_memory':False}), timeout=5)
            self.assertTrue(sent.wait(3))
            time.sleep(.15)
            with urlopen(request('/api/stream/cancel-project-stream/cancel', {})) as response:
                self.assertTrue(json.load(response)['accepted'])
            raw = stream.read().decode()
            stream.close()
            self.assertIn('"type": "cancelled"', raw)
            with urlopen(request('/api/sessions/' + sid + '/messages', method='GET')) as response:
                messages = json.load(response)
            self.assertIn('partial', messages[-1]['content'])
            self.assertIn('任务已取消', messages[-1]['content'])
            projects.idle(self.key)
        finally:
            finish.set()
            for server in (app, ai):
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
