"""Durable execution checkpoints. Unknown side effects require human resolution."""
import hashlib
import json
import threading


class Blocked(RuntimeError):
    pass


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


REQUEST_FIELDS = ('provider','model','reasoning','skill','tools','allow_tools','plugins',
                  'file_permission','command_permission','command_mode','memory_policy',
                  'auto_memory','access_policy','project_id','auto_min_tier')
CONTEXT_FIELDS = ('tools','runtime_plugins','system_prompt','active_skill','_untrusted_context',
                  '_mutation_epoch','delegated_count','cross_dispatch_count','cross_dispatch_depth','_verification')


def initialize(db):
    if 'history_epoch' not in {r['name'] for r in db.execute('PRAGMA table_info(sessions)')}:
        db.execute('ALTER TABLE sessions ADD COLUMN history_epoch INTEGER NOT NULL DEFAULT 0')
    db.executescript('''
    CREATE TRIGGER IF NOT EXISTS messages_history_update AFTER UPDATE OF content,role,attachments ON messages
      WHEN OLD.content IS NOT NEW.content OR OLD.role IS NOT NEW.role OR OLD.attachments IS NOT NEW.attachments
      BEGIN UPDATE sessions SET history_epoch=history_epoch+1 WHERE id=NEW.session_id; END;
    CREATE TRIGGER IF NOT EXISTS messages_history_delete AFTER DELETE ON messages
      BEGIN UPDATE sessions SET history_epoch=history_epoch+1 WHERE id=OLD.session_id; END;
    CREATE TABLE IF NOT EXISTS executions(
      request_id TEXT PRIMARY KEY REFERENCES stream_requests(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      options TEXT NOT NULL, boundary INTEGER NOT NULL, payload TEXT,
      checkpoint TEXT, status TEXT NOT NULL DEFAULT 'running',
      user_id INTEGER, answer_id INTEGER, error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS execution_steps(
      request_id TEXT NOT NULL REFERENCES executions(request_id) ON DELETE CASCADE,
      step TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
      fingerprint TEXT NOT NULL, status TEXT NOT NULL, result TEXT, context TEXT,
      PRIMARY KEY(request_id,step));
    ''')
    db.execute("UPDATE execution_steps SET status='pending' WHERE status='executing' AND name='dispatch_agents'")
    db.execute("UPDATE execution_steps SET status='unknown' WHERE status='executing' AND kind!='model'")
    db.execute("UPDATE execution_steps SET status='pending' WHERE status IN ('waiting','executing')")
    db.execute("UPDATE executions SET status=CASE WHEN EXISTS(SELECT 1 FROM execution_steps s WHERE s.request_id=executions.request_id AND s.status='unknown') THEN 'blocked' ELSE 'interrupted' END WHERE status='running'")


def create(db, key, sid, body, config):
    options={name:body[name] for name in REQUEST_FIELDS if name in body}
    # Remember the effective ceiling, never provider credentials or a live approval.
    options['access_policy']=config['access_policy']
    options['model']=config['model']
    if config.get('id'):options['provider']=config['id']
    if config.get('_routing_deferred'):
        options['model']='AutoModelReview';options['provider']=body.get('provider','')
    for name in ('file_permission','command_permission','command_mode','memory_policy','auto_memory'):
        if name in config:options[name]=config[name]
    options['allow_tools']=bool(config.get('tools'))
    options['_cross_dispatch_depth']=config.get('cross_dispatch_depth',0)
    options['project_id']=config.get('project_id','')
    options['_project_root']=config.get('project_root','')
    boundary=db.execute('SELECT COALESCE(MAX(id),0) FROM messages WHERE session_id=?',(sid,)).fetchone()[0]
    options['_history_epoch']=db.execute('SELECT history_epoch FROM sessions WHERE id=?',(sid,)).fetchone()[0]
    db.execute('INSERT INTO executions(request_id,session_id,options,boundary) VALUES(?,?,?,?)',
               (key,sid,encode(options),boundary))


