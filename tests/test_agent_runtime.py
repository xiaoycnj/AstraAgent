"""Runtime permission and bounded worker tests; no live API credentials."""
import json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import agent_environment as runtime
import sandbox_worker
class AgentRuntime(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.data=Path(self.temp.name)/'data';self.data.mkdir();self.root=Path(__file__).resolve().parents[1]
    def tearDown(self):self.temp.cleanup()
    def test_environment_has_boundaries_no_secrets(self):
        value=runtime.environment(self.root,self.data,{'api_key':'SECRET','tools':['get_environment']})
        self.assertFalse(value['sandbox']['os_isolation']);self.assertNotIn('SECRET',json.dumps(value));self.assertIn('CSV reader',value['integrations'])
    def test_worker_path_and_command_limits(self):
        root=self.data/'files';root.mkdir()
        self.assertTrue(sandbox_worker.execute(root,['write','a.txt','hello'])['ok'])
        self.assertEqual(sandbox_worker.execute(root,['cat','a.txt'])['text'],'hello')
        for argv in [['cat','../profile.json'],['python','-c','print(1)'],['write','/outside','x'],['rm','.']]:
            with self.assertRaises((ValueError,OSError)):sandbox_worker.execute(root,argv)
        sandbox_worker.execute(root,['write','a.csv','name,value\na,1'])
        self.assertEqual(sandbox_worker.execute(root,['csv','a.csv'])['rows'][0]['name'],'a')
    def test_command_process_and_permission(self):
        deny=lambda *args:False;emit=lambda e:None
        self.assertIn('error',runtime.command(self.root,self.data,{'argv':['pwd']},{'command_permission':'none'},emit,deny))
        self.assertIn('error',runtime.command(self.root,self.data,{'argv':['pwd']},{'command_permission':'ask'},emit,deny))
        result=runtime.command(self.root,self.data,{'argv':['write','test.txt','中文ok']},{'command_permission':'all','command_mode':'sandbox'},emit,deny)
        self.assertEqual(result['exit_code'],0);self.assertEqual((self.data/'files/test.txt').read_text(encoding='utf-8'),'中文ok')
        read=runtime.command(self.root,self.data,{'argv':['cat','test.txt']},{'command_permission':'all','command_mode':'sandbox'},emit,deny)
        self.assertEqual(read['result']['text'],'中文ok')
        called=[]
        result=runtime.command(self.root,self.data,{'argv':[sys.executable,'-c','print("approved-host")']},{'command_permission':'all','command_mode':'host'},emit,lambda *args:called.append(args) or True)
        self.assertTrue(called);self.assertIn('approved-host',result['output']);self.assertFalse(result['isolated'])
    def test_memory_auto_dedup_and_denial(self):
        root=Path(self.temp.name);events=[]
        a=runtime.save_memory(root,{'content':'用户偏好简洁中文'},{'memory_policy':'auto'},events.append,lambda *a:False)
        b=runtime.save_memory(root,{'content':'用户偏好简洁中文'},{'memory_policy':'auto'},events.append,lambda *a:False)
        self.assertTrue(a['ok']);self.assertTrue(b['deduplicated'])
        denied=runtime.save_memory(root,{'content':'禁止写入'},{'memory_policy':'ask'},events.append,lambda *a:False)
        self.assertIn('error',denied);self.assertEqual(len(list((root/'memory').glob('*.md'))),1)
    def test_postturn_extraction(self):
        root=Path(self.temp.name);events=[]
        def upstream(c,path,payload):
            self.assertNotIn('tools',payload)
            return {'choices':[{'message':{'content':'{"memories":["用户长期使用 Python"]}'}}]}
        runtime.auto_memory(root,self.data,{'auto_memory':True,'memory_policy':'auto','model':'mock'},'我长期使用 Python','收到',events.append,upstream)
        self.assertTrue(any(e['type']=='memory_saved' for e in events));self.assertEqual(len(list((root/'memory').glob('*.md'))),1)
if __name__=='__main__':unittest.main()
