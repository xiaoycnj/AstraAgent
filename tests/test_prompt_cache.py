"""Provider-prefix continuity without live credentials or estimated cache hits."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
import local_account
import openai_responses
import runtime_engine
import usage_meter


class PromptCache(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.data=self.root/'data'
        self.patches=[patch.object(backend,'ROOT',self.root),patch.object(backend,'DATA',self.data)]
        for item in self.patches:item.start()
        backend.initialize()
        local_account.save_profile(self.data,{'inject_profile':False})
        (self.root/'memory').mkdir()
        (self.root/'memory/fact.md').write_text('Remembered fact',encoding='utf-8')
        with backend.database() as db:
            db.execute("INSERT INTO sessions(id,title) VALUES('one','One')")
            db.execute("INSERT INTO sessions(id,title) VALUES('two','Two')")

    def tearDown(self):
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()

    def turn(self,content,sid='one'):
        # New config each time also exercises cold-resume anchor restoration.
        config={'model':'mock','tools':[],'auto_compact':False}
        history=runtime_engine.history(backend.database,sid,config,None)
        messages=[{'role':'system','content':'Stable contract'}]
        messages.extend({'role':row['role'],'content':row['content']} for row in history)
        messages.append({'role':'user','content':content})
        sent=[]
        def reply(c,endpoint,payload):
            sent.append(copy.deepcopy(payload))
            return {'choices':[{'message':{'content':'Answer'}}]}
        with patch.object(backend,'upstream',side_effect=reply):
            answer=backend.completion(config,messages)
        with backend.database() as db:
            db.execute('INSERT INTO messages(session_id,role,content) VALUES(?,?,?)',(sid,'user',content))
            db.execute('INSERT INTO messages(session_id,role,content) VALUES(?,?,?)',(sid,'assistant',answer))
        return sent[0]

    def test_unchanged_memory_keeps_complete_prefix_across_turns(self):
        first=self.turn('First')
        second=self.turn('Second')
        third=self.turn('Third')
        self.assertEqual(second['messages'][:len(first['messages'])],first['messages'])
        self.assertEqual(third['messages'][:len(second['messages'])],second['messages'])
        with backend.database() as db:
            anchor=dict(db.execute('SELECT * FROM context_anchors').fetchone())
        self.assertEqual(set(anchor),{'session_id','fingerprint','after_id'})
        self.assertNotIn('Remembered fact',json.dumps(anchor))

    def test_changed_deleted_and_disabled_memory_is_fresh(self):
        self.turn('First')
        (self.root/'memory/fact.md').write_text('Replacement fact',encoding='utf-8')
        changed=self.turn('Second')
        self.assertIn('Replacement fact',changed['messages'][-2]['content'])
        self.assertNotIn('Remembered fact',json.dumps(changed))
        (self.root/'memory/fact.md').unlink()
        deleted=self.turn('Third')
        self.assertNotIn('Replacement fact',json.dumps(deleted))
        (self.root/'memory/fact.md').write_text('Hidden fact',encoding='utf-8')
        local_account.save_profile(self.data,{'use_memory':False})
        disabled=self.turn('Fourth')
        self.assertNotIn('Hidden fact',json.dumps(disabled))
        local_account.save_profile(self.data,{'use_memory':True})
        restored=self.turn('Fifth')
        self.assertIn('Hidden fact',restored['messages'][-2]['content'])

    def test_compaction_and_session_deletion_preserve_boundaries(self):
        self.turn('First')
        self.turn('Second')
        with backend.database() as db:
            boundary=db.execute("SELECT MAX(id) FROM messages WHERE session_id='one'").fetchone()[0]
            db.execute("INSERT INTO context_summaries VALUES('one',?,'Checkpoint',CURRENT_TIMESTAMP)",(boundary,))
        compacted=self.turn('Continue')
        self.assertEqual(compacted['messages'][0]['content'],'Stable contract')
        self.assertIn('Checkpoint',compacted['messages'][1]['content'])
        self.assertIn('Remembered fact',compacted['messages'][2]['content'])
        isolated=self.turn('Other','two')
        self.assertEqual(len(isolated['messages']),3)
        with backend.database() as db:
            db.execute("DELETE FROM sessions WHERE id='one'")
        with backend.database() as db:
            self.assertEqual([row[0] for row in db.execute('SELECT session_id FROM context_anchors')],['two'])

    def test_world_tree_changes_and_rewind_rebase_without_stale_background(self):
        with patch.object(backend.agent_hub,'tree_context',return_value='Original tree'):
            self.turn('First')
        with patch.object(backend.agent_hub,'tree_context',return_value='Updated tree'):
            updated=self.turn('Second')
            self.assertNotIn('Original tree',json.dumps(updated))
            next_turn=self.turn('Third')
            previous_input=openai_responses.payload_for(updated)['input']
            next_input=openai_responses.payload_for(next_turn)['input']
            self.assertEqual(next_input[:len(previous_input)],previous_input)
            with backend.database() as db:
                db.execute("DELETE FROM messages WHERE session_id='one'")
            rewound=self.turn('Restart')
            continued=self.turn('Restart continued')
            self.assertEqual(continued['messages'][:len(rewound['messages'])],rewound['messages'])

    def test_tool_loading_keeps_schema_prefix_and_enforces_permission(self):
        def definition(name):return {'type':'function','function':{'name':name,'parameters':{'type':'object','properties':{}}}}
        config={'model':'mock','tools':['load_plugin'],'access_policy':'deny'}
        replies=[{'content':None,'tool_calls':[{'id':'call','type':'function','function':{'name':'load_plugin','arguments':'{}'}}]},{'content':'Finished'}]
        sent=[]
        def reply(c,endpoint,payload):
            sent.append(copy.deepcopy(payload))
            return {'choices':[{'message':replies.pop(0)}]}
        def load(name,args,c,emit):
            c['tools'].append('calculator')
            return {'loaded':True}
        definitions=[definition('calculator'),definition('load_plugin')]
        with patch.object(backend,'TOOL_DEFS',definitions),patch.object(backend.mcp_client,'definitions',return_value=[]) as catalog,patch.object(backend,'upstream',side_effect=reply),patch.object(backend,'capability_tool',side_effect=load) as loader:
            backend.completion(config,[{'role':'user','content':'Work'}])
            loader.assert_not_called()
            self.assertIn('当前权限拒绝',sent[1]['messages'][-1]['content'])
            config['access_policy']='full'
            replies.extend([{'content':None,'tool_calls':[{'id':'call2','type':'function','function':{'name':'load_plugin','arguments':'{}'}}]},{'content':'Finished'}])
            backend.completion(config,[{'role':'user','content':'Work'}])
            self.assertEqual(sent[3]['tools'][:len(sent[2]['tools'])],sent[2]['tools'])
            self.assertEqual([tool['function']['name'] for tool in sent[3]['tools']],['load_plugin','calculator'])
            self.assertEqual(catalog.call_count,2)

    def test_plugin_selection_order_does_not_change_prompt(self):
        plugins=[{'id':key,'enabled':True,'supported':True} for key in ('goals','task-board')]
        catalog={'skills':{'general':{'prompt':'Help','source':'builtin'}},'plugins':plugins}
        with patch.object(backend.extensions,'catalog',return_value=catalog),patch.object(backend.mcp_client,'definitions',return_value=[]):
            one=backend.request_config({'allow_tools':True,'plugins':['goals','task-board']})
            two=backend.request_config({'allow_tools':True,'plugins':['task-board','goals','goals']})
        self.assertEqual(one['system_prompt'],two['system_prompt'])
        self.assertEqual(one['tools'],two['tools'])

    def test_cache_rate_uses_paired_counts_and_deepseek_fields(self):
        self.assertEqual(usage_meter.counts({'prompt_tokens':100,'completion_tokens':5,'prompt_cache_hit_tokens':80}),(100,5,105,80))
        self.assertIsNone(usage_meter.counts({'prompt_tokens':10,'prompt_cache_hit_tokens':20})[3])
        cases=[{'prompt_tokens':100,'prompt_cache_hit_tokens':80},
               {'input_tokens':900,'input_tokens_details':{'cached_tokens':90}},
               {'input_tokens':5000},{'prompt_cache_hit_tokens':9000}]
        for index,usage in enumerate(cases):usage_meter.record(self.data,str(index),'mock','api_key','completed',usage)
        result=usage_meter.activity(self.data)['cache']
        self.assertEqual(result,{'input':1000,'cached':170,'calls':2,'rate':.17})


if __name__=='__main__':unittest.main()
