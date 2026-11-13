"""Real usage accounting, unknown counts, replay safety and stream integration."""
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
import usage_meter as meter

class UsageMeter(unittest.TestCase):
    def test_concurrent_legacy_migration(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)
            with sqlite3.connect(data/'usage.sqlite3') as db:
                db.execute('CREATE TABLE usage_events(id TEXT PRIMARY KEY,stamp REAL NOT NULL,model TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,input INTEGER,output INTEGER,total INTEGER,cached INTEGER)')
            db.close()
            def save(index):
                meter.record(data,str(index),'mock','api_key','completed',{'total_tokens':1},config={'_run_id':'shared'})
            with ThreadPoolExecutor(max_workers=8) as workers:
                list(workers.map(save,range(16)))
            self.assertEqual(meter.task_summary(data,'shared')['total'],16)
    def test_task_summary_isolated_replay_and_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)
            meter.record(data,'one','mock','api_key','completed',{'total_tokens':30},config={'_run_id':'a'})
            meter.record(data,'one','mock','api_key','completed',{'total_tokens':999},config={'_run_id':'a'})
            meter.record(data,'two','mock','api_key','failed',None,config={'_run_id':'a'})
            meter.record(data,'three','mock','api_key','completed',{'total_tokens':90},config={'_run_id':'b'})
            result=meter.task_summary(data,'a')
            self.assertEqual((result['calls'],result['reported'],result['total']),(2,1,30))
            self.assertEqual(meter.task_summary(data,'b')['total'],90)
            self.assertEqual(meter.task_summary(data,'old')['reported'],0)
            self.assertFalse(meter.task_summary(data,None)['available'])
            with patch.object(meter,'database',side_effect=sqlite3.OperationalError('locked')):
                self.assertFalse(meter.task_summary(data,'a')['available'])
    def test_counts_validate_and_normalize(self):
        self.assertEqual(meter.counts({'prompt_tokens':10,'completion_tokens':5,'prompt_tokens_details':{'cached_tokens':2}}),(10,5,15,2))
        self.assertEqual(meter.counts({'input_tokens':3,'output_tokens':4,'total_tokens':7}),(3,4,7,None))
        self.assertEqual(meter.counts({'input_tokens':True,'output_tokens':-1,'total_tokens':'7'}),(None,None,None,None))
        self.assertEqual(meter.counts(None),(None,None,None,None))
    def test_daily_timezone_dedup_and_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder);stamp=datetime(2026,11,6,18,tzinfo=timezone.utc).timestamp()
            meter.record(data,'one','mock','api_key','completed',{'total_tokens':30},stamp)
            meter.record(data,'one','mock','api_key','completed',{'total_tokens':999},stamp)
            meter.record(data,'two','mock','api_key','failed',None,stamp)
            result=meter.activity(data,'2026-11-07',480)
            self.assertEqual(len(result['days']),365);self.assertEqual(result['days'][-1]['total'],30)
            self.assertEqual(result['days'][-1]['unreported'],1);self.assertEqual(result['totals']['calls'],2)
            self.assertEqual(result['totals']['input_reported'],0)
            self.assertEqual(meter.activity(data,'2026-11-06',0)['days'][-1]['total'],30)
            self.assertEqual(meter.activity(data,'2026-11-06',480)['days'][-1]['total'],0)
    def test_invalid_dates_and_offsets(self):
        with tempfile.TemporaryDirectory() as folder:
            for date,offset in [('bad',0),('0001-01-01',0),('2026-01-01',1000),('2026-01-01',True)]:
                with self.assertRaises(ValueError):meter.activity(Path(folder),date,offset)
    def test_accounting_never_changes_model_result(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)
            with patch.object(meter,'record',side_effect=sqlite3.OperationalError('locked')):
                self.assertEqual(meter.metered(data,{'model':'mock'},lambda c:{'usage':{'total_tokens':1},'answer':'ok'})['answer'],'ok')
            def fail(config):
                config['_reported_usage']={'total_tokens':5};raise ValueError('cancelled')
            with self.assertRaises(ValueError):meter.metered(data,{'model':'mock'},fail)
            self.assertEqual(meter.activity(data,'2026-11-06')['totals']['total'],5)
    def test_usage_only_stream_packet_and_opt_in(self):
        raw=b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}\n\ndata: [DONE]\n\n'
        class Reply(io.BytesIO):headers={'Content-Type':'text/event-stream'}
        class Opener:
            def open(self,request,**kwargs):
                self.payload=json.loads(request.data);return Reply(raw)
        with tempfile.TemporaryDirectory() as folder:
            previous=backend.DATA;backend.DATA=Path(folder);opener=Opener()
            try:
                config={'model':'mock','base_url':'http://127.0.0.1/v1','api_key':'','timeout':10,'request_usage':True}
                with patch.object(backend.security_net,'opener',return_value=opener):
                    result=backend.stream_upstream(config,{'model':'mock','messages':[]},lambda e:None)
                self.assertEqual(result['choices'][0]['message']['content'],'Hello')
                self.assertTrue(opener.payload['stream_options']['include_usage'])
                self.assertEqual(meter.activity(backend.DATA,'2026-11-06')['totals']['total'],12)
                config['request_usage']=False
                with patch.object(backend.security_net,'opener',return_value=opener):backend.stream_upstream(config,{'model':'mock','messages':[]},lambda e:None)
                self.assertNotIn('stream_options',opener.payload)
                self.assertEqual(meter.activity(backend.DATA,'2026-11-06')['totals']['calls'],2)
            finally:backend.DATA=previous
    def test_only_aggregate_metadata_exposed(self):
        with tempfile.TemporaryDirectory() as folder:
            result=meter.activity(Path(folder),'2026-11-06')
            self.assertEqual(result['totals']['calls'],0);self.assertNotIn('messages',result);self.assertNotIn('api_key',result)

if __name__=='__main__':unittest.main()
