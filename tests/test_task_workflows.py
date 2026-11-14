"""Task acceptance, partial review, and the Docker execution boundary."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend
import attachments
import agent_environment
import container_runtime
import project_workspace as projects
import runtime_engine
import task_evaluations as evaluations
import task_control

IMAGE = 'sha256:' + 'a' * 64


class Workflows(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / 'data'
        self.project = self.root / 'project'
        self.project.mkdir()
        self.data_patch = patch.object(backend, 'DATA', self.data)
        self.data_patch.start()
        backend.initialize()
        self.record = projects.save(self.data, {'name': 'Fixture', 'path': str(self.project)})
        self.key = self.record['id']

    def tearDown(self):
        projects.LEASES.pop(self.key, None)
        self.data_patch.stop()
        self.temp.cleanup()

    def test_keep_and_revert_only_selected_hunk(self):
        path = self.project / 'sample.txt'
        before = ''.join('line ' + str(index) + '\n' for index in range(40))
        path.write_text(before, encoding='utf-8')
        (self.project / 'other.txt').write_text('unchanged')
        point = projects.checkpoint(self.data, self.key)
        after = before.replace('line 2\n', 'first edit\n').replace('line 33\n', 'second edit\n')
        path.write_text(after, encoding='utf-8')
        preview = projects.diff(self.data, self.key, point['id'])
        change = preview['changes'][0]
        self.assertEqual(len(change['hunks']), 2)
        body = {'checkpoint_id': point['id'], 'revision': preview['revision'], 'path': 'sample.txt', 'hunk_id': change['hunks'][1]['id']}
        projects.review(self.data, self.key, {**body, 'action': 'keep'})
        self.assertTrue(projects.diff(self.data, self.key, point['id'])['changes'][0]['hunks'][1]['reviewed'])
        result = projects.review(self.data, self.key, {**body, 'hunk_id': change['hunks'][0]['id'], 'action': 'revert'})
        self.assertEqual(path.read_text(), before.replace('line 33\n', 'second edit\n'))
        self.assertEqual((self.project / 'other.txt').read_text(), 'unchanged')
        undo = projects.diff(self.data, self.key, result['undo_checkpoint'])
        projects.rollback(self.data, self.key, result['undo_checkpoint'], undo['revision'])
        self.assertEqual(path.read_text(), after)

    def test_review_rejects_stale_revision_and_busy_project(self):
        path = self.project / 'sample.txt'
        path.write_text('before')
        point = projects.checkpoint(self.data, self.key)
        path.write_text('after')
        preview = projects.diff(self.data, self.key, point['id'])
        body = {'checkpoint_id': point['id'], 'revision': preview['revision'], 'path': 'sample.txt', 'action': 'revert'}
        path.write_text('external edit')
        with self.assertRaises(FileExistsError):
            projects.review(self.data, self.key, body)
        self.assertEqual(path.read_text(), 'external edit')
        projects.acquire(self.key, 'other-window')
        with self.assertRaises(ValueError):
            projects.review(self.data, self.key, body)

    def test_file_review_handles_added_deleted_and_binary_files(self):
        path = self.project / 'old.bin'
        path.write_bytes(b'old\0data')
        point = projects.checkpoint(self.data, self.key)
        path.unlink()
        (self.project / 'new.txt').write_text('new')
        for name in ('old.bin', 'new.txt'):
            preview = projects.diff(self.data, self.key, point['id'])
            projects.review(self.data, self.key, {'checkpoint_id': point['id'], 'revision': preview['revision'], 'path': name, 'action': 'revert'})
        self.assertEqual(path.read_bytes(), b'old\0data')
        self.assertFalse((self.project / 'new.txt').exists())

    def test_evaluation_requires_changed_artifacts_and_human_review(self):
        spec = {**evaluations.TEMPLATES[1], 'project_id': self.key}
        with backend.database() as db:
            case = evaluations.save(db, self.data, spec)
            run = evaluations.start(db, self.data, case['id'])
            evaluations.bind(db, run['session']['id'], 'agent-run')
        (self.project / 'index.html').write_text('<html>fixture</html>')
        item = attachments.upload(self.data, {'name': 'index.html', 'data': base64.b64encode(b'<html>fixture</html>').decode()})
        with backend.database() as db:
            db.execute('INSERT INTO session_outputs(session_id,attachment_id) VALUES(?,?)', (run['session']['id'], item['id']))
            result = evaluations.finish(db, self.data, run['session']['id'], 'agent-run', 'done')
            self.assertEqual(result['status'], 'needs_review')
            self.assertTrue(result['automated_passed'])
            evaluations.review(db, run['id'], {'outcome': 'passed', 'note': 'Checked rendering'})
            self.assertEqual(evaluations.catalog(db)['runs'][0]['status'], 'passed')
            second = evaluations.start(db, self.data, case['id'])
            evaluations.bind(db, second['session']['id'], 'second-run')
            result = evaluations.finish(db, self.data, second['session']['id'], 'second-run', 'done')
            self.assertEqual(result['status'], 'failed')
            self.assertFalse(result['evidence'][1]['passed'])

    def test_case_edit_does_not_change_running_snapshot_and_cancellation_fails(self):
        spec = {**evaluations.TEMPLATES[3], 'project_id': self.key}
        with backend.database() as db:
            case = evaluations.save(db, self.data, spec)
            run = evaluations.start(db, self.data, case['id'])
            evaluations.bind(db, run['session']['id'], 'agent-run')
            evaluations.save(db, self.data, {**case, 'name': 'Changed case', 'expected_files': []})
            result = evaluations.finish(db, self.data, run['session']['id'], 'agent-run', 'cancelled')
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(evaluations.catalog(db)['runs'][0]['spec']['name'], spec['name'])
            with self.assertRaises(ValueError):
                evaluations.review(db, run['id'], {'outcome': 'passed'})
            self.assertIsNone(evaluations.finish(db, self.data, run['session']['id'], 'unrelated-run', 'done'))

    def test_coding_verification_must_match_run_and_file_revision(self):
        with backend.database() as db:
            case = evaluations.save(db, self.data, {**evaluations.TEMPLATES[0], 'project_id': self.key, 'manual_review': False})
            run = evaluations.start(db, self.data, case['id'])
            evaluations.bind(db, run['session']['id'], 'coding-run')
        (self.project / 'code.py').write_text('VALUE=1')
        checks = [{'name': 'test', 'argv': ['python', 'test.py']}]
        projects.verify(self.data, self.key, checks, lambda check: {'exit_code': 0}, 'other-run')
        with backend.database() as db:
            self.assertEqual(evaluations.finish(db, self.data, run['session']['id'], 'coding-run', 'done')['status'], 'failed')
        projects.verify(self.data, self.key, checks, lambda check: {'exit_code': 0}, 'coding-run')
        with backend.database() as db:
            self.assertEqual(evaluations.finish(db, self.data, run['session']['id'], 'coding-run', 'done')['status'], 'passed')
        (self.project / 'code.py').write_text('VALUE=2')
        with backend.database() as db:
            self.assertEqual(evaluations.finish(db, self.data, run['session']['id'], 'coding-run', 'done')['status'], 'failed')

    def test_full_policy_preserves_container_and_revocation(self):
        runtime_engine.save_settings(self.data, {'access_policy': 'full', 'container_image': IMAGE, 'container_network': True})
        config = backend.request_config({'command_mode': 'container'})
        self.assertEqual(config['command_mode'], 'container')
        self.assertEqual(config['container_image'], IMAGE)
        runtime_engine.save_settings(self.data, {'container_network': False, 'container_memory_mb': 256})
        backend.refresh_live_permissions(config)
        self.assertFalse(config['container_network'])
        self.assertEqual(config['container_memory_mb'], 256)
        runtime_engine.save_settings(self.data, {'container_image': ''})
        backend.refresh_live_permissions(config)
        self.assertEqual(config['container_image'], '')

    def test_http_chat_automatically_records_real_file_acceptance(self):
        runtime_engine.save_settings(self.data, {'access_policy': 'full'})
        with backend.database() as db:
            case = evaluations.save(db, self.data, {**evaluations.TEMPLATES[1], 'project_id': self.key})
            run = evaluations.start(db, self.data, case['id'])
        responses = [
            {'choices': [{'message': {'tool_calls': [{'id': 'write-artifact', 'function': {'name': 'write_file', 'arguments': json.dumps({'path': 'index.html', 'content': '<html>Acceptance fixture</html>', 'deliver': True})}}]}}]},
            {'choices': [{'message': {'content': '已交付'}}]},
        ]
        server = backend.LocalServer(('127.0.0.1', 0), backend.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        settings = {**backend.DEFAULTS, 'model': 'fixture', 'base_url': 'https://example.test/v1'}
        body = {'content': run['prompt'], 'stream': True, 'request_id': 'evaluation-http-fixture-123', 'allow_tools': True, 'tools': ['write_file'], 'project_id': self.key, 'file_permission': 'all'}
        try:
            with patch.object(backend, 'config', return_value=settings), patch.object(backend, 'stream_upstream', side_effect=responses), patch.object(backend, 'approve_tool', return_value=True):
                request = Request('http://127.0.0.1:' + str(server.server_port) + '/api/sessions/' + run['session']['id'] + '/chat', data=json.dumps(body).encode(), headers={'X-App-Token': backend.TOKEN, 'Content-Type': 'application/json'})
                with urlopen(request, timeout=30) as response:
                    stream = response.read().decode('utf-8')
                self.assertIn('"status": "needs_review"', stream)
                with backend.database() as db:
                    stored = evaluations.catalog(db)['runs'][0]
                    self.assertEqual(stored['status'], 'needs_review')
                    self.assertTrue(stored['result']['automated_passed'])
                    self.assertTrue(stored['agent_run_id'])
        finally:
            server.shutdown()
            server.server_close()


class ContainerBoundary(unittest.TestCase):
    def test_cancelled_task_never_starts_docker(self):
        token = task_control.Token()
        token.cancel()
        with patch.object(container_runtime, 'status') as status, self.assertRaises(task_control.Cancelled):
            container_runtime.execute(Path('.'), ['python'], {'_cancel_token': token})
        status.assert_not_called()

    def test_command_line_has_explicit_isolation_and_no_image_pull(self):
        args = container_runtime.command_line('docker', Path('C:/space, path'), ['python', '-c', 'print(1)'], {'container_image': IMAGE, 'file_permission': 'all'}, 'astra-fixture')
        for flag in ('--read-only', '--pull=never', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--log-driver=none'):
            self.assertIn(flag, args)
        self.assertEqual(args[args.index('--network') + 1], 'none')
        self.assertEqual(args[args.index('--entrypoint') + 1], 'python')
        self.assertEqual(args[-3:], [IMAGE, '-c', 'print(1)'])
        with self.assertRaises(ValueError):
            container_runtime.command_line('docker', Path('.'), ['python'], {'container_image': 'untrusted:latest'}, 'astra-fixture')

    def test_container_mount_obeys_file_permissions(self):
        config = {'container_image': IMAGE, 'file_permission': 'read'}
        args = container_runtime.command_line('docker', Path('.'), ['python'], config, 'astra-fixture')
        self.assertIn('readonly', args[args.index('--mount') + 1])
        with self.assertRaises(ValueError):
            container_runtime.command_line('docker', Path('.'), ['python'], {**config, 'file_permission': 'none'}, 'astra-fixture')
        with patch.object(container_runtime, 'status') as status:
            result = agent_environment.command(Path('.'), Path('.'), {'argv': ['python']}, {'command_permission': 'all', 'command_mode': 'container', 'file_permission': 'none'}, None, None)
            self.assertIn('error', result)
            status.assert_not_called()
        self.assertFalse(runtime_engine.authorize('execute_command', {'argv': ['git', 'status']}, {'access_policy': 'trusted', 'command_mode': 'container', 'file_permission': 'ask'}, True, lambda *args: False))

    def test_missing_or_remote_engine_never_runs_host_command(self):
        with patch.object(container_runtime.shutil, 'which', return_value=None), patch.object(container_runtime.subprocess, 'Popen') as process:
            self.assertFalse(container_runtime.status()['available'])
            self.assertIn('error', container_runtime.execute(Path('.'), ['python'], {}))
            process.assert_not_called()
        with patch.object(container_runtime.shutil, 'which', return_value='docker'), patch.object(container_runtime, 'inspect_docker', return_value='tcp://remote:2375'):
            self.assertFalse(container_runtime.status()['available'])

    def test_denied_command_does_not_probe_docker(self):
        with patch.object(container_runtime, 'status') as status:
            result = agent_environment.command(Path('.'), Path('.'), {'argv': ['python']}, {'command_mode': 'container', 'command_permission': 'none'}, None, None)
            self.assertIn('error', result)
            status.assert_not_called()

    def test_bounded_output_and_container_cleanup(self):
        popen = subprocess.Popen
        def process(*args, **kwargs):
            return popen([sys.executable, '-c', 'print("x"*100000)'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        with tempfile.TemporaryDirectory() as folder, patch.object(container_runtime, 'status', return_value={'available': True}), patch.object(container_runtime.shutil, 'which', return_value='docker'), patch.object(container_runtime.subprocess, 'Popen', side_effect=process), patch.object(container_runtime.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)) as cleanup:
            result = container_runtime.execute(Path(folder), ['python'], {'container_image': IMAGE, 'file_permission': 'all'})
            self.assertTrue(result['isolated'])
            self.assertEqual(len(result['output']), 64000)
            self.assertTrue(result['truncated'])
            self.assertEqual(cleanup.call_args.args[0][1:3], ['rm', '--force'])

    def test_invalid_container_settings_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            for body in ({'container_image': 0}, {'container_image': 'latest'}, {'container_memory_mb': True}, {'container_network': 'yes'}):
                with self.subTest(body=body), self.assertRaises(ValueError):
                    runtime_engine.save_settings(Path(folder), body)


if __name__ == '__main__':
    unittest.main()
