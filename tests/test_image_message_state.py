"""Generated output IDs are message-scoped, ordered, and not model inputs."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend

class ImageMessageState(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = backend.DATA
        backend.DATA = Path(self.temp.name)
        backend.initialize()
        with backend.database() as db:
            db.execute("INSERT INTO sessions(id,title) VALUES('image-state','Images')")
    def tearDown(self):
        backend.DATA = self.old
        self.temp.cleanup()
    def test_success_only_ordered_deduped_and_message_scoped(self):
        c = {}
        a, b = 'a'*32, 'b'*32
        for key in (a,b,a):
            backend.record_generated_image(c, 'generate_image', {'ok':True,'attachment':{'kind':'image','id':key}})
        backend.record_generated_image(c, 'generate_image', {'ok':False,'attachment':{'kind':'image','id':'c'*32}})
        backend.record_generated_image(c, 'write_file', {'ok':True,'attachment':{'kind':'image','id':'d'*32}})
        self.assertEqual(c['_generated_attachment_ids'], [a,b])
        with backend.database() as db:
            mid = db.execute("INSERT INTO messages(session_id,role,content) VALUES('image-state','assistant','done')").lastrowid
            other = db.execute("INSERT INTO messages(session_id,role,content) VALUES('image-state','assistant','other')").lastrowid
            backend.save_generated_images(db,c,mid)
            row = db.execute('SELECT * FROM messages WHERE id=?',(mid,)).fetchone()
            self.assertEqual(json.loads(row['generated_attachment_ids']),[a,b])
            self.assertEqual(json.loads(row['attachments']),[])
            self.assertEqual(db.execute('SELECT generated_attachment_ids FROM messages WHERE id=?',(other,)).fetchone()[0],'[]')
    def test_durable_terminal_persists_images_on_done_cancel_and_error(self):
        import time
        for terminal in ('done','cancelled','error'):
            key = 'image-terminal-' + terminal
            c = {'model':'mock','access_policy':'full','system_prompt':'','tools':[]}
            def complete(config, messages, emit):
                backend.record_generated_image(config,'generate_image',{'ok':True,'attachment':{'kind':'image','id':'b'*32}})
                if terminal == 'cancelled': raise backend.task_control.Cancelled('cancelled')
                if terminal == 'error': raise ValueError('fixture interrupted')
                return 'complete'
            with patch.object(backend,'completion',side_effect=complete), patch.object(backend.runtime_engine,'history',return_value=[]), patch.object(backend.agent_environment,'auto_memory'), patch.object(backend.application_plugins,'after_response'):
                backend.start_durable_chat(key,'image-state',{'content':terminal},c,[],terminal,[])
                for _ in range(200):
                    job=backend.stream_journal.get(backend.database,key)
                    if job['status'] != 'running': break
                    time.sleep(.01)
                self.assertNotEqual(job['status'],'running')
            with backend.database() as db:
                events=[json.loads(row['event']) for row in db.execute('SELECT event FROM stream_events WHERE request_id=? ORDER BY id',(key,))]
                event=next(event for event in events if event['type']==terminal)
                self.assertEqual(event['generated_attachment_ids'],['b'*32])
                row=db.execute('SELECT * FROM messages WHERE id=?',(event['message_id'],)).fetchone()
                self.assertEqual(json.loads(row['generated_attachment_ids']),['b'*32])

    def test_replayed_tool_restores_images_without_regenerating(self):
        from unittest.mock import Mock
        calls={'choices':[{'message':{'tool_calls':[{'id':'saved-call','function':{'name':'generate_image','arguments':'{"prompt":"saved"}'}}]}}]}
        output={'ok':True,'attachment':{'kind':'image','id':'c'*32},'markdown':'image'}
        execution=Mock()
        execution.initial.side_effect=lambda payload,config:payload
        execution.begin.side_effect=lambda step,*args: {'result':calls,'context':{}} if step=='model:0' else {'result':output,'context':{}} if step.startswith('tool:') else {'result':{'choices':[{'message':{'content':'complete'}}]},'context':{}}
        c={'model':'mock','tools':['generate_image'],'access_policy':'full','_session_id':'image-state','_execution':execution}
        events=[]
        with patch.object(backend.feature_modules,'execute',side_effect=AssertionError('must not regenerate')), patch('modules.image_generation.feedback',return_value=None):
            backend.completion(c,[],events.append)
        event=next(event for event in events if event['type']=='step_reused')
        self.assertEqual(event['tool_call_id'],'saved-call')
        self.assertEqual(event['result'],output)
        self.assertEqual(c['_generated_attachment_ids'],['c'*32])

    def test_tool_events_have_matching_call_ids(self):
        c={'model':'mock','tools':['generate_image'],'access_policy':'ask','_session_id':'image-state'}
        output={'ok':True,'attachment':{'kind':'image','id':'a'*32},'markdown':'image'}
        calls={'choices':[{'message':{'tool_calls':[{'id':'stable-call','function':{'name':'generate_image','arguments':'{"prompt":"star"}'}}]}}]}
        events=[]
        with patch.object(backend,'stream_upstream',side_effect=[calls,{'choices':[{'message':{'content':'complete'}}]}]), patch.object(backend,'approve_tool',side_effect=AssertionError('unexpected image approval')), patch.object(backend.feature_modules,'execute',return_value=output), patch('modules.image_generation.feedback',return_value=None):
            backend.completion(c,[],events.append)
        for event in events:
            if event['type'] in ('tool_start','tool','image_generated'):
                self.assertEqual(event['tool_call_id'],'stable-call')
        self.assertEqual(c['_generated_attachment_ids'],['a'*32])

if __name__ == '__main__': unittest.main()
