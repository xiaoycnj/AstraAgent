"""Adversarial regressions for ASTRA-SEC-2026-1106-02. Synthetic credentials only."""
import base64
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_environment
import agent_hub
import attachments
import backend
import local_account
import mcp_client
import project_workspace
import runtime_engine
import sandbox_worker
import security_audit
import security_core
import security_net
import security_server
import workbench
import workspace_tools


class Security(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.data = self.root / 'data'
        self.data.mkdir()

    def tearDown(self):
        mcp_client.close_all()
        self.temporary.cleanup()

    def test_legacy_credentials_migrate_and_roundtrip_without_plaintext(self):
        key = 'sk-' + 'syntheticTestOnly' * 3
        for name, value in [('settings.json', {'api_key': key, 'model': 'local'}),
                            ('providers.json', [{'id': 'one', 'api_key': key}]),
                            ('tts.json', {'api_key': key}), ('stt.json', {'api_key': key})]:
            path = self.data / name
            path.write_text(json.dumps(value), encoding='utf-8')
            self.assertEqual(security_core.read_config(path, {}), value)
            self.assertNotIn(key, path.read_text())
            self.assertNotIn('"api_key":', path.read_text())
            self.assertEqual(security_core.read_config(path, {}), value)
        security_core.write_config(self.data / 'tts.json', {'api_key': ''})
        self.assertNotIn('api_key_dpapi', (self.data / 'tts.json').read_text())
        self.assertNotIn('api_key_dpapi', backend.public_config({'api_key': key, 'api_key_dpapi': 'hidden'}))

    def test_migration_failure_preserves_original_file(self):
        path = self.data / 'settings.json'
        raw = '{"api_key":"synthetic-legacy-key"}'
        path.write_text(raw)
        with patch.object(security_core, 'protect', side_effect=ValueError('DPAPI unavailable')):
            with self.assertRaises(ValueError):
                security_core.read_config(path, {})
        self.assertEqual(path.read_text(), raw)
        self.assertFalse(list(self.data.glob('*.tmp')))

    def test_path_device_aliases_rejected_by_all_file_entry_points(self):
        root = self.root / 'project'
        root.mkdir()
        for value in ['CON', 'aux.txt', 'CON .txt', 'x\n.txt', 'NUL.json', 'com1.log', 'LPT9', 'COM¹',
                      'a./file', 'a /file', 'x.txt ', 'x.txt.', '../secret',
                      'a:stream', '\\\\.\\PhysicalDrive0', '/outside']:
            with self.subTest(value=value):
                for call in [lambda: workspace_tools.target(root, value),
                             lambda: project_workspace.target(root, value),
                             lambda: workbench.file_path(self.data, value, root),
                             lambda: sandbox_worker.execute(root, ['cat', value])]:
                    with self.assertRaises((ValueError, OSError)):
                        call()
        self.assertEqual(workspace_tools.target(root, 'normal/file.txt'), root / 'normal/file.txt')

    def test_private_configs_cannot_be_reached_via_project_root(self):
        security_core.PRIVATE_ROOTS.add(self.data.resolve())
        (self.data / 'settings.json').write_text('{}')
        with self.assertRaises(ValueError):
            project_workspace.target(self.root, 'data/settings.json')
        with self.assertRaises(ValueError):
            workbench.file_path(self.data, 'data/settings.json', self.root)
        (self.data / 'files').mkdir()
        self.assertEqual(workspace_tools.target(self.data / 'files', 'safe.txt'), self.data / 'files/safe.txt')

    def test_policy_keeps_sub_permissions_and_external_mutations_require_approval(self):
        (self.root / 'skills/general').mkdir(parents=True)
        (self.root / 'skills/general/SKILL.md').write_text('# Assistant\nHelp')
        with patch.object(backend, 'ROOT', self.root), patch.object(backend, 'DATA', self.data):
            for policy in ('ask', 'trusted'):
                c = backend.request_config({'access_policy': policy, 'file_permission': 'read',
                                            'command_permission': 'ask', 'command_mode': 'sandbox'})
                self.assertEqual((c['file_permission'], c['command_permission'], c['command_mode']),
                                 ('read', 'ask', 'sandbox'))
        self.assertEqual(runtime_engine.DEFAULTS['access_policy'], 'ask')
        for policy in ('full', 'trusted', 'ask'):
            c = {'access_policy': policy, '_untrusted_context': True}
            self.assertFalse(runtime_engine.authorize('write_file', {}, c, lambda e: None, lambda *a: False))
            self.assertTrue(runtime_engine.authorize('write_file', {}, c, lambda e: None, lambda *a: True))
        self.assertFalse(runtime_engine.authorize('project_verify', {}, {'access_policy': 'trusted'}, None, lambda *a: True))

    def test_unauthenticated_bootstrap_and_reads_rejected_cookie_resources_work(self):
        with patch.object(backend, 'DATA', self.data):
            app = backend.LocalServer(('127.0.0.1', 0), backend.Handler)
            threading.Thread(target=app.serve_forever, daemon=True).start()
            base = 'http://127.0.0.1:' + str(app.server_port)
            try:
                for path in ('/api/bootstrap', '/api/settings', '/api/security/audit'):
                    with self.assertRaises(HTTPError) as caught:
                        urlopen(base + path)
                    self.assertEqual(caught.exception.code, 403)
                    caught.exception.close()
                with urlopen(Request(base + '/api/bootstrap', headers={'X-App-Token': backend.TOKEN})) as response:
                    cookie = response.headers['Set-Cookie']
                    self.assertIn('HttpOnly', cookie)
                    self.assertIn('SameSite=Strict', cookie)
                    self.assertEqual(json.load(response)['token'], backend.TOKEN)
                with urlopen(Request(base + '/api/settings', headers={'Cookie': cookie.split(';')[0]})) as response:
                    self.assertNotIn('api_key', json.load(response))
                with urlopen(base + '/') as response:
                    policy = response.headers['Content-Security-Policy']
                    self.assertNotIn('unsafe-inline', policy)
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(base + '/api/settings', headers={'X-App-Token': backend.TOKEN, 'Origin': 'https://evil.example'}))
                self.assertEqual(caught.exception.code, 403)
                caught.exception.close()
            finally:
                app.shutdown()
                app.server_close()

    def test_secrets_blocked_in_automatic_manual_and_tree_memory(self):
        samples = ['sk-' + 'a' * 40, 'ghp_' + 'x' * 40,
                   'password=syntheticPassword', '-----BEGIN PRIVATE KEY-----']
        for secret in samples:
            with self.assertRaises(ValueError):
                security_core.reject_secrets(secret)
            result = agent_environment.save_memory(self.root, {'content': secret}, {'memory_policy': 'auto'}, None, None)
            self.assertIn('error', result)
            with self.assertRaises(ValueError):
                agent_hub.world_record(self.root, self.data, {'action': 'create', 'title': 'Test', 'content': secret})
        folder = self.root / 'memory'
        folder.mkdir(exist_ok=True)
        (folder / 'old.md').write_text(samples[0])
        self.assertEqual(local_account.memories(self.root), [])
        self.assertTrue((folder / 'old.md').exists())
        security_core.reject_secrets('用户喜欢 Python 和蓝色主题')

    def test_docx_entry_count_ratio_and_duplicates_rejected(self):
        for mode in ('entries', 'ratio', 'duplicate'):
            raw = io.BytesIO()
            with zipfile.ZipFile(raw, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('word/document.xml', '<document>ok</document>')
                if mode == 'entries':
                    for index in range(501):
                        archive.writestr(str(index), '')
                elif mode == 'ratio':
                    archive.writestr('large', 'a' * 1_000_000)
                else:
                    archive.writestr('word/document.xml', '<document>duplicate</document>')
            with self.assertRaises(ValueError):
                attachments.extract(raw.getvalue(), 'test.docx')

    def test_transport_rejects_plaintext_remote_and_metadata_and_pins_dns(self):
        for url in ('http://api.example/v1', 'http://10.0.0.1/v1', 'https://user:pass@example.com'):
            with self.assertRaises(ValueError):
                security_net.validate_url(url)
        security_net.validate_url('http://127.0.0.1:1234/v1')
        security_net.validate_url('https://example.com/v1')
        for address in ('169.254.169.254', '0.0.0.0', '224.0.0.1', 'fe80::1', '10.0.0.1'):
            family = socket.AF_INET6 if ':' in address else socket.AF_INET
            with patch.object(socket, 'getaddrinfo', return_value=[(family, socket.SOCK_STREAM, 6, '', (address, 443))]):
                with self.assertRaises(ValueError):
                    security_net.addresses('api.example', 443)
                if address == '10.0.0.1':
                    self.assertTrue(security_net.addresses('api.example', 443, True))
                else:
                    with self.assertRaises(ValueError):
                        security_net.addresses('api.example', 443, True)
        with patch.object(socket, 'getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 80))]), \
             patch.object(socket, 'socket') as factory:
            with self.assertRaises(Exception):
                security_net.opener().open('http://localhost/test', timeout=1)
            self.assertIn(unittest.mock.call().connect(('127.0.0.1', 80)), factory.mock_calls)

    def test_mcp_script_tampering_invalidates_protected_trust(self):
        script = self.root / 'mcp.py'
        script.write_text('print("not started")')
        config = {'id': 'fixture', 'command': sys.executable, 'args': [str(script)], 'enabled': True}
        with self.assertRaises(ValueError):
            mcp_client.client(self.data, config)
        mcp_client.trust(self.data, config, mcp_client.fingerprint(config))
        mcp_client.require_trust(self.data, config)
        script.write_text('print("tampered")')
        with patch.object(mcp_client, 'Client') as start:
            with self.assertRaises(ValueError):
                mcp_client.client(self.data, config)
            start.assert_not_called()

    def test_multiple_mcp_servers_skip_untrusted_rows_and_ignore_forged_catalog(self):
        for key in ('untrusted','trusted'):
            mcp_client.save(self.data,{'id':key,'command':sys.executable,'args':['-u'],'enabled':True})
        config=mcp_client.configs(self.data)[1]
        fingerprint=mcp_client.fingerprint(config)
        mcp_client.trust(self.data,config,fingerprint)
        tools=[{'alias':'mcp_real','name':'echo','description':'safe','schema':{'type':'object'}}]
        cache={'trusted':{'fingerprint':fingerprint,'tools':tools}}
        security_core.atomic_write(self.data/'mcp-tools.dpapi',security_core.protect(json.dumps(cache).encode(),True))
        rows=mcp_client.configs(self.data)
        rows[1]['tools']=[{'alias':'mcp_evil','name':'wrong'}]
        (self.data/'mcp.json').write_text(json.dumps(rows))
        self.assertEqual([item['function']['name'] for item in mcp_client.definitions(self.data)],['mcp_real'])
        with patch.object(mcp_client,'client') as client:
            mcp_client.call(self.data,'mcp_real',{'text':'hello'})
            client.return_value.rpc.assert_called_once_with('tools/call',{'name':'echo','arguments':{'text':'hello'}})

    def test_external_provenance_is_durable(self):
        with patch.object(backend,'ROOT',self.root),patch.object(backend,'DATA',self.data):
            backend.initialize()
            with backend.database() as db:db.execute("INSERT INTO sessions(id,title) VALUES('one','test')")
            config={'_session_id':'one'}
            backend.mark_untrusted(config)
            self.assertTrue(config['_untrusted_context'])
            with backend.database() as db:
                self.assertEqual(db.execute("SELECT untrusted_context FROM sessions WHERE id='one'").fetchone()[0],1)

    def test_layered_file_approval_occurs_once(self):
        folder=self.data/'files';folder.mkdir();(folder/'a.txt').write_text('safe')
        replies=[{'choices':[{'message':{'tool_calls':[{'id':'one','function':{
            'name':'read_file','arguments':'{"path":"a.txt"}'}}]}}]},
                 {'choices':[{'message':{'content':'done'}}]}]
        config={'model':'mock','tools':['read_file'],'file_permission':'ask','access_policy':'trusted'}
        with patch.object(backend,'DATA',self.data),patch.object(backend.local_account,'context',return_value=''), \
             patch.object(backend,'stream_upstream',side_effect=replies),patch.object(backend,'approve_tool',return_value=True) as approve:
            self.assertEqual(backend.completion(config,[{'role':'user','content':'read'}],lambda e:None),'done')
            self.assertEqual(approve.call_count,1)

    def test_durable_audit_redacts_payload_and_failure_prevents_dispatch(self):
        args = {'path': 'private-name.txt', 'content': 'synthetic file contents'}
        key = security_audit.append(self.data, 'attempt', 'write_file', args, {})
        security_audit.append(self.data, 'authorization', 'write_file', args, {}, key, 'denied')
        raw = (self.data / 'security-audit.jsonl').read_text()
        self.assertNotIn(args['content'], raw)
        self.assertNotIn(args['path'], raw)
        self.assertEqual(len(security_audit.recent(self.data)), 2)
        reply = {'choices': [{'message': {'tool_calls': [{'id': 'x', 'function': {
            'name': 'write_file', 'arguments': json.dumps(args)}}]}}]}
        config = {'model': 'test', 'tools': ['write_file'], 'access_policy': 'full', 'file_permission': 'all'}
        with patch.object(backend, 'DATA', self.data), patch.object(backend.local_account, 'context', return_value=''), \
             patch.object(backend, 'stream_upstream', return_value=reply), \
             patch.object(security_audit, 'append', side_effect=OSError('disk unavailable')), \
             patch.object(backend, 'run_file_tool') as write:
            with self.assertRaises(OSError):
                backend.completion(config, [{'role': 'user', 'content': 'write'}], lambda e: None)
            write.assert_not_called()

    def test_rate_and_concurrency_limits(self):
        with patch.object(security_server, 'REQUESTS', security_server.deque()), \
             patch.object(security_server, 'EXPENSIVE', security_server.deque()):
            for _ in range(60):
                self.assertTrue(security_server.allow('/api/stt', 'POST'))
            self.assertFalse(security_server.allow('/api/stt', 'POST'))
            self.assertTrue(security_server.allow('/api/stream/id', 'GET'))
        with patch.object(security_server, 'UPSTREAM', threading.BoundedSemaphore(1)):
            self.assertEqual(security_server.limited(lambda: 1), 1)
            security_server.UPSTREAM.acquire()
            with self.assertRaises(ValueError):
                security_server.limited(lambda: self.fail('must not call'))


if __name__ == '__main__':
    unittest.main()
