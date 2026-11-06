"""Provider-reported model usage, with no prompts, credentials or estimated tokens."""
from contextlib import contextmanager
from datetime import date, datetime, timezone, timedelta
import sqlite3
import time
import uuid

@contextmanager
def database(data):
    data.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(data/'usage.sqlite3',timeout=2);db.row_factory=sqlite3.Row
    try:
        db.execute('CREATE TABLE IF NOT EXISTS usage_events(id TEXT PRIMARY KEY,stamp REAL NOT NULL,model TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,input INTEGER,output INTEGER,total INTEGER,cached INTEGER)')
        db.execute('CREATE INDEX IF NOT EXISTS usage_stamp ON usage_events(stamp)')
        db.execute('CREATE TABLE IF NOT EXISTS usage_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        db.execute("INSERT OR IGNORE INTO usage_metadata VALUES('since',?)",(str(time.time()),))
        yield db;db.commit()
    finally:db.close()

def counts(usage):
    usage=usage if isinstance(usage,dict) else {}
    def number(value):return value if type(value) is int and 0<=value<=9007199254740991 else None
    incoming=number(usage.get('input_tokens',usage.get('prompt_tokens')))
    outgoing=number(usage.get('output_tokens',usage.get('completion_tokens')))
    total=number(usage.get('total_tokens'))
    if total is None and incoming is not None and outgoing is not None:total=incoming+outgoing
    detail=usage.get('input_tokens_details',usage.get('prompt_tokens_details',{}))
    cached=number(detail.get('cached_tokens')) if isinstance(detail,dict) else None
    if cached is None:cached=number(usage.get('prompt_cache_hit_tokens'))
    if cached is not None and incoming is not None and cached>incoming:cached=None
    return incoming,outgoing,total,cached

def record(data,key,model,source,status,usage,stamp=None):
    incoming,outgoing,total,cached=counts(usage)
    with database(data) as db:
        db.execute('INSERT OR IGNORE INTO usage_events VALUES(?,?,?,?,?,?,?,?,?)',(key,time.time() if stamp is None else stamp,str(model)[:200],source,status,incoming,outgoing,total,cached))

def metered(data,c,invoke):
    config=dict(c);result=None;status='failed'
    try:
        result=invoke(config);status='completed';return result
    finally:
        reported=config.get('_reported_usage') or (result.get('usage') if isinstance(result,dict) else None)
        try:record(data,uuid.uuid4().hex,c.get('model',''),c.get('auth_type','api_key'),status,reported)
        except (OSError,sqlite3.Error):print('Token usage recording unavailable',flush=True)

def activity(data,end=None,offset=0):
    if type(offset) is not int or not -840<=offset<=840:raise ValueError('时区偏移无效')
    try:
        finish=date.fromisoformat(end) if end else (datetime.now(timezone.utc)+timedelta(minutes=offset)).date()
        start=finish-timedelta(days=364)
    except (ValueError,OverflowError):raise ValueError('用量日期无效') from None
    with database(data) as db:
        rows=db.execute("SELECT date(stamp,'unixepoch',?) day,COALESCE(SUM(total),0) total,COUNT(*) calls,SUM(CASE WHEN total IS NULL THEN 1 ELSE 0 END) unreported FROM usage_events GROUP BY day",(str(offset)+' minutes',)).fetchall()
        lifetime=db.execute('SELECT COALESCE(SUM(total),0) total,COALESCE(SUM(input),0) input,COALESCE(SUM(output),0) output,COALESCE(SUM(cached),0) cached,COUNT(*) calls,COUNT(input) input_reported,COUNT(output) output_reported,COUNT(cached) cached_reported,COALESCE(SUM(CASE WHEN total IS NULL THEN 1 ELSE 0 END),0) unreported FROM usage_events').fetchone()
        cache=dict(db.execute('SELECT COALESCE(SUM(input),0) input,COALESCE(SUM(cached),0) cached,COUNT(*) calls FROM usage_events WHERE input>0 AND cached IS NOT NULL AND cached<=input').fetchone())
        cache['rate']=cache['cached']/cache['input'] if cache['input'] else None
        since=float(db.execute("SELECT value FROM usage_metadata WHERE key='since'").fetchone()[0])
    lookup={row['day']:dict(row) for row in rows}
    days=[{'day':(start+timedelta(days=i)).isoformat(),'total':0,'calls':0,'unreported':0} for i in range(365)]
    for item in days:item.update(lookup.get(item['day'],{}))
    return {'before_total':sum(item['total'] for item in lookup.values() if item['day']<start.isoformat()),'days':days,'totals':dict(lifetime),'cache':cache,'since':since,'offset_minutes':offset,'includes_model_subrequests':True}
