"""Disconnect/reconnect and idempotency regression using a real local SSE upstream."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend

class StreamingAI(BaseHTTPRequestHandler):
    calls=0
    def log_message(self,*args):pass
    def do_POST(self):
        self.rfile.read(int(self.headers['Content-Length']));type(self).calls+=1
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        for word in ('one ','two ','three'):
            time.sleep(.2)
            event={'choices':[{'delta':{'content':word}}]}
            self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode());self.wfile.flush()
        self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()

class Resume(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.previous=(backend.ROOT,backend.DATA)
        backend.ROOT=Path(self.temp.name);backend.DATA=backend.ROOT/'data'
        folder=backend.ROOT/'skills/general';folder.mkdir(parents=True);(folder/'SKILL.md').write_text('# Assistant\nHelp clearly')
        backend.initialize();StreamingAI.calls=0
        self.ai=ThreadingHTTPServer(('127.0.0.1',0),StreamingAI);self.app=backend.LocalServer(('127.0.0.1',0),backend.Handler)
        for server in (self.ai,self.app):threading.Thread(target=server.serve_forever,daemon=True).start()
        self.base='http://127.0.0.1:'+str(self.app.server_port)
        with urlopen(self.base+'/api/bootstrap') as response:self.token=json.load(response)['token']
        self.call('/api/settings','PUT',{'base_url':'http://127.0.0.1:'+str(self.ai.server_port)+'/v1','model':'mock','timeout':10})
        self.sid=self.call('/api/sessions','POST',{'title':'resume'})['id']
    def tearDown(self):
        for server in (self.app,self.ai):server.shutdown();server.server_close()
        backend.ROOT,backend.DATA=self.previous;self.temp.cleanup()
    def request(self,path,method='GET',body=None):
        return Request(self.base+path,method=method,headers={'Content-Type':'application/json','X-App-Token':self.token},data=json.dumps(body).encode() if body is not None else None)
    def call(self,path,method='GET',body=None):
        with urlopen(self.request(path,method,body),timeout=5) as response:return json.load(response)
    def test_disconnect_replay_cursor_and_duplicate_submission(self):
        body={'content':'hello','stream':True,'request_id':'resume-regression-123','allow_tools':False,'auto_memory':False}
        response=urlopen(self.request('/api/sessions/'+self.sid+'/chat','POST',body),timeout=5)
        cursor=0
        while True:
            line=response.readline().decode()
            if line.startswith('id:'):cursor=int(line[3:])
            if line=='\n' and cursor:break
        response.close()
        with urlopen(self.request('/api/stream/'+body['request_id']+'?after='+str(cursor)),timeout=5) as replay:raw=replay.read().decode()
        events=[json.loads(line[5:]) for line in raw.splitlines() if line.startswith('data:')]
        self.assertEqual(''.join(e['text'] for e in events if e['type']=='delta'),'one two three')
        self.assertEqual(events[-1]['type'],'done')
        with urlopen(self.request('/api/sessions/'+self.sid+'/chat','POST',body),timeout=5) as duplicate:self.assertIn('one two three',duplicate.read().decode())
        self.assertEqual(StreamingAI.calls,1)
        self.assertEqual(len(self.call('/api/sessions/'+self.sid+'/messages')),2)
        self.assertEqual(self.call('/api/sessions/'+self.sid+'/stream')['status'],'complete')
        with backend.database() as db:backend.stream_journal.initialize(db)
        self.assertEqual(StreamingAI.calls,1)

if __name__=='__main__':unittest.main()
