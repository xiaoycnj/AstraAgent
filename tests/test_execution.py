"""Policy, budget, compaction, interoperability and evolution regression tests."""
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
import runtime_engine
import agent_environment
import mcp_client
import storage_manager

class Execution(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.data=self.root/'data'
        self.old=(backend.ROOT,backend.DATA);backend.ROOT=self.root;backend.DATA=self.data
        folder=self.root/'skills/general';folder.mkdir(parents=True);(folder/'SKILL.md').write_text('# General\nHelp')
        backend.initialize()
    def tearDown(self):
        for key in list(mcp_client.CLIENTS):
            if str(self.data.resolve()) in key:mcp_client.stop(key)
        backend.ROOT,backend.DATA=self.old;self.temp.cleanup()
    def test_policies_and_full_host_execution(self):
        emit=lambda event:None;denied=lambda *args:False
        self.assertFalse(runtime_engine.authorize('current_time',{}, {'access_policy':'deny'},emit,denied))
        refused=backend.request_config({'allow_tools':True,'access_policy':'deny','auto_memory':True})
        self.assertEqual(refused['tools'],[]);self.assertFalse(refused['auto_memory']);self.assertEqual(refused['memory_policy'],'off')
        self.assertFalse(runtime_engine.authorize('current_time',{}, {'access_policy':'ask'},emit,denied))
        self.assertTrue(runtime_engine.authorize('current_time',{}, {'access_policy':'ask'},emit,lambda *args:True))
        trusted={'access_policy':'trusted','trusted_commands':[['git','status','--short']]}
        self.assertTrue(runtime_engine.authorize('execute_command',{'argv':['git','status','--short']},trusted,emit,denied))
        self.assertFalse(runtime_engine.authorize('execute_command',{'argv':['git','status','--short','--bad']},trusted,emit,denied))
        self.assertFalse(runtime_engine.authorize('write_file',{'path':'x'},trusted,emit,denied))
        self.assertTrue(runtime_engine.authorize('mcp_external',{}, {'access_policy':'full'},None,denied))
        config={'command_permission':'all','command_mode':'host','_authorized_tool':'execute_command'}
        result=agent_environment.command(self.root,self.data,{'argv':[sys.executable,'-c','print("full-policy-ok")']},config,None,lambda *args:self.fail('full policy prompted'))
        self.assertIn('full-policy-ok',result['output'])
    def test_model_full_policy_executes_without_prompt(self):
        config=backend.request_config({'allow_tools':True,'access_policy':'full','auto_memory':False})
        config['model']='mock'
        steps=[]
        def fake(c,payload,emit):
            if payload['messages'][-1]['role']=='tool':
                result=json.loads(payload['messages'][-1]['content']);self.assertIn('model-command-ok',result['output'])
                return {'choices':[{'message':{'content':'执行成功'}}]}
            return {'choices':[{'message':{'content':None,'tool_calls':[{'id':'host','function':{'name':'execute_command','arguments':json.dumps({'argv':[sys.executable,'-c','print("model-command-ok")']})}}]}}]}
        with patch.object(backend,'stream_upstream',side_effect=fake),patch.object(backend,'approve_tool',side_effect=AssertionError('Unexpected full-policy prompt')):
            result=backend.completion(config,[{'role':'user','content':'执行命令'}],steps.append)
        self.assertEqual(result,'执行成功')
        self.assertEqual([event['type'] for event in steps],['tool_start','tool'])

    def test_tool_budget_finishes_and_keeps_result(self):
        calls=[];events=[]
        def fake(c,payload,emit):
            calls.append(payload.copy())
            if 'tools' not in payload:return {'choices':[{'message':{'content':'已计算得到 2，保存进展后结束。'}}]}
            return {'choices':[{'message':{'content':None,'tool_calls':[{'id':str(len(calls)),'function':{'name':'calculator','arguments':'{"expression":"1+1"}'}}]}}]}
        config={'model':'mock','tools':['calculator'],'max_tool_rounds':2,'tool_calls':10}
        with patch.object(backend,'stream_upstream',side_effect=fake):answer=backend.completion(config,[{'role':'user','content':'算数'}],events.append)
        self.assertIn('得到 2',answer);self.assertTrue(any(event['type']=='budget' for event in events));self.assertEqual(len(calls),3)
    def test_compaction_preserves_logs_and_summary(self):
        with backend.database() as db:
            db.execute("INSERT INTO sessions(id,title) VALUES('context','long')")
            for index in range(14):db.execute('INSERT INTO messages(session_id,role,content) VALUES(?,?,?)',('context','user' if index%2==0 else 'assistant','message '+str(index)))
        def fake(*args):return {'choices':[{'message':{'content':'保留目标、执行证据和未完成工作'}}]}
        config={'model':'mock','auto_compact':True,'context_chars':60000}
        result=runtime_engine.compact_session(backend.database,'context',config,fake,True)
        self.assertTrue(result['compacted']);self.assertEqual(result['messages'],6)
        history=runtime_engine.history(backend.database,'context',config,fake)
        self.assertEqual(len(history),9);self.assertEqual(history[0]['role'],'system')
        with backend.database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0],14)
    def test_mcp_stdio_real_server(self):
        script=self.root/'mcp_fake.py';script.write_text('''import sys,json
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m:continue
 method=m['method']
 result={'protocolVersion':'2025-11-25','capabilities':{'tools':{}}} if method=='initialize' else {'tools':[{'name':'echo','description':'echo input','inputSchema':{'type':'object','properties':{'text':{'type':'string'}}}}]} if method=='tools/list' else {'content':[{'type':'text','text':m['params']['arguments']['text']}]}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':result}),flush=True)
''',encoding='utf-8')
        mcp_client.save(self.data,{'id':'test','command':sys.executable,'args':['-u',str(script)],'enabled':True})
        found=mcp_client.discover(self.data,'test',mcp_client.fingerprint(mcp_client.configs(self.data)[0]));self.assertEqual(found['count'],1)
        alias=mcp_client.definitions(self.data)[0]['function']['name']
        self.assertEqual(mcp_client.call(self.data,alias,{'text':'real rpc'})['content'][0]['text'],'real rpc')
        mcp_client.save(self.data,{'id':'test','delete':True});self.assertEqual(mcp_client.definitions(self.data),[])
    def test_skill_versions_and_rollback(self):
        first=runtime_engine.evolve(self.root,self.data,{'id':'learned','name':'Learned','prompt':'initial procedure'})
        runtime_engine.evolve(self.root,self.data,{'id':'learned','name':'Learned','prompt':'improved procedure'})
        runtime_engine.evolve(self.root,self.data,{'id':'learned','action':'rollback','version':first['version']})
        self.assertIn('initial procedure',(self.root/'skills/learned/SKILL.md').read_text(encoding='utf-8'))
    def test_cross_session_dispatch_and_storage(self):
        with backend.database() as db:db.execute("INSERT INTO sessions(id,title) VALUES('target','Target')")
        def fake(*args):return {'choices':[{'message':{'content':'目标窗口任务实际完成'}}]}
        c={'model':'mock','tools':[],'system_prompt':'help','auto_memory':False,'access_policy':'full'}
        with patch.object(backend,'stream_upstream',side_effect=fake):
            result=backend.session_tool('dispatch_session',{'session_id':'target','content':'do work'},c,lambda event:None)
            self.assertTrue(result['ok'])
            for _ in range(100):
                job=backend.stream_journal.get(backend.database,result['request_id'])
                if job['status']=='complete':break
                time.sleep(.03)
            self.assertEqual(job['status'],'complete')
        usage=storage_manager.usage(self.root,self.data,backend.database);self.assertGreater(usage['total'],0)
        storage_manager.cleanup(self.data,backend.database,'completed_streams')
        with backend.database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0],2)

if __name__=='__main__':unittest.main()