def inspect(db, key):
    row=db.execute('SELECT request_id,session_id,status,checkpoint,answer_id,error FROM executions WHERE request_id=?',(key,)).fetchone()
    if not row:return None
    steps=[dict(s) for s in db.execute('SELECT step,kind,name,status FROM execution_steps WHERE request_id=? ORDER BY rowid',(key,))]
    return {**dict(row),'steps':steps,'resumable':row['status'] in ('interrupted','blocked','cancelled')}


def resolve(db, key, step, action):
    if action not in ('retry','skip'):raise ValueError('只能选择明确重试或跳过')
    if not isinstance(step,str) or not step or len(step)>500:raise ValueError('步骤标识无效')
    row=db.execute("SELECT status FROM execution_steps WHERE request_id=? AND step=?",(key,step)).fetchone()
    if not row or row['status']!='unknown':raise ValueError('步骤没有待处理的不确定结果')
    if action=='retry':db.execute("UPDATE execution_steps SET status='pending' WHERE request_id=? AND step=?",(key,step))
    else:db.execute("UPDATE execution_steps SET status='done',result=?,context='{}' WHERE request_id=? AND step=?",(encode({'error':'用户核对后跳过此步骤，执行结果未知，不能声称成功'}),key,step))
    db.execute("UPDATE executions SET status='interrupted',error='' WHERE request_id=?",(key,))


