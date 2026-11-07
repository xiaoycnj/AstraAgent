"""Agent hub regression checks for persistence, delegation and browser boundaries."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
import agent_hub
import agent_environment
import extensions

class Hub(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.data=self.root/'data'
        self.data.mkdir();(self.root/'memory').mkdir()
    def tearDown(self):self.temp.cleanup()
    def test_records_links_dedup_update_cycles_and_delete(self):
        goal=agent_hub.record(self.data,'goal',{'action':'create','title':'launch'})['record']
        task=agent_hub.record(self.data,'task',{'action':'create','title':'design','parent':goal['id']})['record']
        self.assertTrue(agent_hub.record(self.data,'task',{'action':'create','title':'design','parent':goal['id']})['deduplicated'])
        with self.assertRaises(ValueError):agent_hub.record(self.data,'goal',{'action':'update','id':goal['id'],'parent':task['id']})
        agent_hub.record(self.data,'task',{'action':'update','id':task['id'],'status':'done'})
        self.assertEqual(agent_hub.record(self.data,'task',{'action':'list'})['records'][0]['status'],'done')
        agent_hub.record(self.data,'goal',{'action':'delete','id':goal['id']})
        self.assertEqual(agent_hub.record(self.data,'task',{'action':'list'})['records'][0]['parent'],'')
    def test_builtin_registry_and_plugin_gates(self):
        catalog=extensions.catalog(backend.ROOT,self.data)
        self.assertEqual(len([p for p in catalog['plugins'] if p.get('builtin') and p['enabled']]),13)
        with patch.object(backend,'DATA',self.data):
            config=backend.request_config({'allow_tools':True,'access_policy':'trusted'})
            self.assertIn('dispatch_agents',config['tools']);self.assertEqual(config['memory_policy'],'auto')
            extensions.toggle_plugin(backend.ROOT,self.data,'agent-dispatch',False)
            config=backend.request_config({'allow_tools':True,'access_policy':'trusted'});self.assertNotIn('dispatch_agents',config['tools'])
            backend.capability_tool('load_plugin',{'id':'agent-dispatch'},config,lambda event:None)
            self.assertIn('dispatch_agents',config['tools'])
            self.assertEqual(backend.request_config({'allow_tools':False})['tools'],[])
    def test_automatic_memory_and_tree_injection(self):
        events=[]
        def upstream(*args):return {'choices':[{'message':{'content':json.dumps({'memories':['用户长期使用中文']})}}]}
        agent_environment.auto_memory(self.root,self.data,{'auto_memory':True,'memory_policy':'auto','model':'mock'},'我长期使用中文','收到',events.append,upstream)
        self.assertEqual(len(list((self.root/'memory').glob('auto-*.md'))),1)
        self.assertIn('用户长期使用中文',agent_hub.tree_context(self.data))
        agent_environment.auto_memory(self.root,self.data,{'auto_memory':True,'memory_policy':'auto','model':'mock'},'我长期使用中文','收到',events.append,upstream)
        self.assertEqual(len(agent_hub.snapshot(self.data)['records']),1)
        node=agent_hub.snapshot(self.data)['records'][0]
        agent_hub.world_record(self.root,self.data,{'action':'update','id':node['id'],'content':'用户偏好简洁中文'})
        files=list((self.root/'memory').glob('auto-*.md'));self.assertEqual(len(files),1);self.assertEqual(files[0].read_text(encoding='utf-8'),'用户偏好简洁中文')
        agent_hub.world_record(self.root,self.data,{'action':'delete','id':node['id']})
        self.assertEqual(len(list((self.root/'memory').glob('auto-*.md'))),0)

    def test_browser_extract_find_and_private_address_denial(self):
        parser=agent_hub.PageParser('https://example.com')
        parser.feed('<title>Demo</title><script>secret</script><p>Hello world</p><a href="/next">next</a>')
        self.assertNotIn('secret',''.join(parser.text));self.assertEqual(parser.links,['https://example.com/next'])
        with self.assertRaises(ValueError):agent_hub.fetch_page('http://127.0.0.1/')
        with self.assertRaises(ValueError):agent_hub.fetch_page('file:///secret')
        with patch.object(agent_hub,'fetch_page',return_value={'url':'https://example.com','title':'Demo','content':'hello world','links':[]}):
            page=agent_hub.open_page(self.data,'https://example.com')
        result=agent_hub.execute(self.root,self.data,'browser_find',{'page_id':page['page_id'],'query':'world'},{},None,None)
        self.assertEqual(result['matches'],['hello world'])
    def test_real_dispatch_saves_sessions_and_failed_jobs(self):
        old_data=backend.DATA
        with patch.object(backend,'DATA',self.data),patch.object(backend,'ROOT',self.root):
            backend.initialize()
            calls=[]
            def upstream(c,path,payload):
                calls.append((c,payload))
                if 'fail task' in payload['messages'][-1]['content']:raise ValueError('fake upstream failure')
                return {'choices':[{'message':{'content':'child actual result'}}]}
            config={'model':'mock','tools':['calculator','dispatch_agents','write_file'],'file_permission':'all','timeout':10}
            with patch.object(backend,'stream_upstream',side_effect=lambda c,payload,emit:upstream(c,'/chat/completions',payload)):
                result=backend.dispatch_agents({'tasks':[{'name':'review','task':'review task'},{'name':'failure','task':'fail task'}]},config,None)
            self.assertEqual(len(result['agents']),2);self.assertEqual(result['agents'][0]['result'],'child actual result');self.assertIn('error',result['agents'][1])
            self.assertEqual(calls[0][0]['file_permission'],'read');self.assertNotIn('dispatch_agents',calls[0][0]['tools']);self.assertNotIn('write_file',calls[0][0]['tools'])
            with backend.database() as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM messages WHERE role='assistant'").fetchone()[0],1)
            self.assertEqual({j['status'] for j in agent_hub.snapshot(self.data)['jobs']},{'done','failed'})
            self.assertIn('error',backend.dispatch_agents({'tasks':[{'name':'x','task':'x'}]},{**config,'is_subagent':True},None))

if __name__=='__main__':unittest.main()
