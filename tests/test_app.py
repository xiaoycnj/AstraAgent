"""Offline integration tests. Uses a local fake OpenAI-compatible service."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend

class MockAI(BaseHTTPRequestHandler):
    calls = []
    fail = False
    delay = False
    started = threading.Event()
    def log_message(self, *args): pass
    def send_json(self, code, value):
        data = json.dumps(value).encode()
        self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self): self.send_json(200, {'data': [{'id':'local-test-model'}]})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.calls.append({'body': body, 'authorization': self.headers.get('Authorization'), 'path': self.path})
        self.started.set()
        if self.delay: time.sleep(.5)
        if self.fail: return self.send_json(401, {'error': 'private provider detail'})
        self.send_json(200, {'choices':[{'message':{'role':'assistant','content':'离线模型测试成功：'+body['messages'][-1]['content']}}]})

class Integration(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        backend.DATA=Path(self.temp.name); backend.initialize()
        MockAI.calls=[]; MockAI.fail=False; MockAI.delay=False; MockAI.started.clear()
        self.mock=ThreadingHTTPServer(('127.0.0.1',0),MockAI)
        self.app=ThreadingHTTPServer(('127.0.0.1',0),backend.Handler)
        for server in (self.mock,self.app): threading.Thread(target=server.serve_forever,daemon=True).start()
        self.base='http://127.0.0.1:'+str(self.app.server_port)
        self.token=self.call('/api/bootstrap')[1]['token']
    def tearDown(self):
        for server in (self.app,self.mock): server.shutdown(); server.server_close()
        self.temp.cleanup()
    def call(self,path,method='GET',data=None,headers=None):
        h={'Content-Type':'application/json','X-App-Token':getattr(self,'token','')}; h.update(headers or {})
        request=Request(self.base+path,method=method,headers=h,data=None if data is None else json.dumps(data).encode())
        try:
            with urlopen(request,timeout=5) as r: return r.status,json.load(r)
        except HTTPError as e:
            try: return e.code,json.load(e)
            finally: e.close()
    def configure(self):
        return self.call('/api/settings','PUT',{'base_url':f'http://127.0.0.1:{self.mock.server_port}/v1/chat/completions','model':'local-test-model','api_key':'not-a-real-key'})
    def test_config_and_upstream(self):
        code,c=self.configure(); self.assertEqual(code,200); self.assertNotIn('api_key',c); self.assertTrue(c['has_key'])
        self.assertTrue(c['base_url'].endswith('/v1'))
        self.assertEqual(self.call('/api/settings','PUT',{'api_key':''})[0],200)
        self.assertEqual(backend.config()['api_key'],'not-a-real-key')
        self.assertEqual(self.call('/api/settings/models','POST',{})[1]['models'],['local-test-model'])
        self.assertTrue(self.call('/api/settings/test','POST',{})[1]['ok'])
        self.assertEqual(MockAI.calls[-1]['authorization'],'Bearer not-a-real-key')
        self.assertEqual(MockAI.calls[-1]['path'],'/v1/chat/completions')
        self.assertNotIn('not-a-real-key',json.dumps(self.call('/api/bootstrap')[1]))
        self.assertFalse(self.call('/api/settings','PUT',{'clear_key':True})[1]['has_key'])
    def test_chat_history_failure_and_deletion(self):
        self.configure()
        sid=self.call('/api/sessions','POST',{'title':'测试'})[1]['id']
        path='/api/sessions/'+sid
        self.assertEqual(self.call(path+'/chat','POST',{'content':'你好'})[0],200)
        self.assertEqual(len(self.call(path+'/messages')[1]),2)
        self.call(path+'/chat','POST',{'content':'第二轮'})
        self.assertEqual(len(MockAI.calls[-1]['body']['messages']),4)
        MockAI.fail=True
        code,result=self.call(path+'/chat','POST',{'content':'失败不保存'})
        self.assertEqual(code,502); self.assertNotIn('private provider',result['error'])
        self.assertEqual(len(self.call(path+'/messages')[1]),4)
        self.assertEqual(self.call(path,'PATCH',{'title':'新名字'})[0],200)
        self.assertEqual(self.call('/api/sessions')[1][0]['title'],'新名字')
        self.assertEqual(self.call(path,'DELETE')[0],200)
        self.assertEqual(self.call(path+'/messages')[0],404)
        with backend.database() as db: self.assertEqual(db.execute('SELECT count(*) FROM messages').fetchone()[0],0)
    def test_multi_persona_review_and_atomic_failure(self):
        self.configure()
        sid=self.call('/api/sessions','POST',{'title':'多人格审查'})[1]['id']; path='/api/sessions/'+sid
        self.assertEqual(self.call(path+'/review','POST',{'content':'审查这段设计','personas':['architect']})[0],400)
        code,result=self.call(path+'/review','POST',{'content':'审查这段设计','personas':['architect','critic','security']})
        self.assertEqual(code,200); self.assertEqual([r['persona'] for r in result['reviews']],['architect','critic','security'])
        self.assertIn('summary',result); self.assertEqual(len(MockAI.calls),4)
        saved=self.call(path+'/messages')[1]
        self.assertEqual(len(saved),5); self.assertEqual([m['persona'] for m in saved[1:4]],['architect','critic','security'])
        self.assertEqual(saved[-1]['persona'],'synthesis')
        MockAI.fail=True; before=len(saved)
        self.assertEqual(self.call(path+'/review','POST',{'content':'失败不留半截','personas':['architect','critic']})[0],502)
        self.assertEqual(len(self.call(path+'/messages')[1]),before)
    def test_canvas_revision_and_validation(self):
        data={'title':'持久画布','data':{'nodes':[{'id':'a','type':'note','title':'测试','content':'内容','x':10,'y':20}],'edges':[]},'revision':0}
        self.assertEqual(self.call('/api/canvases/demo','PUT',data)[1]['revision'],1)
        backend.initialize()
        saved=self.call('/api/canvases/demo')[1]; self.assertEqual(saved['data'],data['data'])
        self.assertEqual(self.call('/api/canvases/demo','PUT',data)[0],409)
        data['revision']=1; data['data']['edges']=[{'from':'a','to':'missing'}]
        self.assertEqual(self.call('/api/canvases/demo','PUT',data)[0],400)
        data['data']['edges']=[]
        self.assertEqual(self.call('/api/canvases/demo','PUT',data)[1]['revision'],2)
        self.assertEqual(len(self.call('/api/canvases')[1]),1)
        self.assertEqual(self.call('/api/canvases/demo','DELETE')[0],200)
        self.assertEqual(self.call('/api/canvases/demo')[0],404)
    def test_security_and_static_files(self):
        self.assertEqual(self.call('/api/sessions','POST',{'title':'x'},{'X-App-Token':'bad'})[0],403)
        self.assertEqual(self.call('/api/health',headers={'Origin':'https://example.org'})[0],403)
        self.assertEqual(self.call('/api/health',headers={'Host':'example.org'})[0],403)
        self.assertEqual(self.call('/api/health')[1]['app'],backend.APP_ID)
        self.assertEqual(self.call('/data/settings.json')[0],404)
        for path in ('/','/app.js','/style.css','/assets/js/app.js','/assets/css/style.css','/assets/icons/models/openai.svg'):
            with urlopen(self.base+path) as r:
                self.assertEqual(r.status,200); self.assertGreater(len(r.read()),500)
                self.assertEqual(r.headers['X-Frame-Options'],'DENY')
    def test_no_configuration_and_invalid_input(self):
        sid=self.call('/api/sessions','POST',{'title':'新对话'})[1]['id']
        self.assertEqual(self.call('/api/sessions/'+sid+'/chat','POST',{'content':'Hello'})[0],400)
        self.assertEqual(self.call('/api/sessions','POST',{'title':42})[0],400)
        self.assertEqual(self.call('/api/settings','PUT',{'timeout':0})[0],400)
        self.assertEqual(self.call('/api/settings','PUT',{'base_url':'file:///test'})[0],400)
    def test_session_organization_and_branch(self):
        sid=self.call('/api/sessions','POST',{'title':'source'})[1]['id']
        with backend.database() as db:
            db.execute("INSERT INTO messages(session_id,role,content,model) VALUES(?,?,?,?)",(sid,'assistant','saved reply','original-model'))
        self.assertEqual(self.call('/api/sessions/'+sid,'PATCH',{'project':'研发','archived':True})[0],200)
        branch=self.call('/api/sessions/'+sid+'/branch','POST',{})[1]
        messages=self.call('/api/sessions/'+branch['id']+'/messages')[1]
        self.assertEqual(messages[0]['content'],'saved reply')
        self.assertEqual(messages[0]['model'],'original-model')
        rows=self.call('/api/sessions')[1]
        self.assertEqual(rows[0]['project'],'研发')
        self.assertEqual(rows[0]['archived'],0)
        self.assertEqual(rows[0]['parent_id'],sid)
        self.assertEqual(rows[1]['archived'],1)
        self.call('/api/sessions/'+sid,'DELETE')
        self.assertEqual(len(self.call('/api/sessions/'+branch['id']+'/messages')[1]),1)

    def test_session_concurrency(self):
        self.configure(); MockAI.delay=True
        sid=self.call('/api/sessions','POST',{'title':'并发'})[1]['id']; path='/api/sessions/'+sid
        result=[]
        worker=threading.Thread(target=lambda:result.append(self.call(path+'/chat','POST',{'content':'一'})))
        worker.start(); self.assertTrue(MockAI.started.wait(3))
        self.assertEqual(self.call(path+'/chat','POST',{'content':'二'})[0],409)
        self.assertEqual(self.call(path,'DELETE')[0],409)
        worker.join(); self.assertEqual(result[0][0],200)

if __name__=='__main__': unittest.main(verbosity=2)
