import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
import application_plugins as plugins
import extensions,local_account,release_feed

class ApplicationExtensions(unittest.TestCase):
 def test_import_switch_and_send_hooks(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);data=root/'data';data.mkdir()
   manifest={'schema_version':2,'id':'fixture','name':'Fixture','version':'1','description':'test','hooks':[{'event':'before_send','action':'limit_length','value':5},{'event':'before_send','action':'prefix','value':'>'}],'panels':[]}
   plugins.install(root,manifest)
   self.assertEqual(plugins.before_send(root,data,'abc'),'abc')
   extensions.toggle_plugin(root,data,'fixture',True)
   self.assertEqual(plugins.before_send(root,data,'abc'),'>abc')
   self.assertEqual(plugins.before_send(root,data,'>abc'),'>abc')
   with self.assertRaises(ValueError):plugins.before_send(root,data,'123456')
   with self.assertRaises(ValueError):plugins.install(root,manifest)
   manifest['id']='../outside'
   with self.assertRaises(ValueError):plugins.install(root,manifest)
 def test_region_and_context(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);root.joinpath('memory').mkdir()
   result=local_account.save_profile(root,{'region':'台湾'})
   self.assertEqual(result['region'],'中国（台湾）')
   self.assertIn('中国（台湾）',local_account.context(root,root))
 def test_update_fallback_and_reject_foreign_asset(self):
  release={'tag_name':'v3.5.0','assets':[{'name':'demo.zip','size':1,'digest':'sha256:'+'a'*64,'browser_download_url':'https://github.com/xiaoycnj/AstraAgent/releases/download/v3.5.0/demo.zip'}]}
  failure=HTTPError('fixture',403,'rate limit',{},None)
  with patch.object(release_feed,'read',side_effect=[failure,release]):self.assertEqual(release_feed.fetch()['tag_name'],'v3.5.0')
  release['assets'][0]['browser_download_url']='https://example.org/demo.zip'
  with patch.object(release_feed,'read',side_effect=[failure,release]),self.assertRaises(ValueError):release_feed.fetch()

 def test_reply_archive_is_idempotent(self):
  import sqlite3
  from contextlib import contextmanager
  import attachments
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);data=root/'data';data.mkdir()
   plugins.install(root,{'schema_version':2,'id':'archive-fixture','name':'Archive','version':'1','description':'test','hooks':[{'event':'after_response','action':'save_output','value':''}]})
   extensions.toggle_plugin(root,data,'archive-fixture',True)
   @contextmanager
   def database():
    db=sqlite3.connect(data/'fixture.sqlite3');db.row_factory=sqlite3.Row
    try:yield db;db.commit()
    finally:db.close()
   with database() as db:
    db.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY)');db.execute('INSERT INTO sessions VALUES(?)',('s',))
    db.execute('CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT)')
    db.execute('INSERT INTO messages VALUES(1,?,?,?)',('s','assistant','Saved reply'))
    attachments.initialize(db)
   events=[]
   for _ in range(2):plugins.after_response(root,data,database,'s',1,events.append)
   with database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM session_outputs').fetchone()[0],1)
   self.assertTrue(all(event['status']=='complete' for event in events))
