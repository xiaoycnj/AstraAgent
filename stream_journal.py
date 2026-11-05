"""Durable SSE journal. Generation lifetime is independent of HTTP readers."""
import hashlib
import json
import time

def initialize(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS stream_requests(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,hash TEXT NOT NULL,run_id TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS stream_events(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL,event TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS stream_events_request ON stream_events(request_id,id);''')
    for row in db.execute("SELECT id FROM stream_requests WHERE status='running'").fetchall():
        db.execute('INSERT INTO stream_events(request_id,event) VALUES(?,?)',(row['id'],json.dumps({'type':'error','message':'服务已重启，可查看已接收内容并重新发起任务。'})))
    db.execute("UPDATE stream_requests SET status='interrupted' WHERE status='running'")

def fingerprint(body):
    return hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def get(database,key):
    with database() as db:
        row=db.execute('SELECT * FROM stream_requests WHERE id=?',(key,)).fetchone()
        return dict(row) if row else None

def publish(database,key,run_id,event):
    event={**event,'time':time.time()}
    with database() as db:
        db.execute('INSERT INTO stream_events(request_id,event) VALUES(?,?)',(key,json.dumps(event,ensure_ascii=False)))
        if event['type']!='delta':
            row=db.execute('SELECT events FROM runs WHERE id=?',(run_id,)).fetchone()
            events=json.loads(row['events'])
            stored={k:v for k,v in event.items() if k not in ('content','result','args','input','attachments')}
            if 'result' in event:stored['summary']=json.dumps(event['result'],ensure_ascii=False)[:3000]
            if 'args' in event:stored['path']=event['args'].get('path','')
            events.append(stored)
            status={'approval':'waiting','done':'complete','error':'failed','cancelled':'cancelled'}.get(event['type'],'running')
            db.execute('UPDATE runs SET status=?,events=?,updated=CURRENT_TIMESTAMP WHERE id=?',(status,json.dumps(events,ensure_ascii=False),run_id))
        if event['type'] in ('done','error','cancelled'):
            db.execute('UPDATE stream_requests SET status=? WHERE id=?',('complete' if event['type']=='done' else 'cancelled' if event['type']=='cancelled' else 'failed',key))

def serve(handler,database,key,after=0):
    handler.send_response(200)
    handler.send_header('Content-Type','text/event-stream; charset=utf-8')
    handler.send_header('Cache-Control','no-cache')
    handler.send_header('Connection','close')
    handler.end_headers();handler.close_connection=True
    heartbeat=time.monotonic()
    try:
        while True:
            with database() as db:
                rows=db.execute('SELECT id,event FROM stream_events WHERE request_id=? AND id>? ORDER BY id LIMIT 200',(key,after)).fetchall()
                job=db.execute('SELECT status FROM stream_requests WHERE id=?',(key,)).fetchone()
            for row in rows:
                handler.wfile.write(('id: '+str(row['id'])+'\ndata: '+row['event']+'\n\n').encode())
                handler.wfile.flush();after=row['id']
            if not rows and (not job or job['status']!='running'):return
            if time.monotonic()-heartbeat>10:
                handler.wfile.write(b': heartbeat\n\n');handler.wfile.flush();heartbeat=time.monotonic()
            if not rows:time.sleep(.12)
    except (OSError,ConnectionError):return
