"""Recovery boundaries, real process restart, and dependency scheduling."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
import execution_state
import task_graph


class PowerLoss(BaseException):pass


def call(name,args,identifier):
    return {'choices':[{'message':{'content':None,'tool_calls':[{'id':identifier,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]}}]}


def answer(value='finished'):
    return {'choices':[{'message':{'content':value}}]}


class Durable(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=backend.ROOT,backend.DATA
        backend.ROOT=Path(self.temp.name);backend.DATA=backend.ROOT/'data'
        skill=backend.ROOT/'skills/general';skill.mkdir(parents=True);(skill/'SKILL.md').write_text('# Assistant\nHelp')
        backend.initialize();backend.local_account.save_profile(backend.DATA,{'use_memory':False})
        backend.runtime_engine.save_settings(backend.DATA,{'access_policy':'full','auto_compact':False})
        self.sid='recovery-session';self.key='durable-regression-key'
        self.body={'model':'mock','allow_tools':True,'file_permission':'all','command_permission':'all','access_policy':'full','api_key':'credential-never-checkpoint'}
        with backend.database() as db:
            db.execute('INSERT INTO sessions(id,title) VALUES(?,?)',(self.sid,'recovery'))
            db.execute("INSERT INTO runs(id,session_id,status,events) VALUES('run',?,'running','[]')",(self.sid,))
            db.execute("INSERT INTO stream_requests(id,session_id,hash,run_id,status,input) VALUES(?,?,'hash','run','running','{}')",(self.key,self.sid))
            execution_state.create(db,self.key,self.sid,self.body,self.config())
        self.states=[]
    def tearDown(self):
        for state in self.states:state.close()
        backend.security_audit.flush_pending()
        backend.ROOT,backend.DATA=self.old;self.temp.cleanup()
    def config(self):
        c=backend.request_config(self.body);c['_session_id']=self.sid;return c
    def state(self):
        state=execution_state.State(lambda:backend.database(shared=True),self.key);self.states.append(state);return state
    def restart(self,state):
        state.close()
        with backend.database() as db:execution_state.initialize(db)
        c=self.config();c['_execution']=self.state();return c
    def test_completed_command_and_model_steps_are_not_repeated(self):
        c=self.config();state=self.state();c['_execution']=state;commands=[]
        responses=[call('load_tools',{'names':['execute_command']},'load'),call('execute_command',{'argv':['fake']},'command'),PowerLoss()]
        with patch.object(backend,'stream_upstream',side_effect=responses),patch.object(backend,'approve_tool',return_value=True),patch.object(backend.agent_environment,'command',side_effect=lambda *a:commands.append(1) or {'exit_code':0}):
            with self.assertRaises(PowerLoss):backend.completion(c,[{'role':'user','content':'do work'}],lambda e:None)
        resumed=self.restart(state)
        with patch.object(backend,'stream_upstream',return_value=answer()) as model,patch.object(backend.agent_environment,'command',side_effect=AssertionError('repeated command')):
            self.assertEqual(backend.completion(resumed,[],lambda e:None),'finished');self.assertEqual(model.call_count,1)
        self.assertEqual(commands,[1])
        with backend.database() as db:
            snapshot=''.join(str(tuple(row)) for row in db.execute('SELECT * FROM executions'))
            self.assertNotIn('credential-never-checkpoint',snapshot)
    def test_inherited_dynamic_capability_survives_resume(self):
        c=self.config();state=self.state();c.update(_execution=state,tools=['execute_command'])
        with patch.object(backend,'stream_upstream',side_effect=[call('execute_command',{'argv':['fake']},'inherited'),PowerLoss()]),patch.object(backend.agent_environment,'command',return_value={'exit_code':0}):
            with self.assertRaises(PowerLoss):backend.completion(c,[],lambda e:None)
        resumed=self.restart(state)
        with patch.object(backend,'stream_upstream',return_value=answer()),patch.object(backend.agent_environment,'command',side_effect=AssertionError('repeat')):
            self.assertEqual(backend.completion(resumed,[],lambda e:None),'finished')
    def test_child_and_cross_window_tasks_cannot_spawn_more_windows(self):
        for extra in ({'is_subagent':True},{'cross_dispatch_depth':1}):
            with patch.object(backend,'start_durable_chat',side_effect=AssertionError('recursive spawn')):
                result=backend.session_tool('dispatch_session',{'session_id':self.sid,'content':'work'},{**self.config(),**extra},lambda e:None)
                self.assertIn('error',result)
    def test_unknown_side_effect_blocks_until_explicit_resolution(self):
        c=self.config();state=self.state();c['_execution']=state
        def effect(*args):
            (backend.DATA/'effect.txt').write_text('executed');raise PowerLoss()
        with patch.object(backend,'stream_upstream',side_effect=[call('load_tools',{'names':['execute_command']},'load'),call('execute_command',{'argv':['fake']},'command')]),patch.object(backend,'approve_tool',return_value=True),patch.object(backend.agent_environment,'command',side_effect=effect):
            with self.assertRaises(PowerLoss):backend.completion(c,[],lambda e:None)
        resumed=self.restart(state)
        with patch.object(backend.agent_environment,'command',side_effect=AssertionError('unsafe repeat')):
            with self.assertRaises(execution_state.Blocked):backend.completion(resumed,[],lambda e:None)
        with backend.database() as db:
            self.assertTrue(execution_state.inspect(db,self.key)['resumable'])
            execution_state.resolve(db,self.key,'tool:1:0','skip')
        with patch.object(backend,'stream_upstream',return_value=answer()),patch.object(backend.agent_environment,'command',side_effect=AssertionError('unsafe repeat')):
            self.assertEqual(backend.completion(self.restart(resumed['_execution']),[],lambda e:None),'finished')
    def test_waiting_approval_is_reissued_and_never_auto_granted(self):
        self.body['access_policy']='ask';c=self.config();state=self.state();c['_execution']=state
        with patch.object(backend,'stream_upstream',return_value=call('calculator',{'expression':'1+1'},'calc')),patch.object(backend,'approve_tool',side_effect=PowerLoss()):
            with self.assertRaises(PowerLoss):backend.completion(c,[],lambda e:None)
        resumed=self.restart(state)
        with patch.object(backend,'stream_upstream',return_value=answer()),patch.object(backend,'approve_tool',return_value=False) as approval:
            backend.completion(resumed,[],lambda e:None);self.assertEqual(approval.call_count,1)
    def test_answer_save_is_atomic_idempotent_and_cleanup_preserves_recovery(self):
        state=self.state();a=state.save_answer(self.sid,'input',[],'partial','mock');b=state.save_answer(self.sid,'input',[],'complete','mock');self.assertEqual(a,b)
        state.pause('disconnected')
        backend.storage_manager.cleanup(backend.DATA,backend.database,'completed_streams')
        with backend.database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0],2)
            self.assertIsNotNone(execution_state.inspect(db,self.key))
    def test_completed_child_scopes_are_isolated(self):
        state=self.state();a=execution_state.Scope(state,'a');b=execution_state.Scope(state,'b')
        a.begin('tool','tool','write_file',{});a.done('tool',{'ok':True})
        self.assertIsNone(b.begin('tool','tool','write_file',{}));self.assertTrue(a.begin('tool','tool','write_file',{})['result']['ok'])
    def test_dispatch_reuses_completed_children_after_interruption(self):
        state=self.state();c=self.config();c['_execution']=state;c['_execution_step']='dispatch';seen=[]
        tasks={'tasks':[{'id':'a','name':'a','task':'first'},{'id':'b','name':'b','task':'second','depends_on':['a']}]}
        def interrupted(child,messages,emit):
            name=messages[0]['content'];seen.append('a' if '子智能体 a' in name else 'b')
            if seen[-1]=='b':raise PowerLoss()
            return 'first complete'
        with patch.object(backend,'completion',side_effect=interrupted):
            with self.assertRaises(PowerLoss):backend.dispatch_agents(tasks,c,lambda e:None)
        c=self.restart(state);c['_execution_step']='dispatch'
        with patch.object(backend,'completion',return_value='second complete') as model:
            result=backend.dispatch_agents(tasks,c,lambda e:None)
            self.assertEqual(model.call_count,1);self.assertEqual(result['agents'][0]['result'],'first complete')
        self.assertEqual(seen,['a','b'])
    def test_subagent_retries_only_temporary_model_errors(self):
        c=self.config();seen=[]
        def model(*args):
            seen.append(1)
            if len(seen)==1:raise backend.ApiError(503,'temporary')
            return 'ready'
        with patch.object(backend,'completion',side_effect=model):
            result=backend.dispatch_agents({'tasks':[{'name':'one','task':'work','retries':1}]},c,lambda e:None)
        self.assertEqual(len(seen),2);self.assertEqual(result['agents'][0]['result'],'ready')
    def test_child_unknown_effect_cannot_be_hidden_as_generic_failure(self):
        state=self.state();c=self.config();c['_execution']=state
        def unsafe(child,*args):
            scoped=child['_execution'];scoped.begin('effect','tool','execute_command',{});scoped.phase('effect','executing')
            raise backend.ApiError(502,'lost result')
        with patch.object(backend,'completion',side_effect=unsafe):
            with self.assertRaises(execution_state.Blocked):backend.dispatch_agents({'tasks':[{'name':'child','task':'work'}]},c,lambda e:None)
        with self.assertRaises(execution_state.Blocked):state.finish()


class Graph(unittest.TestCase):
    def test_dependency_can_start_before_unrelated_slow_task_finishes(self):
        released=threading.Event();seen=[]
        nodes=task_graph.validate([{'id':'a','name':'slow'},{'id':'b','name':'fast'},{'id':'c','name':'dependent','depends_on':['b']}])
        def work(node,deps):
            if node['id']=='a':self.assertTrue(released.wait(2))
            if node['id']=='c':self.assertIn('b',deps);released.set()
            seen.append(node['id']);return {'result':node['id']}
        result=task_graph.run(nodes,work);self.assertLess(seen.index('c'),seen.index('a'));self.assertEqual(len(result['agents']),3)
    def test_cycles_missing_ids_and_failed_dependencies(self):
        for nodes in ([{'id':'a','depends_on':['b']},{'id':'b','depends_on':['a']}],[{'id':'a','depends_on':['missing']}],[{'id':'a'},{'id':'a'}]):
            with self.assertRaises(ValueError):task_graph.validate(nodes)
        nodes=task_graph.validate([{'id':'a','name':'a'},{'id':'b','name':'b','depends_on':['a']}]);seen=[]
        result=task_graph.run(nodes,lambda n,d:seen.append(n['id']) or {'error':'failed'})
        self.assertEqual(seen,['a']);self.assertEqual(result['agents'][1]['status'],'blocked')


class ProcessRestart(unittest.TestCase):
    def test_actual_backend_restart_reuses_completed_host_command(self):
        root=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)/'data';log=Path(folder)/'server.log';reached=threading.Event();release=threading.Event();calls=[]
            command=[sys.executable,'-c',"from pathlib import Path;p=Path('counter.txt');p.write_text(str(int(p.read_text())+1 if p.exists() else 1));print('ok')"]
            class AI(BaseHTTPRequestHandler):
                def log_message(self,*args):pass
                def do_POST(self):
                    self.rfile.read(int(self.headers['Content-Length']));calls.append(1);n=len(calls)
                    if n==1:result=call('load_tools',{'names':['execute_command']},'load')
                    elif n==2:result=call('execute_command',{'argv':command},'command')
                    elif n==3:reached.set();release.wait(10);result=answer()
                    else:result=answer()
                    raw=json.dumps(result).encode()
                    try:
                        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(raw)
                    except OSError:pass
            ai=ThreadingHTTPServer(('127.0.0.1',0),AI);threading.Thread(target=ai.serve_forever,daemon=True).start()
            process=None;response=None;stream=None
            def start():
                nonlocal process,stream,base,token
                stream=log.open('w',encoding='utf-8');process=subprocess.Popen([sys.executable,'-u',str(root/'server.py'),'--port','0','--data-dir',str(data)],cwd=root,stdout=stream,stderr=stream,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                for _ in range(150):
                    match=re.search(r'http://127.0.0.1:\d+',log.read_text(encoding='utf-8'))
                    if match:break
                    if process.poll() is not None:self.fail(log.read_text())
                    time.sleep(.05)
                self.assertIsNotNone(match);base=match[0]
                token=backend.security_core.capability(data)
                token=api('/api/bootstrap')['token']
            def api(path,method='GET',body=None):
                request=Request(base+path,method=method,headers={'X-App-Token':token,'Content-Type':'application/json'},data=json.dumps(body).encode() if body is not None else None)
                with urlopen(request,timeout=5) as result:return json.load(result)
            try:
                base=token='';start()
                api('/api/settings','PUT',{'base_url':f'http://127.0.0.1:{ai.server_port}/v1','model':'mock','timeout':30})
                api('/api/runtime','PUT',{'access_policy':'full','auto_compact':False})
                sid=api('/api/sessions','POST',{'title':'restart'})['id'];key='actual-restart-regression'
                request=Request(base+f'/api/sessions/{sid}/chat',method='POST',headers={'X-App-Token':token,'Content-Type':'application/json'},data=json.dumps({'content':'execute once','stream':True,'request_id':key,'allow_tools':True,'access_policy':'full'}).encode())
                response=urlopen(request,timeout=5)
                def approve():
                    try:
                        for raw in response:
                            if raw.startswith(b'data:'):
                                event=json.loads(raw[5:])
                                if event['type']=='approval':api('/api/approvals','POST',{'id':event['id'],'allow':True})
                    except OSError:pass
                reader=threading.Thread(target=approve,daemon=True);reader.start()
                self.assertTrue(reached.wait(8));self.assertEqual((data/'files/counter.txt').read_text(),'1')
                process.kill();process.wait(timeout=5);stream.close();response.close();reader.join(timeout=2);release.set()
                start();rows=api(f'/api/sessions/{sid}/executions');self.assertTrue(rows[0]['resumable'])
                api('/api/runtime','PUT',{'access_policy':'deny'})
                denied=api(f'/api/executions/{key}/resume','POST',{})
                request=Request(base+f"/api/stream/{key}?after={denied['after']}",headers={'X-App-Token':token})
                with urlopen(request,timeout=8) as stopped:denied_events=[json.loads(line[5:]) for line in stopped if line.startswith(b'data:')]
                self.assertEqual(denied_events[-1]['type'],'error');self.assertEqual((data/'files/counter.txt').read_text(),'1')
                api('/api/runtime','PUT',{'access_policy':'full'})
                result=api(f'/api/executions/{key}/resume','POST',{})
                request=Request(base+f"/api/stream/{key}?after={result['after']}",headers={'X-App-Token':token})
                with urlopen(request,timeout=8) as resumed:events=[json.loads(line[5:]) for line in resumed if line.startswith(b'data:')]
                self.assertEqual(events[-1]['type'],'done');self.assertEqual((data/'files/counter.txt').read_text(),'1')
                self.assertEqual(len(api(f'/api/sessions/{sid}/messages')),2);self.assertEqual(len(calls),4)
            finally:
                release.set()
                if process and process.poll() is None:process.kill();process.wait(timeout=5)
                if response:response.close()
                if stream:stream.close()
                ai.shutdown();ai.server_close()


if __name__=='__main__':unittest.main()