class State:
    def __init__(self, database, key):
        self.key=key;self.context=database();self.db=self.context.__enter__();self.lock=threading.RLock()

    def close(self):
        with self.lock:
            if self.context:
                context=self.context;self.context=None;context.__exit__(None,None,None)

    def resolve_model(self, config):
        with self.lock:
            row=self.db.execute('SELECT options FROM executions WHERE request_id=?',(self.key,)).fetchone()
            options=json.loads(row['options'])
            options.update(model=config['model'],provider=config.get('id',''),reasoning=config.get('reasoning','default'),plugins=config.get('runtime_plugins',[]),_auto_route=config.get('_routing'))
            self.db.execute('UPDATE executions SET options=? WHERE request_id=?',(encode(options),self.key));self.db.commit()

    def initial(self, payload, config=None):
        with self.lock:
            row=self.db.execute('SELECT payload FROM executions WHERE request_id=?',(self.key,)).fetchone()
            if row['payload']:
                saved=json.loads(row['payload'])
                if 'request' not in saved:return saved
                if config is not None:
                    self.restore(saved,config)
                    if config.get('access_policy')=='deny':config['tools']=[]
                return saved['request']
            snapshot={'request':payload,'context':{k:config[k] for k in CONTEXT_FIELDS if k in config} if config else {}}
            self.db.execute('UPDATE executions SET payload=? WHERE request_id=?',(encode(snapshot),self.key));self.db.commit()
            return payload

    def begin(self, step, kind, name, identity):
        with self.lock:
            digest=hashlib.sha256(encode(identity).encode()).hexdigest()
            row=self.db.execute('SELECT * FROM execution_steps WHERE request_id=? AND step=?',(self.key,step)).fetchone()
            if row:
                if row['fingerprint']!=digest:raise Blocked('执行步骤与已保存记录不符，请查看任务记录')
                if row['status']=='unknown' or (row['status']=='executing' and kind!='model'):raise Blocked('步骤结果不确定，请先核对后选择跳过或明确重试：'+name)
                if row['status']=='done':return {'result':json.loads(row['result']),'context':json.loads(row['context'] or '{}')}
            else:
                self.db.execute('INSERT INTO execution_steps(request_id,step,kind,name,fingerprint,status) VALUES(?,?,?,?,?,?)',
                                (self.key,step,kind,name,digest,'pending'));self.db.commit()
            return None

    def phase(self, step, phase):
        with self.lock:
            self.db.execute('UPDATE execution_steps SET status=? WHERE request_id=? AND step=?',(phase,self.key,step));self.db.commit()

    def done(self, step, result, context=None):
        with self.lock:
            self.db.execute("UPDATE execution_steps SET status='done',result=?,context=? WHERE request_id=? AND step=?",(encode(result),encode(context or {}),self.key,step));self.db.commit()

    def tool_done(self, step, result, config):
        self.done(step,result,{k:config[k] for k in CONTEXT_FIELDS if k in config})

    def restore(self, cached, config):
        for name in CONTEXT_FIELDS:
            if name in cached['context']:config[name]=cached['context'][name]

    def pause(self, error, cancelled=False):
        with self.lock:
            self.db.execute("UPDATE execution_steps SET status='pending' WHERE request_id=? AND status='executing' AND name='dispatch_agents'",(self.key,))
            self.db.execute("UPDATE execution_steps SET status='unknown' WHERE request_id=? AND status='executing' AND kind!='model'",(self.key,))
            unknown=self.db.execute("SELECT 1 FROM execution_steps WHERE request_id=? AND status='unknown'",(self.key,)).fetchone()
            self.db.execute('UPDATE executions SET status=?,error=? WHERE request_id=?',('blocked' if unknown else 'cancelled' if cancelled else 'interrupted',str(error)[:300],self.key));self.db.commit()

    def checkpoint(self, value):
        with self.lock:
            self.db.execute('UPDATE executions SET checkpoint=? WHERE request_id=?',(value,self.key));self.db.commit()

    def save_answer(self, sid, content, attachments, answer, model):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            row=self.db.execute('SELECT user_id,answer_id,options FROM executions WHERE request_id=?',(self.key,)).fetchone()
            if not row['user_id']:
                uid=self.db.execute('INSERT INTO messages(session_id,role,content,attachments) VALUES(?,?,?,?)',(sid,'user',content,encode(attachments))).lastrowid
                self.db.execute('UPDATE executions SET user_id=? WHERE request_id=?',(uid,self.key))
            aid=row['answer_id']
            if aid:self.db.execute('UPDATE messages SET content=?,model=? WHERE id=?',(answer,model,aid))
            else:
                aid=self.db.execute('INSERT INTO messages(session_id,role,content,model) VALUES(?,?,?,?)',(sid,'assistant',answer,model)).lastrowid
                self.db.execute('UPDATE executions SET answer_id=? WHERE request_id=?',(aid,self.key))
            options=json.loads(row['options'])
            options['_history_epoch']=self.db.execute('SELECT history_epoch FROM sessions WHERE id=?',(sid,)).fetchone()[0]
            self.db.execute('UPDATE executions SET options=? WHERE request_id=?',(encode(options),self.key))
            self.db.commit();return aid

    def finish(self):
        with self.lock:
            self.assert_safe()
            self.db.execute("UPDATE executions SET status='complete',error='' WHERE request_id=?",(self.key,));self.db.commit()

    def assert_safe(self, prefix=''):
        with self.lock:
            row=self.db.execute("SELECT name FROM execution_steps WHERE request_id=? AND substr(step,1,length(?))=? AND kind!='model' AND name!='dispatch_agents' AND status IN ('executing','unknown') LIMIT 1",(self.key,prefix,prefix)).fetchone()
            if row:raise Blocked('存在结果不确定的步骤，需要先人工核对：'+row['name'])


class Scope:
    """A child uses the parent's durable transaction log, with its own step namespace."""
    def __init__(self, state, prefix):self.state=state;self.prefix=prefix+'/'
    def begin(self, step, *args):return self.state.begin(self.prefix+step,*args)
    def phase(self, step, phase):return self.state.phase(self.prefix+step,phase)
    def done(self, step, *args):return self.state.done(self.prefix+step,*args)
    def tool_done(self, step, *args):return self.state.tool_done(self.prefix+step,*args)
    def restore(self, *args):return self.state.restore(*args)
    def assert_safe(self):return self.state.assert_safe(self.prefix)
    def initial(self, payload, config=None):
        cached=self.begin('initial','model','子任务输入',{})
        if cached:
            if config is not None:
                self.restore(cached,config)
                if config.get('access_policy')=='deny':config['tools']=[]
            return cached['result']
        self.done('initial',payload,{k:config[k] for k in CONTEXT_FIELDS if k in config} if config else {});return payload
