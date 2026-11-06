"""Checkpoint and OAuth transport regressions without personal credentials."""
import base64
import io
import json
import os
from pathlib import Path
import socket
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import extensions
import openai_oauth as oauth
import openai_responses as responses
import runtime_engine as engine
import backend

class ContextOAuth(unittest.TestCase):
    def test_summary_keeps_middle_and_fails_atomically(self):
        sent=[]
        def fake(c,e,p):
            sent.append(p);return {'choices':[{'message':{'content':'checkpoint'}}]}
        engine.summarize({'model':'mock','context_chars':12000},[{'role':'user','content':'start'+('x'*10000)+'MIDDLE_REQUIRED'+('y'*10000)+'end'}],fake)
        self.assertIn('MIDDLE_REQUIRED',''.join(json.dumps(p) for p in sent));self.assertGreater(len(sent),1)
        payload={'messages':[{'role':'system','content':'PINNED'}, {'role':'user','content':'old'*10000},{'role':'assistant','content':'old answer'},{'role':'user','content':'LATEST EXACT'}]}
        original=json.dumps(payload)
        with self.assertRaises(ValueError):engine.compact_payload({'model':'mock','auto_compact':True,'context_chars':12000},payload,lambda *a:{'choices':[{'message':{'content':''}}]},None)
        self.assertEqual(json.dumps(payload),original)
    def test_tool_pair_and_user_are_retained(self):
        messages=[{'role':'system','content':'PINNED'},{'role':'user','content':'LATEST EXACT'}]
        for i in range(3):messages.extend([{'role':'assistant','tool_calls':[{'id':str(i),'type':'function','function':{'name':'read_file','arguments':'{}'}}]},{'role':'tool','tool_call_id':str(i),'content':'x'*8000}])
        payload={'messages':messages};events=[]
        engine.compact_payload({'model':'mock','auto_compact':True,'context_chars':12000},payload,lambda *a:{'choices':[{'message':{'content':'summary'}}]},events.append)
        self.assertEqual(payload['messages'][0]['content'],'PINNED')
        self.assertIn({'role':'user','content':'LATEST EXACT'},payload['messages'])
        self.assertEqual(payload['messages'][-2:],messages[-2:]);self.assertTrue(events)
    def test_payload_multimodal_and_tools(self):
        payload=responses.payload_for({'model':'mock','messages':[{'role':'user','content':[{'type':'text','text':'hello'},{'type':'image_url','image_url':{'url':'data:image/png;base64,AA=='}}]},{'role':'assistant','tool_calls':[{'id':'call1','function':{'name':'read_file','arguments':'{}'}}]},{'role':'tool','tool_call_id':'call1','content':'ok'}],'tools':[{'type':'function','function':{'name':'read_file','parameters':{'type':'object'}}}]})
        self.assertFalse(payload['store']);self.assertTrue(payload['stream']);self.assertEqual(payload['input'][2]['call_id'],'call1');self.assertEqual(payload['tools'][0]['name'],'read_file')
    def test_stream_requires_completed_and_returns_calls(self):
        events=[{'type':'response.output_text.delta','delta':'Hello'}, {'type':'response.completed','response':{'status':'completed','output':[{'type':'function_call','call_id':'abc','name':'read_file','arguments':'{}'}]}}]
        class Opener:
            def open(self,*args,**kwargs):return io.BytesIO(''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode())
        with patch.object(oauth.Manager,'access_token',return_value='mock-token'),patch.object(responses,'build_opener',return_value=Opener()),tempfile.TemporaryDirectory() as directory:
            result=responses.call(Path(directory),{'timeout':10},'/chat/completions',{'model':'mock','messages':[]})
            self.assertEqual(result['choices'][0]['message']['tool_calls'][0]['id'],'abc')
            events.pop()
            with self.assertRaisesRegex(ValueError,'未收到完成事件'):responses.call(Path(directory),{'timeout':10},'/chat/completions',{'model':'mock','messages':[]})
    def test_oauth_pkce_state_cancel_and_account_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            manager=oauth.Manager(Path(folder))
            with socket.socket() as socket_test:socket_test.bind(('127.0.0.1',0));port=socket_test.getsockname()[1]
            try:
                result=manager.begin({'client_id':'test-client','redirect_uri':f'http://127.0.0.1:{port}/auth/callback'})
                query=parse_qs(urlsplit(result['authorization_url']).query)
                self.assertEqual(query['code_challenge_method'],['S256']);self.assertIn('ext_agent_host_id',query)
                with self.assertRaises(ValueError):manager.complete({'state':['wrong'],'code':['code']})
                self.assertIsNotNone(manager.pending)
                with patch.object(manager,'identity',return_value={'sub':'user','email':'mock@example.invalid'}),patch.object(oauth,'request_json',return_value={'id_token':'mock','access_token':'mock-access','refresh_token':'mock-refresh','expires_in':3600}),patch.object(manager,'write') as write:
                    manager.complete({'state':query['state'],'code':['code']})
                    self.assertEqual(write.call_args[0][0]['client_id'],'test-client')
            finally:manager.cancel()
    @unittest.skipUnless(os.name=='nt','DPAPI is a Windows component')
    def test_dpapi_secret_not_plaintext(self):
        with tempfile.TemporaryDirectory() as folder:
            manager=oauth.Manager(Path(folder));manager.write({'access_token':'secret-for-test','expires_at':9999999999})
            self.assertNotIn(b'secret-for-test',manager.path.read_bytes());self.assertEqual(manager.access_token(),'secret-for-test')
            self.assertNotIn('access_token',manager.status());manager.logout();self.assertFalse(manager.path.exists())
    @unittest.skipUnless((Path(__file__).resolve().parents[1]/'runtimes/node/node.exe').exists() or shutil.which('node'), 'RSA test fixture generation uses Node crypto')
    def test_real_rsa_identity_validation(self):
        import subprocess
        node=Path(__file__).resolve().parents[1]/'runtimes/node/node.exe'
        executable=str(node) if node.exists() else shutil.which('node')
        script="""const c=require('crypto');const {publicKey,privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const head=enc({alg:'RS256',kid:'test'});const body=enc({iss:'https://auth.openai.com',sub:'account',aud:'client',nonce:'nonce',exp:Math.floor(Date.now()/1000)+3600});const text=head+'.'+body;console.log(JSON.stringify({token:text+'.'+c.sign('RSA-SHA256',Buffer.from(text),privateKey).toString('base64url'),jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'test'}]}}))"""
        value=json.loads(subprocess.check_output([executable,'-e',script],text=True))
        self.assertEqual(oauth.validate_identity(value['token'],'client','nonce',value['jwks'])['sub'],'account')
        with self.assertRaises(ValueError):oauth.validate_identity(value['token'],'other','nonce',value['jwks'])
        with self.assertRaises(ValueError):oauth.validate_identity(value['token'],'client','other',value['jwks'])
        head,body,signature=value['token'].split('.')
        altered=(head+'.'+body+'.'+('A' if signature[0]!='A' else 'B')+signature[1:])
        with self.assertRaises(ValueError):oauth.validate_identity(altered,'client','nonce',value['jwks'])
    @unittest.skipUnless(os.name=='nt','DPAPI is a Windows component')
    def test_refresh_keeps_rotating_credentials_and_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            manager=oauth.Manager(Path(folder));manager.write({'access_token':'expired','refresh_token':'refresh-original','expires_at':0,'client_id':'client','sub':'account'})
            with patch.object(oauth,'request_json',return_value={'access_token':'new-access','expires_in':3600}) as request:
                self.assertEqual(manager.access_token(),'new-access')
                self.assertEqual(request.call_args.args[1]['grant_type'],'refresh_token')
                self.assertEqual(manager.read()['refresh_token'],'refresh-original')
            manager.write({**manager.read(),'expires_at':0})
            with patch.object(oauth,'request_json',return_value={'access_token':'rejected','id_token':'different'}),patch.object(manager,'identity',return_value={'sub':'wrong-account'}):
                with self.assertRaises(ValueError):manager.access_token()
                self.assertEqual(manager.read()['access_token'],'new-access')
    def test_oauth_redirect_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            manager=oauth.Manager(Path(folder))
            for uri in ['http://localhost:1455/auth/callback','https://example.org/auth/callback','http://127.0.0.1:1455/other']:
                with self.assertRaises(ValueError):manager.begin({'client_id':'test','redirect_uri':uri})
    def test_skill_disable_general_protection(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);data=root/'data';data.mkdir()
            for key in ['general','engineer']:extensions.save_skill(root,key,{'name':key,'prompt':'verified instructions'})
            extensions.toggle_skill(root,data,'engineer',False)
            self.assertNotIn('engineer',extensions.catalog(root,data)['skills']);self.assertFalse(extensions.catalog(root,data,True)['skills']['engineer']['enabled'])
            with self.assertRaises(ValueError):extensions.toggle_skill(root,data,'general',False)
    def test_session_compaction_rejects_concurrent_edit(self):
        with tempfile.TemporaryDirectory() as folder:
            previous=(backend.ROOT,backend.DATA);backend.ROOT=Path(folder);backend.DATA=Path(folder)/'data'
            try:
                backend.initialize()
                with backend.database() as db:
                    db.execute("INSERT INTO sessions(id,title) VALUES('concurrent','test')")
                    for i in range(14):db.execute('INSERT INTO messages(session_id,role,content) VALUES(?,?,?)',('concurrent','user' if i%2==0 else 'assistant','message'))
                def update(*args):
                    with backend.database() as db:db.execute("UPDATE messages SET content='edited' WHERE session_id='concurrent'")
                    return {'choices':[{'message':{'content':'summary'}}]}
                with self.assertRaisesRegex(ValueError,'原始消息已变更'):engine.compact_session(backend.database,'concurrent',{'model':'mock'},update,True)
                with backend.database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM context_summaries').fetchone()[0],0)
            finally:backend.ROOT,backend.DATA=previous

if __name__=='__main__':unittest.main()
