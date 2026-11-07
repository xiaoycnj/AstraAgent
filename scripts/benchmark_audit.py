"""Synthetic, local-only audit benchmark. No provider calls or real workspace data."""
from contextlib import contextmanager
import hashlib,json,sqlite3,sys,tempfile,time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend,project_workspace,stream_journal,security_audit

def timed(action):
    start=time.perf_counter();action();return round((time.perf_counter()-start)*1000,2)

def main():
    with tempfile.TemporaryDirectory(prefix='astra-audit-bench-') as folder:
        root=Path(folder);project=root/'project';project.mkdir();data=root/'data';data.mkdir()
        for index in range(500):(project/(str(index)+'.txt')).write_bytes(b'x'*20000)
        record=project_workspace.save(data,{'name':'synthetic','path':str(project)})
        def legacy_reads():
            for path in project.iterdir():
                with path.open('rb') as source:hashlib.sha256(source.read(project_workspace.MAX_FILE_BYTES+1)).digest()
        old=timed(legacy_reads);new=timed(lambda:project_workspace.scan(data,record))
        with patch.object(project_workspace,'scan',wraps=project_workspace.scan) as scanned:
            point=project_workspace.checkpoint(data,record['id']);manifest={}
            project_workspace.verify(data,record['id'],[],lambda check:None,capture=manifest)
            project_workspace.diff(data,record['id'],point['id'],current=manifest)
            scan_count=scanned.call_count
        dbpath=root/'events.sqlite3';opens=[]
        @contextmanager
        def database():
            opens.append(1);db=sqlite3.connect(dbpath);db.row_factory=sqlite3.Row
            try:yield db;db.commit()
            finally:db.close()
        with database() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,events TEXT,updated TEXT)')
            db.execute("INSERT INTO runs VALUES('new','running','[]','')")
            db.execute("INSERT INTO runs VALUES('old','running','[]','')")
            stream_journal.initialize(db)
        events=[{'type':'tool_start','name':'synthetic-'+str(i)} for i in range(150)]
        def legacy_events():
            summaries=[]
            for event in events:
                summaries.append(event)
                with database() as db:db.execute("UPDATE runs SET events=? WHERE id='old'",(json.dumps(summaries),))
        opens.clear();old_events=timed(legacy_events);old_opens=len(opens)
        def new_events():
            writer=stream_journal.Writer(database,None,'new')
            for event in events:writer.publish(event)
            writer.publish({'type':'done'})
        opens.clear();new_event_ms=timed(new_events);new_opens=len(opens)
        original=backend.ROOT,backend.DATA;backend.ROOT,backend.DATA=root,data
        try:
            skill=root/'skills/general';skill.mkdir(parents=True);(skill/'SKILL.md').write_text('# General\nHelp')
            config=backend.request_config({'allow_tools':True})
            selected=[item for item in backend.TOOL_DEFS if item['function']['name'] in config['tools']]
        finally:backend.ROOT,backend.DATA=original
        sync=security_audit.os.fsync
        with patch.object(security_audit.os,'fsync',wraps=sync) as synced:
            def audit():
                for i in range(100):
                    key=security_audit.append(data,'attempt','calculator',{}, {})
                    security_audit.append(data,'authorization','calculator',{}, {},key,'approved')
                    security_audit.append(data,'outcome','calculator',{}, {},key,'completed')
                security_audit.flush_pending()
            audit_ms=timed(audit);audit_syncs=synced.call_count
        print(json.dumps({'files':500,'bytes':10_000_000,'legacy_upper_bound_read_ms':old,'bounded_full_scan_ms':new,'unchanged_turn_scans':scan_count,
                          'events':150,'legacy_event_ms':old_events,'append_event_ms':new_event_ms,'legacy_event_connections':old_opens,'append_event_connections':new_opens,
                          'all_schema_chars':len(json.dumps(backend.TOOL_DEFS)),'initial_schema_chars':len(json.dumps(selected)),'initial_tools':len(selected),
                          'audit_records':300,'audit_fsyncs':audit_syncs,'audit_ms':audit_ms},indent=2))

if __name__=='__main__':main()
