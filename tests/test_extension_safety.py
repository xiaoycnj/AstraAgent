import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

import application_plugins
import backend
import extension_safety as safety
import extensions
import marketplace


class SafeBootTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / 'app'
        self.data = Path(temp.name) / 'data'
        self.data.mkdir()
        (self.root/'plugins').mkdir(parents=True)
        (self.root/'skills/general').mkdir(parents=True)
        (self.root/'skills/general/SKILL.md').write_text('# General\nCore prompt')
        self.entries = marketplace.read_catalog(Path(__file__).resolve().parents[1]/'marketplace/catalog.json')

    def test_scan_all_plugins_retain_packages_until_explicit_retry(self):
        for name in ('goals','broken'):
            folder = self.root/'plugins'/name
            folder.mkdir()
            (folder/'manifest.json').write_text(json.dumps({'id':name,'schema_version':1,'name':name,'tools':['manage_goal'] if name=='goals' else []}))
        self.assertFalse(safety.check(self.root,self.data)['active'])
        manifest = self.root/'plugins/broken/manifest.json'
        original = manifest.read_bytes()
        manifest.write_bytes(b'{')
        self.assertIn('broken/manifest.json',safety.check(self.root,self.data)['reason'])
        self.assertEqual(b'{',manifest.read_bytes())
        self.assertTrue(safety.check(self.root,self.data,retry=True)['active'])
        manifest.write_bytes(original)
        safety._reasons.pop(self.data.resolve())  # Simulate a fresh interpreter.
        self.assertTrue(safety.check(self.root,self.data)['active'])
        with patch.object(extensions,'read_manifest',side_effect=AssertionError('loaded plugin')):
            catalog = extensions.catalog(self.root,self.data,True)
            self.assertEqual([],catalog['plugins'])
            self.assertEqual(['general'],list(catalog['skills']))
            self.assertEqual('test',application_plugins.before_send(self.root,self.data,'test'))
        self.assertFalse(safety.check(self.root,self.data,retry=True)['active'])
        self.assertIn('goals',[p['id'] for p in extensions.catalog(self.root,self.data)['plugins']])

    def test_corrupt_receipt_removable_without_loading_other_packages(self):
        entry = next(e for e in self.entries if e['kind']=='skin')
        plugin = next(e for e in self.entries if e['kind']=='plugin')
        marketplace.install(self.root,self.data,plugin)
        marketplace.install(self.root,self.data,entry)
        saved = marketplace.activate(self.data,entry['id'])
        key = marketplace.key(entry)
        saved['installed'][key]['payload']['colors']['--blue']='broken'
        marketplace.write_state(self.data,saved)
        self.assertIn(key,safety.check(self.root,self.data)['reason'])
        self.assertIsNone(marketplace.catalog(self.root,self.data)['state']['active_skin'])
        with patch.object(marketplace,'package',side_effect=AssertionError('loaded receipt')):
            with self.assertRaises(ValueError): marketplace.activate(self.data,None)
            with self.assertRaises(ValueError): marketplace.install(self.root,self.data,plugin)
            inventory = marketplace.uninstall(self.root,self.data,'skin',entry['id'])
        self.assertNotIn(key,inventory['installed'])
        self.assertNotIn('payload',next(iter(inventory['installed'].values())))
        self.assertTrue(safety.status(self.data)['active'])
        self.assertFalse(safety.check(self.root,self.data,retry=True)['active'])

    def test_disk_manifest_disagrees_with_receipt(self):
        plugin = next(e for e in self.entries if e['kind']=='plugin')
        marketplace.install(self.root,self.data,plugin)
        path = self.root/'plugins'/plugin['id']/'manifest.json'
        changed = json.loads(path.read_text(encoding='utf-8'))
        changed['name']='Other'
        path.write_text(json.dumps(changed))
        self.assertIn(plugin['id'],safety.check(self.root,self.data)['reason'])
        marketplace.uninstall(self.root,self.data,'plugin',plugin['id'])
        self.assertFalse(safety.check(self.root,self.data,retry=True)['active'])

    def test_malformed_records_do_not_break_core_startup_or_reset_state(self):
        for path in [self.data/'extensions.json',self.data/'marketplace/state.json']:
            with self.subTest(file=path):
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(b'[]')
                self.assertIn(path.name,safety.check(self.root,self.data,retry=True)['reason'])
                self.assertEqual([],marketplace.catalog(self.root,self.data)['entries'])
                self.assertEqual(b'[]',path.read_bytes())
                path.unlink()

    def test_hook_error_reports_only_for_enabled_plugins(self):
        manifest = {'id':'fixture','schema_version':2,'name':'Fixture','version':'1','description':'test','hooks':[{'event':'after_response','action':'save_output','value':''}, {'event':'before_send','action':'limit_length','value':1}]}
        application_plugins.install(self.root,manifest)
        with self.assertRaises(ValueError): safety.plugin_error(self.root,self.data,'fixture')
        extensions.toggle_plugin(self.root,self.data,'fixture',True)
        with self.assertRaises(ValueError): application_plugins.before_send(self.root,self.data,'too long')
        self.assertFalse(safety.status(self.data)['active'])
        self.assertTrue(safety.plugin_error(self.root,self.data,'fixture')['active'])
        self.assertFalse(safety.check(self.root,self.data,retry=True)['active'])
        def unavailable(): raise OSError('private database details')
        events = []
        application_plugins.after_response(self.root,self.data,unavailable,'s',1,events.append)
        self.assertTrue(safety.status(self.data)['active'])
        self.assertIn('fixture',events[0]['message'])
        self.assertNotIn('private',events[0]['message'])

    def test_api_boot_and_retry(self):
        skin = next(e for e in self.entries if e['kind']=='skin')
        marketplace.install(self.root,self.data,skin)
        marketplace.activate(self.data,skin['id'])
        switches = self.data/'extensions.json'
        switches.write_bytes(b'[')
        with patch.object(backend,'ROOT',self.root), patch.object(backend,'DATA',self.data):
            backend.initialize()
            with backend.LocalServer(('127.0.0.1',0),backend.Handler) as server:
                worker = threading.Thread(target=server.serve_forever,daemon=True)
                worker.start()
                def request(path,body=None):
                    req = Request(f'http://127.0.0.1:{server.server_port}/api/'+path,headers={'X-App-Token':backend.TOKEN,'Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
                    with urlopen(req, timeout=5) as response: return json.load(response)
                try:
                    self.assertEqual({'active','reason'},set(request('extensions/safety')))
                    self.assertTrue(request('extensions/safety',{'action':'retry'})['active'])
                    self.assertIsNone(request('marketplace')['state']['active_skin'])
                    self.assertEqual([],request('capabilities')['plugins'])
                    switches.unlink()
                    self.assertFalse(request('extensions/safety',{})['active'])
                    self.assertTrue(request('extensions/safety',{'action':'skin_error','id':skin['id']})['active'])
                    self.assertNotIn('image_gen',backend.recovery_blocked_tools({'conversation_mode':'chat'}))
                    self.assertIn('image_gen',backend.recovery_blocked_tools({'conversation_mode':'agent'}))
                finally:
                    server.shutdown()
                    worker.join()
