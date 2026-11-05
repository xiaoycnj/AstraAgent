"""Tool behavior, permission boundaries and actual completion-loop regression tests."""
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
import workspace_tools as tools

class WorkspaceTools(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.data=Path(self.temp.name)
        self.root=self.data/'files';self.root.mkdir()
        (self.root/'notes').mkdir();(self.root/'notes/hello.md').write_text('Hello 麟\nsecond hello\n',encoding='utf-8')
    def tearDown(self): self.temp.cleanup()
    def run_tool(self,name,**args): return tools.execute(self.data,name,args)
    def test_search_paths_lines_case_binary_and_quotas(self):
        self.assertEqual(self.run_tool('search_files',pattern='*.md')['matches'],['notes/hello.md'])
        result=self.run_tool('search_text',query='hello')
        self.assertEqual([r['line'] for r in result['matches']],[1,2])
        self.assertEqual(len(self.run_tool('search_text',query='hello',case_sensitive=True)['matches']),1)
        (self.root/'binary').write_bytes(b'\xff\xfe')
        (self.root/'big.txt').write_text('x'*100001)
        result=self.run_tool('search_text',query='not found');self.assertEqual(result['skipped'],2)
        (self.root/'many.txt').write_text('match\n'*200)
        result=self.run_tool('search_text',query='match');self.assertEqual(len(result['matches']),100);self.assertTrue(result['truncated'])
    def test_mutations_stale_hash_counts_and_preserved_newlines(self):
        self.assertTrue(self.run_tool('create_directory',path='new/nested')['created'])
        self.assertTrue(self.run_tool('copy_file',path='notes/hello.md',destination='new/copy.md')['ok'])
        self.assertIn('error',self.run_tool('copy_file',path='notes/hello.md',destination='new/copy.md'))
        self.assertTrue(self.run_tool('move_file',path='new/copy.md',destination='new/moved.md')['ok'])
        self.assertFalse((self.root/'new/copy.md').exists())
        info=self.run_tool('file_info',path='new/moved.md');self.assertEqual(len(info['sha256']),64)
        original=(self.root/'new/moved.md').read_bytes()
        for extra in ({'expected_count':2},{'expected_count':1,'sha256':'outdated'}):
            self.assertIn('error',self.run_tool('replace_in_file',path='new/moved.md',old='Hello',new='你好',**extra))
            self.assertEqual((self.root/'new/moved.md').read_bytes(),original)
        result=self.run_tool('replace_in_file',path='new/moved.md',old='Hello',new='你好',expected_count=1,sha256=info['sha256'])
        self.assertEqual(result['replacements'],1);self.assertIn('你好',(self.root/'new/moved.md').read_text(encoding='utf-8'))
        (self.root/'crlf.txt').write_bytes(b'a\r\nb\r\n')
        self.run_tool('replace_in_file',path='crlf.txt',old='a',new='A',expected_count=1)
        self.assertEqual((self.root/'crlf.txt').read_bytes(),b'A\r\nb\r\n')
    def test_boundaries_missing_existing_destination_and_invalid_args(self):
        for path in ('../secret','notes/../../secret','C:/secret','/secret','notes/name:stream','.'):
            self.assertIn('error',self.run_tool('file_info',path=path))
        self.assertIn('error',self.run_tool('move_file',path='notes/hello.md',destination='notes/hello.md'))
        self.assertTrue((self.root/'notes/hello.md').exists())
        self.assertIn('error',self.run_tool('search_text',query=''))
        self.assertIn('error',self.run_tool('search_text',query='hello',case_sensitive='false'))
        self.assertIn('error',self.run_tool('replace_in_file',path='notes/hello.md',old='',new='x',expected_count=1))
        self.assertIn('error',self.run_tool('copy_file',path='notes/hello.md',destination='../outside'))
    def test_links_not_followed(self):
        outside=self.data/'outside';outside.mkdir();(outside/'private.txt').write_text('private')
        try: (self.root/'link').symlink_to(outside,target_is_directory=True)
        except OSError:
            if sys.platform!='win32': self.skipTest('symlink privilege unavailable')
            result=subprocess.run(['cmd','/c','mklink','/J',str(self.root/'link'),str(outside)],capture_output=True)
            if result.returncode: self.skipTest('symlink and junction unavailable')
        self.assertIn('error',self.run_tool('file_info',path='link/private.txt'))
        self.assertEqual(self.run_tool('search_files',pattern='private.txt')['matches'],[])
    def test_permission_matrix_and_no_side_effect_on_denial(self):
        for name,args in [('search_files',{'pattern':'*'}),('search_text',{'query':'Hello'}),('file_info',{'path':'notes/hello.md'}),('create_directory',{'path':'allowed'}),('copy_file',{'path':'notes/hello.md','destination':'copy'}),('move_file',{'path':'notes/hello.md','destination':'moved'}),('replace_in_file',{'path':'notes/hello.md','old':'Hello','new':'x','expected_count':1})]:
            for permission in ('none','ask','read','all'):
                (self.root/'notes/hello.md').write_text('Hello 麟\nsecond hello\n',encoding='utf-8')
                approvals=[]
                result=tools.invoke(self.data,name,args,{'file_permission':permission},lambda e:None,lambda *a:approvals.append(a) or False)
                denied=permission in ('none','ask') or (permission=='read' and name in tools.WRITES)
                self.assertEqual('error' in result,denied,(name,permission,result))
                self.assertEqual(bool(approvals),permission=='ask' or (permission=='read' and name in tools.WRITES))
        self.assertIn('error',tools.invoke(self.data,'create_directory',{'path':'blocked'},{'file_permission':'all'},None,lambda *a:True))
        self.assertFalse((self.root/'blocked').exists())
    def test_model_loop_discovery_permission_and_real_result_events(self):
        config={'model':'test','tools':list(tools.NAMES),'file_permission':'read'}
        calls=[];events=[]
        def upstream(c,payload,emit):
            calls.append(payload.copy())
            if len(calls)==1:
                return {'choices':[{'message':{'content':None,'tool_calls':[{'id':'call-1','type':'function','function':{'name':'search_text','arguments':json.dumps({'query':'Hello'})}}]}}]}
            output=json.loads(payload['messages'][-1]['content']);self.assertEqual(output['matches'][0]['path'],'notes/hello.md')
            return {'choices':[{'message':{'content':'已找到两处文本。'}}]}
        with patch.object(backend,'DATA',self.data),patch.object(backend.local_account,'context',return_value=''),patch.object(backend,'stream_upstream',side_effect=upstream):
            self.assertEqual(backend.completion(config,[{'role':'user','content':'查找 Hello'}],events.append),'已找到两处文本。')
        self.assertEqual({t['function']['name'] for t in calls[0]['tools']},tools.NAMES)
        self.assertEqual([e['type'] for e in events],['tool_start','tool'])
        self.assertEqual(events[-1]['result']['matches'][0]['line'],1)

if __name__=='__main__': unittest.main()
