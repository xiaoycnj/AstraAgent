"""Session-scoped aggregation, legacy attachment references and saved outputs."""
import base64
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import attachments
import backend


class SessionResources(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.data=Path(self.temp.name)
        self.data_patch=patch.object(backend,'DATA',self.data)
        self.data_patch.start()
        backend.initialize()
        with backend.database() as db:
            db.executemany('INSERT INTO sessions(id,title) VALUES(?,?)',[('one','One'),('two','Two')])

    def tearDown(self):
        self.data_patch.stop()
        self.temp.cleanup()

    def test_legacy_sources_are_unique_scoped_and_missing_safe(self):
        item=attachments.upload(self.data,{'name':'<test>.txt','data':base64.b64encode(b'private source').decode()})
        missing='f'*32
        with backend.database() as db:
            for ids in [[item['id']],[item['id'],missing]]:
                db.execute('INSERT INTO messages(session_id,role,content,attachments) VALUES(?,?,?,?)',('one','user','Read',json.dumps(ids)))
            data=attachments.resources(db,self.data,'one')
            self.assertEqual(len(data['sources']),2)
            self.assertEqual(data['sources'][0]['name'],'<test>.txt')
            self.assertNotIn('text',data['sources'][0])
            self.assertTrue(data['sources'][1]['unavailable'])
            self.assertEqual(attachments.resources(db,self.data,'two'),{'sources':[],'outputs':[]})

    def test_output_creation_retry_and_session_deletion(self):
        with backend.database() as db:
            message=db.execute("INSERT INTO messages(session_id,role,content) VALUES('one','assistant','# Answer')").lastrowid
        with backend.database() as db:
            db.execute('BEGIN IMMEDIATE')
            first=attachments.save_output(db,self.data,'one',{'message_id':message})
        with backend.database() as db:
            db.execute('BEGIN IMMEDIATE')
            repeated=attachments.save_output(db,self.data,'one',{'message_id':message})
            self.assertEqual(repeated['id'],first['id'])
        with backend.database() as db:
            with self.assertRaises(ValueError):attachments.save_output(db,self.data,'two',{'message_id':message})
        with backend.database() as db:
            db.execute('BEGIN IMMEDIATE')
            created=attachments.save_output(db,self.data,'one',{'name':'My note','content':'Hello'})
            self.assertEqual(created['name'],'My note.md')
            self.assertEqual(attachments.meta(self.data,created['id'])['text'],'Hello')
            self.assertEqual(len(attachments.resources(db,self.data,'one')['outputs']),2)
            db.execute("DELETE FROM sessions WHERE id='one'")
        with backend.database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM session_outputs').fetchone()[0],0)

    def test_invalid_output_does_not_create_files(self):
        with backend.database() as db:
            for body in [{'content':''},{'content':'x'*60001},{'message_id':True},{'message_id':999}]:
                with self.assertRaises(ValueError):attachments.save_output(db,self.data,'one',body)
        self.assertFalse((self.data/'attachments').exists())


if __name__=='__main__':unittest.main()
