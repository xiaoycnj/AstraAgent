"""Performance timing, protocol metadata, legacy history and dashboard contracts."""
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import backend
import performance_stats as stats
import task_control
import usage_meter as meter


class Performance(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.data=Path(self.folder.name)

    def tearDown(self):self.folder.cleanup()

    def save(self,key='one',model='alpha',response='alpha',output=100,elapsed=2000,status='completed',stamp=1794873600,**metrics):
        meter.record(self.data,key,model,'api_key',status,{'output_tokens':output},stamp,
                     {'id':'provider-a','name':'Fixture','_routing':{'requested_model':'AutoRouter'},
                      '_performance':{'duration_ms':elapsed,'response_model':response,**metrics}})

    def test_weighted_rates_only_use_successful_known_samples(self):
        self.save(output=100,elapsed=2000,generation_ms=1000,ttft_ms=1000)
        self.save('two',output=300,elapsed=10000,generation_ms=5000,ttft_ms=5000)
        self.save('failed',output=10000,elapsed=1,status='failed')
        self.save('missing',output=None,elapsed=500)
        result=stats.dashboard(self.data);s=result['summary']
        self.assertAlmostEqual(s['tokens_per_second'],400/12)
        self.assertAlmostEqual(s['generation_tokens_per_second'],400/6)
        self.assertEqual((s['speed_samples'],s['generation_samples'],s['calls']),(2,2,4))
        self.assertEqual((s['p50_ttft_ms'],s['p95_ttft_ms']),(1000,5000))
        self.assertIsNone(next(row for row in result['rows'] if row['id']=='failed')['tokens_per_second'])
        self.assertEqual(result['models'][0]['tokens_per_second'],s['tokens_per_second'])

    def test_legacy_database_preserved_without_fabricated_timing(self):
        with sqlite3.connect(self.data/'usage.sqlite3') as db:
            db.execute('CREATE TABLE usage_events(id TEXT PRIMARY KEY,stamp REAL NOT NULL,model TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,input INTEGER,output INTEGER,total INTEGER,cached INTEGER)')
            db.execute("INSERT INTO usage_events VALUES('old',1,'legacy','api_key','completed',10,20,30,NULL)")
        db.close()
        result=stats.dashboard(self.data)
        self.assertEqual((result['summary']['calls'],result['summary']['output_tokens'],result['summary']['unknown']),(1,20,1))
        self.assertEqual(result['summary']['timed'],0)
        self.assertIsNone(result['summary']['tokens_per_second'])
        self.assertIsNone(result['rows'][0]['duration_ms'])
        self.assertEqual(meter.activity(self.data)['totals']['total'],30)

    def test_identity_compares_target_and_keeps_route(self):
        self.save()
        self.save('version',response='alpha-2026-11-17')
        self.save('unknown',response=None)
        self.save('changed',model_changed=1)
        result=stats.dashboard(self.data);s=result['summary']
        self.assertEqual((s['same'],s['different'],s['unknown']),(1,2,1))
        self.assertAlmostEqual(s['identity_rate'],1/3)
        self.assertTrue(all(row['requested_model']=='AutoRouter' for row in result['rows']))
        self.assertEqual(stats.dashboard(self.data,{'identity':['different']})['summary']['calls'],2)

    def test_timing_and_inherited_metadata_are_isolated_per_call(self):
        config={'model':'alpha','_reported_usage':{'output_tokens':999},'_performance':{'first':0}}
        def invoke(c):
            meter.observe(c,'alpha',True);meter.observe(c,'alpha',True)
            return {'model':'alpha','usage':{'output_tokens':60},'choices':[]}
        with patch.object(meter.time,'perf_counter',side_effect=[10,11,13,15]):
            meter.metered(self.data,config,invoke)
        row=stats.dashboard(self.data)['rows'][0]
        self.assertEqual((row['duration_ms'],row['ttft_ms'],row['generation_ms']),(5000,1000,4000))
        self.assertEqual((row['tokens_per_second'],row['generation_tokens_per_second']),(12,15))
        self.assertEqual(config['_performance'],{'first':0})
        meter.metered(self.data,config,lambda c:{'model':'alpha'})
        self.assertEqual(stats.dashboard(self.data)['summary']['output_reported'],1)

    def test_failures_and_cancellation_preserve_partial_usage(self):
        def fail(c):
            meter.observe(c,'alpha',True);c['_reported_usage']={'output_tokens':7}
            raise task_control.Cancelled('fixture')
        with self.assertRaises(task_control.Cancelled):meter.metered(self.data,{'model':'alpha'},fail)
        row=stats.dashboard(self.data)['rows'][0]
        self.assertEqual((row['status'],row['output']),('cancelled',7))
        self.assertIsNone(row['generation_ms']);self.assertIsNone(row['tokens_per_second'])
        with patch.object(meter,'record',side_effect=sqlite3.OperationalError('locked')):
            self.assertEqual(meter.metered(self.data,{},lambda c:'answer'),'answer')

    def test_filters_timezone_and_monthly_lifetime(self):
        stamp=datetime(2026,11,16,18,tzinfo=timezone.utc).timestamp()
        self.save(stamp=stamp)
        self.save('old',model='beta',stamp=1)
        result=stats.dashboard(self.data,{'start':['2026-11-17'],'end':['2026-11-17'],'offset':['480'],'model':['alpha'],'provider':['provider-a']})
        self.assertEqual(result['summary']['calls'],1)
        self.assertEqual(result['trend'][0]['period'],'2026-11-17')
        self.assertEqual(stats.dashboard(self.data)['trend_unit'],'month')
        self.assertEqual(stats.dashboard(self.data,{'end':['2026-11-16'],'offset':['480']})['summary']['calls'],1)

    def test_pagination_and_empty_filters(self):
        for i in range(55):self.save(str(i),stamp=100+i)
        first=stats.dashboard(self.data);last=stats.dashboard(self.data,{'page':['99']})
        self.assertEqual((len(first['rows']),len(last['rows']),last['page'],last['pages']),(50,5,1,2))
        self.assertTrue(set(row['id'] for row in first['rows']).isdisjoint(row['id'] for row in last['rows']))
        empty=stats.dashboard(self.data,{'model':['absent']})
        self.assertEqual((empty['summary']['calls'],empty['summary']['unknown']),(0,0))
        self.assertIsNone(empty['summary']['tokens_per_second']);self.assertEqual(empty['pages'],1)

    def test_invalid_filters_and_sql_parameterization(self):
        for query in [{'offset':['841']},{'page':['-1']},{'start':['bad']},{'start':['2026-11-18'],'end':['2026-11-17']},{'status':['injected']},{'model':['a','b']},{'end':['9999-12-31']}]:
            with self.assertRaises((ValueError,OverflowError)):stats.dashboard(self.data,query)
        self.assertEqual(stats.dashboard(self.data,{'model':["alpha' OR 1=1 --"]})['summary']['calls'],0)

    def test_chat_stream_captures_reasoning_tools_model_and_missing_usage(self):
        events=[{'model':'alpha','choices':[{'delta':{'role':'assistant','content':''}}]},
                {'model':'alpha','choices':[{'delta':{'reasoning_content':'hidden'}}]},
                {'model':'beta','choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'tool','arguments':'{}'}}]}}]},
                {'choices':[],'usage':{'completion_tokens':8}}]
        self.stream(events)
        row=stats.dashboard(self.data)['rows'][0]
        self.assertEqual((row['response_model'],row['identity'],row['output']),('beta','different',8))
        self.assertGreater(row['generation_ms'],0)
        with meter.database(self.data) as db:
            dump=' '.join(db.iterdump())
            for secret in ('hidden','sensitive-prompt','secret-key'):self.assertNotIn(secret,dump)

    def stream(self,events,extra=None):
        raw=''.join('data: '+json.dumps(event)+'\n\n' for event in events).encode()
        if not extra:raw+=b'data: [DONE]\n\n'
        class Reply(io.BytesIO):headers={'Content-Type':'text/event-stream'}
        class Opener:
            def open(self,*a,**k):return Reply(raw)
        config={'model':'alpha','base_url':'https://example.test/v1','api_key':'secret-key','timeout':10,**(extra or {})}
        with patch.object(backend,'DATA',self.data),patch.object(backend.security_net,'opener',return_value=Opener()):
            return backend.stream_upstream(config,{'model':'alpha','messages':[{'role':'user','content':'sensitive-prompt'}]},lambda e:None)

    def test_responses_captures_tool_only_output(self):
        self.stream([{'type':'response.created','response':{'model':'alpha'}},
                     {'type':'response.function_call_arguments.delta','delta':'{'},
                     {'type':'response.function_call_arguments.delta','delta':'}'},
                     {'type':'response.completed','response':{'model':'alpha','status':'completed','output':[],'usage':{'output_tokens':5}}}],
                    {'api_protocol':'responses'})
        row=stats.dashboard(self.data)['rows'][0]
        self.assertEqual((row['identity'],row['output']),('same',5));self.assertGreater(row['generation_ms'],0)

    def test_responses_failure_retains_reported_usage_and_identity(self):
        with self.assertRaises(ValueError):
            self.stream([{'type':'response.incomplete','response':{'model':'alpha','usage':{'output_tokens':12}}}],{'api_protocol':'responses'})
        row=stats.dashboard(self.data)['rows'][0]
        self.assertEqual((row['status'],row['output'],row['response_model']),('failed',12,'alpha'))
        self.assertIsNone(row['tokens_per_second'])

    def test_replaying_record_does_not_replace_original_measurement(self):
        self.save('same-key',response='original')
        self.save('same-key',response='replacement')
        result=stats.dashboard(self.data)
        self.assertEqual(result['summary']['calls'],1)
        self.assertEqual(result['rows'][0]['response_model'],'original')

    def test_anthropic_stream_and_nonstream_reported_model(self):
        self.stream([{'type':'message_start','message':{'model':'alpha','usage':{'input_tokens':10}}},
                     {'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}},
                     {'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'A'}},
                     {'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'B'}},
                     {'type':'message_delta','usage':{'output_tokens':2}}, {'type':'message_stop'}],{'api_protocol':'messages'})
        row=stats.dashboard(self.data)['rows'][0]
        self.assertEqual((row['response_model'],row['output']),('alpha',2));self.assertGreater(row['ttft_ms'],0)
        with patch.object(backend,'DATA',self.data),patch.object(backend.security_net,'opener') as transport:
            transport.return_value.open.return_value=io.BytesIO(json.dumps({'model':'alpha','content':[{'type':'text','text':'A'}],'usage':{'output_tokens':1}}).encode())
            backend.upstream({'model':'alpha','api_protocol':'messages','base_url':'https://example.test','timeout':10},'/chat/completions',{'model':'alpha','messages':[]})
        self.assertEqual(stats.dashboard(self.data)['summary']['same'],2)


if __name__=='__main__':unittest.main()
