"""Durable journal snapshot, paging and crash invariants."""
from contextlib import contextmanager
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import stream_journal as journal


class Handler:
    def __init__(self):
        self.wfile = io.BytesIO()

    def send_response(self, *_): pass
    def send_header(self, *_): pass
    def end_headers(self): pass

    def events(self):
        return [(int(cursor[4:]), json.loads(data[6:]))
                for cursor, data in (frame.splitlines() for frame in self.wfile.getvalue().split(b'\n\n')
                                     if frame.startswith(b'id: '))]


class StreamJournal(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / 'journal.sqlite3'
        with self.database() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,events TEXT,updated TEXT)')
            journal.initialize(db)
            db.execute("INSERT INTO runs VALUES('run','running','[]','')")
            db.execute("INSERT INTO stream_requests(id,session_id,hash,run_id,status,input) "
                       "VALUES('key','session','hash','run','running','{}')")

    @contextmanager
    def database(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def test_terminal_commit_after_empty_read_reaches_all_same_key_readers(self):
        empty_snapshot = threading.Event()
        committed = threading.Event()
        reader_errors = []
        handlers = [Handler(), Handler()]
        notifier = journal._notify_readers

        # Hold the result of the empty read until another connection commits.
        class ReaderConnection:
            def __init__(self, db):
                self.db = db

            def execute(self, sql, args):
                self.rows = self.db.execute(sql, args).fetchall()
                if self.rows and self.rows[0]['id'] is None and self.rows[0]['status'] == 'running':
                    empty_snapshot.set()
                    if not committed.wait(5):
                        raise TimeoutError('Terminal event did not commit')
                return self

            def fetchall(self):
                return self.rows

        @contextmanager
        def reader_database():
            with self.database() as db:
                yield ReaderConnection(db)

        def read(handler):
            try:
                journal.serve(handler, reader_database, 'key')
            except Exception as exc:
                reader_errors.append(exc)

        def notify(key):
            committed.set()  # publish() calls this hook only after committing.
            notifier(key)

        readers = [threading.Thread(target=read, args=(h,), daemon=True) for h in handlers]
        with patch.object(journal, '_notify_readers', side_effect=notify):
            for thread in readers:
                thread.start()
            try:
                self.assertTrue(empty_snapshot.wait(5))
                journal.publish(self.database, 'key', 'run', {'type': 'done'})
            finally:
                committed.set()
                for thread in readers:
                    thread.join(6)
        self.assertFalse(reader_errors)
        self.assertFalse(any(thread.is_alive() for thread in readers))
        self.assertEqual(handlers[0].events(), handlers[1].events())
        self.assertEqual([event['type'] for _, event in handlers[0].events()], ['done'])
        self.assertNotIn('key', journal._READERS)

    def test_cursor_spans_pages_and_excludes_other_requests(self):
        with self.database() as db:
            db.executemany('INSERT INTO stream_events(request_id,event) VALUES(?,?)',
                           [(key, json.dumps({'type': 'delta', 'text': str(i)}))
                            for i in range(430) for key in ('key', 'other')])
            after = db.execute("SELECT id FROM stream_events WHERE request_id='key' ORDER BY id LIMIT 1").fetchone()['id']
        journal.publish(self.database, 'key', 'run', {'type': 'cancelled'})
        handler = Handler()
        journal.serve(handler, self.database, 'key', after)
        events = handler.events()
        self.assertEqual([event['text'] for _, event in events[:-1]], [str(i) for i in range(1, 430)])
        self.assertEqual(events[-1][1]['type'], 'cancelled')
        self.assertEqual([eid for eid, _ in events], sorted(set(eid for eid, _ in events)))
        self.assertTrue(all(eid > after for eid, _ in events))
        self.assertNotIn('key', journal._READERS)

    def test_keyless_delta_does_not_open_a_database(self):
        def unexpected():
            self.fail('Keyless text must not be journaled')
        writer = journal.Writer(unexpected, None, 'run')
        writer.publish({'type': 'delta', 'text': 'live only'})
        writer.close()

    def test_process_exit_keeps_committed_delta_prefix(self):
        child = '''
from contextlib import contextmanager
import os, sqlite3, sys
import stream_journal as journal
@contextmanager
def database():
    with sqlite3.connect(sys.argv[1]) as db:
        yield db
writer = journal.Writer(database, 'key', 'run')
writer.publish({'type': 'delta', 'text': 'committed '})
writer.publish({'type': 'delta', 'text': 'prefix'})
os._exit(0)
'''
        subprocess.run([sys.executable, '-c', child, str(self.path)], cwd=ROOT, check=True, timeout=10)
        with self.database() as db:
            journal.initialize(db)
        handler = Handler()
        journal.serve(handler, self.database, 'key')
        events = handler.events()
        self.assertEqual([event['type'] for _, event in events], ['delta', 'delta', 'error'])
        self.assertEqual(''.join(event['text'] for _, event in events[:-1]), 'committed prefix')
        suffix = Handler()
        journal.serve(suffix, self.database, 'key', events[0][0])
        self.assertEqual(suffix.events(), events[1:])


if __name__ == '__main__':
    unittest.main()
