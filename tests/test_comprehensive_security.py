"""Cross-entry security regressions, using isolated data and synthetic credentials."""
import ast
import http.client
import inspect
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import URLError
import backend
import security_net
import security_audit
import runtime_engine
import release_feed

class ComprehensiveSecurity(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.data=Path(self.folder.name)
        self.original_data=backend.DATA
        backend.DATA=self.data
        backend.initialize()
        self.addCleanup(self.cleanup)

    def cleanup(self):
        security_audit.flush_pending()
        backend.DATA=self.original_data
        self.folder.cleanup()

    def server(self):
        class QuietHandler(backend.Handler):
            def log_message(self,*args):pass
        server=backend.LocalServer(('127.0.0.1',0),QuietHandler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def request(self,server,path,method='GET',headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
        try:
            # Authentication is checked before parsing the body. Keep this probe
            # bodyless so Windows does not reset a rejected socket with unread data.
            connection.request(method,path,headers={'Content-Type':'application/json',**(headers or {})})
            response=connection.getresponse()
            response.read()
            return response.status
        finally:connection.close()

    def test_every_literal_private_route_requires_authentication(self):
        server=self.server()
        tree=ast.parse(inspect.getsource(backend))
        paths={node.value for node in ast.walk(tree) if isinstance(node,ast.Constant) and isinstance(node.value,str) and node.value.startswith('/api/') and '?' not in node.value}
        paths.discard('/api/health')
        for path in sorted(paths):
            for method in ('GET','POST','PUT','DELETE'):
                with self.subTest(path=path,method=method):
                    self.assertEqual(self.request(server,path,method),403)
        self.assertGreater(len(paths),50)

    def test_authenticated_cross_origin_and_host_requests_rejected(self):
        server=self.server()
        for headers in [{'Origin':'http://evil.example'},{'Sec-Fetch-Site':'cross-site'},{'Host':'evil.example'}]:
            self.assertEqual(self.request(server,'/api/bootstrap',headers={'X-App-Token':backend.TOKEN,**headers}),403)
        self.assertEqual(self.request(server,'/api/bootstrap',headers={'X-App-Token':backend.TOKEN}),200)

    def test_default_initialization_and_local_reads_do_not_connect_externally(self):
        server=self.server()
        destinations=[]
        original=socket.socket.connect
        def connect(stream,address):
            destinations.append(address[0])
            if address[0] not in ('127.0.0.1','::1'):raise AssertionError('unexpected external connection')
            return original(stream,address)
        with patch.object(socket.socket,'connect',connect):
            backend.initialize()
            for path in ('/api/health','/api/bootstrap','/api/profile','/api/settings','/api/runtime','/api/capabilities'):
                self.assertEqual(self.request(server,path,headers={'X-App-Token':backend.TOKEN}),200)
        self.assertTrue(destinations)

    def test_live_permission_revocation_reaches_next_tool(self):
        runtime_engine.save_settings(self.data,{'access_policy':'full'})
        c=backend.request_config({'access_policy':'full','allow_tools':True})
        self.assertEqual(c['access_policy'],'full')
        runtime_engine.save_settings(self.data,{'access_policy':'deny'})
        backend.refresh_live_permissions(c)
        self.assertEqual(c['access_policy'],'deny')
        self.assertFalse(c['auto_memory'])
        self.assertFalse(runtime_engine.authorize('execute_command',{'argv':['whoami']},c,True,lambda *args:True))

    def test_live_policy_tightening_never_increases_task_privileges(self):
        runtime_engine.save_settings(self.data,{'access_policy':'full'})
        c=backend.request_config({'access_policy':'ask'})
        backend.refresh_live_permissions(c)
        self.assertEqual(c['access_policy'],'ask')
        runtime_engine.save_settings(self.data,{'access_policy':'trusted','trusted_commands':[]})
        backend.refresh_live_permissions(c)
        self.assertEqual(c['trusted_commands'],[])

    def test_remote_image_download_cannot_connect_to_loopback(self):
        for host in ('127.0.0.1','::1','::ffff:127.0.0.1'):
            family=socket.AF_INET6 if ':' in host else socket.AF_INET
            with self.subTest(host=host),patch.object(socket,'getaddrinfo',return_value=[(family,socket.SOCK_STREAM,6,'',(host,443))]),patch.object(socket,'socket') as factory:
                with self.assertRaises((ValueError,URLError)):
                    security_net.opener(allow_loopback=False).open('https://image.example/result',timeout=1)
                factory.assert_not_called()

    def test_update_redirect_cannot_escape_official_https_hosts(self):
        redirect=release_feed.Redirect()
        for url in ('http://github.com/a','https://evil.example/a','https://github.com:444/a','https://user:pass@github.com/a','https://127.0.0.1/a'):
            with self.subTest(url=url),self.assertRaises(ValueError):
                redirect.redirect_request(None,None,302,'',{},url)

    def test_pending_approval_cannot_override_a_new_deny_policy(self):
        runtime_engine.save_settings(self.data,{'access_policy':'ask'})
        c=backend.request_config({'allow_tools':True})
        c['tools']=['execute_command']
        c['model']='mock'
        c['base_url']='http://127.0.0.1:1/v1'
        calls=[]
        def model(config,payload,emit):
            calls.append(1)
            if len(calls)>1:return {'choices':[{'message':{'content':'stopped'}}]}
            return {'choices':[{'message':{'tool_calls':[{'id':'revoked','function':{'name':'execute_command','arguments':'{"argv":["whoami"]}'}}]}}]}
        def approve(*args):
            runtime_engine.save_settings(self.data,{'access_policy':'deny'})
            return True
        with patch.object(backend,'stream_upstream',side_effect=model),patch.object(backend,'approve_tool',side_effect=approve),patch.object(backend.agent_environment,'command') as command:
            self.assertEqual(backend.completion(c,[{'role':'user','content':'test'}],lambda event:None),'stopped')
            command.assert_not_called()

    def test_full_access_revoked_while_model_is_running_blocks_dispatch(self):
        runtime_engine.save_settings(self.data,{'access_policy':'full'})
        c=backend.request_config({'allow_tools':True})
        c['tools']=['execute_command']
        c['model']='mock'
        c['base_url']='http://127.0.0.1:1/v1'
        calls=[]
        def model(config,payload,emit):
            calls.append(1)
            if len(calls)>1:return {'choices':[{'message':{'content':'stopped'}}]}
            runtime_engine.save_settings(self.data,{'access_policy':'deny'})
            return {'choices':[{'message':{'tool_calls':[{'id':'revoked','function':{'name':'execute_command','arguments':'{"argv":["whoami"]}'}}]}}]}
        with patch.object(backend,'stream_upstream',side_effect=model),patch.object(backend.agent_environment,'command') as command:
            self.assertEqual(backend.completion(c,[{'role':'user','content':'test'}],lambda event:None),'stopped')
            command.assert_not_called()

    def test_native_reader_disables_implicit_curl_config(self):
        from types import SimpleNamespace
        import agent_hub
        calls=[]
        def run(argv,**kwargs):
            calls.append(argv)
            Path(argv[argv.index('--dump-header')+1]).write_text('HTTP/1.1 200 OK\nContent-Type: text/plain\n\n',encoding='ascii')
            Path(argv[argv.index('--output')+1]).write_bytes(b'local fixture')
            return SimpleNamespace(returncode=0,stdout=b'200')
        with patch.object(agent_hub.shutil,'which',return_value='curl.exe'),patch.object(agent_hub.subprocess,'run',side_effect=run):
            response=agent_hub.native_windows_fetch('example.com',443,'93.184.216.34','https://example.com/')
        self.assertEqual(calls[0][1],'--disable')
        self.assertEqual(response.read(100),b'local fixture')

    def test_manual_project_verification_respects_deny(self):
        import project_workspace
        project_root=self.data.parent/(self.data.name+'-project')
        project_root.mkdir()
        self.addCleanup(project_root.rmdir)
        project=project_workspace.save(self.data,{'name':'Security fixture','path':str(project_root),'checks':[{'name':'fixture','argv':['whoami']}]})
        runtime_engine.save_settings(self.data,{'access_policy':'deny'})
        c=backend.request_config({'project_id':project['id']})
        with patch.object(backend.agent_environment,'command') as command:
            result=backend.verify_project(c,None,manual=True)
        command.assert_not_called()
        self.assertNotEqual(result['verdict'],'passed')

    def test_live_refresh_preserves_explicit_per_request_permissions(self):
        c=backend.request_config({'access_policy':'ask','file_permission':'all','command_permission':'ask','command_mode':'host'})
        backend.refresh_live_permissions(c)
        self.assertEqual(c['file_permission'],'all')
        self.assertEqual(c['command_permission'],'ask')
        self.assertEqual(c['command_mode'],'host')

    def test_full_downgrade_restores_original_subpermissions(self):
        runtime_engine.save_settings(self.data,{'access_policy':'full'})
        c=backend.request_config({'file_permission':'read','command_permission':'none','command_mode':'sandbox'})
        self.assertEqual(c['command_permission'],'all')
        runtime_engine.save_settings(self.data,{'access_policy':'ask'})
        backend.refresh_live_permissions(c)
        self.assertEqual(c['file_permission'],'read')
        self.assertEqual(c['command_permission'],'none')
        self.assertEqual(c['command_mode'],'sandbox')
