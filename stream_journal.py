"""Durable SSE journal. Generation lifetime is independent of HTTP readers."""
from contextlib import contextmanager
import hashlib
import json
import time
import threading

_READERS={}
_READERS_LOCK=threading.Lock()

@contextmanager
def _reader_signal(key):
    with _READERS_LOCK:
        entry=_READERS.get(key)
        if entry is None:
            entry=_READERS[key]=[threading.Condition(),0]
        entry[1]+=1
    try:
        yield entry[0]
    finally:
        with _READERS_LOCK:
            entry[1]-=1
            if not entry[1]:del _READERS[key]


def _notify_readers(key):
    with _READERS_LOCK:
        entry=_READERS.get(key)
    if entry is not None:
        signal=entry[0]
        with signal:signal.notify_all()


# Status and the bounded event page must come from the same SQLite snapshot.
_READ_PAGE='''SELECT request.status,event.id,event.event
FROM stream_requests AS request
LEFT JOIN stream_events AS event ON event.request_id=:key AND event.id>:after
WHERE request.id=:key ORDER BY event.id LIMIT 200'''

def initialize(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS stream_requests(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,hash TEXT NOT NULL,run_id TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS stream_events(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL,event TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS stream_events_request ON stream_events(request_id,id);''')
    db.execute('CREATE TABLE IF NOT EXISTS run_events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,event TEXT NOT NULL)')
    db.execute('CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id,id)')
    for row in db.execute("SELECT id,run_id FROM stream_requests WHERE status='running'").fetchall():
        db.execute('INSERT INTO stream_events(request_id,event) VALUES(?,?)',(row['id'],json.dumps({'type':'error','message':'服务已重启，可查看已接收内容并重新发起任务。'})))
        run=db.execute('SELECT id,events FROM runs WHERE id=?',(row['run_id'],)).fetchone()
        if run:
            events=run_events(db,run)+[{'type':'error','name':'服务重启，任务已中断','time':time.time()}]
            db.execute("UPDATE runs SET status='interrupted',events=? WHERE id=?",(json.dumps(events,ensure_ascii=False),row['run_id']))
            db.execute('DELETE FROM run_events WHERE run_id=?',(row['run_id'],))
    db.execute("UPDATE stream_requests SET status='interrupted' WHERE status='running'")

def fingerprint(body):
    return hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def get(database,key):
    with database() as db:
        row=db.execute('SELECT * FROM stream_requests WHERE id=?',(key,)).fetchone()
        return dict(row) if row else None

def run_events(db,run):
    return json.loads(run['events'])+[json.loads(row['event']) for row in db.execute('SELECT event FROM run_events WHERE run_id=? ORDER BY id',(run['id'],))]

class Writer:
    """One writer connection per run; summaries append once and compact at termination."""
    def __init__(self,database,key,run_id):
        self.database,self.key,self.run_id=database,key,run_id
        self.context=None;self.db=None;self.lock=threading.RLock();self.closed=False
    def publish(self,event):
        with self.lock:return self._publish(event)
    def _publish(self,event):
        if self.closed:return
        kind=event['type']
        if not self.key and kind=='delta':return
        if self.db is None:
            self.context=self.database();self.db=self.context.__enter__()
        db=self.db;event={**event,'time':time.time()}
        try:
            if self.key:db.execute('INSERT INTO stream_events(request_id,event) VALUES(?,?)',(self.key,json.dumps(event,ensure_ascii=False)))
            if kind!='delta':
                stored={k:v for k,v in event.items() if k not in ('content','result','args','input','attachments')}
                if 'result' in event:stored['summary']=json.dumps(event['result'],ensure_ascii=False)[:3000]
                if 'args' in event:stored['path']=event['args'].get('path','')
                db.execute('INSERT INTO run_events(run_id,event) VALUES(?,?)',(self.run_id,json.dumps(stored,ensure_ascii=False)))
                status={'approval':'waiting','done':'complete','error':'failed','cancelled':'cancelled'}.get(kind,'running')
                db.execute('UPDATE runs SET status=?,updated=CURRENT_TIMESTAMP WHERE id=?',(status,self.run_id))
            if kind in ('done','error','cancelled'):
                row=db.execute('SELECT id,events FROM runs WHERE id=?',(self.run_id,)).fetchone()
                if row:
                    db.execute('UPDATE runs SET events=? WHERE id=?',(json.dumps(run_events(db,row),ensure_ascii=False),self.run_id))
                    db.execute('DELETE FROM run_events WHERE run_id=?',(self.run_id,))
                if self.key:db.execute('UPDATE stream_requests SET status=? WHERE id=?',('complete' if kind=='done' else 'cancelled' if kind=='cancelled' else 'failed',self.key))
            db.commit()
        except BaseException:
            db.rollback();self.close();raise
        if self.key:_notify_readers(self.key)
        if kind in ('done','error','cancelled'):self.close()
    def close(self):
        with self.lock:
            self.closed=True
            if self.context is not None:
                context=self.context;self.context=None;self.db=None;context.__exit__(None,None,None)

def publish(database,key,run_id,event):
    writer=Writer(database,key,run_id)
    try:writer.publish(event)
    finally:writer.close()

def serve(handler,database,key,after=0):
    handler.send_response(200)
    handler.send_header('Content-Type','text/event-stream; charset=utf-8')
    handler.send_header('Cache-Control','no-cache')
    handler.send_header('Connection','close')
    handler.end_headers();handler.close_connection=True
    heartbeat=time.monotonic()
    try:
        with _reader_signal(key) as signal,database() as db:
            while True:
                with signal:
                    rows=db.execute(_READ_PAGE,{'key':key,'after':after}).fetchall()
                    if not rows:return
                    if rows[0]['id'] is None:
                        if rows[0]['status']!='running':return
                        signal.wait(.5)
                        rows=()
                for row in rows:
                    handler.wfile.write(('id: '+str(row['id'])+'\ndata: '+row['event']+'\n\n').encode())
                    handler.wfile.flush();after=row['id']
                if time.monotonic()-heartbeat>10:
                    handler.wfile.write(b': heartbeat\n\n');handler.wfile.flush();heartbeat=time.monotonic()
    except (OSError,ConnectionError):return
