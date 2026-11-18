"""Measure durable SQLite writes, replay, and unrelated live-reader work."""
import argparse
from collections import Counter
from contextlib import contextmanager
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import statistics
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class Handler:
    def __init__(self):
        self.wfile = io.BytesIO()

    def send_response(self, *_): pass
    def send_header(self, *_): pass
    def end_headers(self): pass


def trial(journal, path, chunks, readers, allow_missing_terminal):
    counts = Counter()
    activity = threading.Condition()

    @contextmanager
    def database():
        db = sqlite3.connect(path, timeout=15)
        db.row_factory = sqlite3.Row
        role = threading.current_thread().name

        def trace(sql):
            command = sql.lstrip().split(None, 1)[0].upper()
            if command not in ('SELECT', 'WITH', 'COMMIT'):
                return
            if role.startswith('idle-'):
                with activity:
                    counts[role, command] += 1
                    activity.notify_all()
            else:
                counts[role, command] += 1

        db.set_trace_callback(trace)
        try:
            yield db
            db.commit()
        finally:
            db.close()

    with database() as db:
        mode = db.execute('PRAGMA journal_mode=WAL').fetchone()[0]
        synchronous = db.execute('PRAGMA synchronous').fetchone()[0]
        db.execute('CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,events TEXT,updated TEXT)')
        journal.initialize(db)
        keys = ['active'] + [f'idle-{i}' for i in range(readers)]
        db.executemany("INSERT INTO runs VALUES(?,'running','[]','')", [(key,) for key in keys])
        db.executemany("INSERT INTO stream_requests(id,session_id,hash,run_id,status,input) "
                       "VALUES(?,'session','hash',?,'running','{}')", [(k, k) for k in keys])
    role = threading.current_thread().name
    handlers = {key: Handler() for key in keys}
    threads = {key: threading.Thread(target=journal.serve, name=key,
                                      args=(handlers[key], database, key), daemon=True) for key in keys}
    for thread in threads.values():
        thread.start()

    def select_count(thread):
        return counts[thread, 'SELECT'] + counts[thread, 'WITH']

    try:
        with activity:
            if not activity.wait_for(lambda: all(select_count(key) for key in keys[1:]), timeout=10):
                raise RuntimeError('Idle reader did not issue its initial query')
            idle_start = sum(select_count(key) for key in keys[1:])
        commits = counts[role, 'COMMIT']
        writer = journal.Writer(database, 'active', 'active')
        start = time.perf_counter()
        try:
            for i in range(chunks):
                writer.publish({'type': 'delta', 'text': f'chunk-{i}'})
            writer.publish({'type': 'done'})
        finally:
            writer.close()
        write_ms = (time.perf_counter() - start) * 1e3
        commits = counts[role, 'COMMIT'] - commits
        threads['active'].join(10)
        assert not threads['active'].is_alive(), 'Active reader did not finish'
        with activity:
            idle_queries = sum(select_count(key) for key in keys[1:]) - idle_start
        live_missing_terminal = validate(handlers['active'], chunks, allow_missing_terminal)
    finally:
        for key in keys[1:]:
            journal.publish(database, key, key, {'type': 'cancelled'})
        for thread in threads.values():
            thread.join(10)
    replay_count = 30
    replay_selects = select_count(role)
    start = time.perf_counter()
    for _ in range(replay_count):
        handler = Handler()
        journal.serve(handler, database, 'active')
    replay_ms = (time.perf_counter() - start) * 1e3 / replay_count
    replay_selects = (select_count(role) - replay_selects) // replay_count
    validate(handler, chunks)
    return dict(write_ms=write_ms, write_commits=commits, idle_queries=idle_queries,
                replay_ms=replay_ms, replay_queries=replay_selects,
                live_missing_terminal=int(live_missing_terminal), mode=mode, synchronous=synchronous)


def validate(handler, chunks, allow_missing_terminal=False):
    lines = handler.wfile.getvalue().splitlines()
    events = [json.loads(line[6:]) for line in lines if line.startswith(b'data: ')]
    missing = not events or events[-1]['type'] != 'done'
    assert not missing or allow_missing_terminal, 'Missing live terminal event'
    assert [e['text'] for e in (events if missing else events[:-1])] == [f'chunk-{i}' for i in range(chunks)]
    return missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--journal-source', type=Path, default=ROOT / 'stream_journal.py')
    parser.add_argument('--runs', type=int, default=5)
    parser.add_argument('--chunks', type=int, default=1200)
    parser.add_argument('--idle-readers', type=int, default=8)
    parser.add_argument('--allow-missing-terminal', action='store_true',
                        help='Count missing live terminal frames when benchmarking an older journal')
    args = parser.parse_args()
    if args.runs < 1 or args.chunks < 1 or args.idle_readers < 0:
        parser.error('runs/chunks must be positive; idle-readers must be nonnegative')
    spec = importlib.util.spec_from_file_location('benchmark_stream_journal', args.journal_source)
    journal = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(journal)
    with tempfile.TemporaryDirectory(prefix='astra-journal-bench-') as folder:
        runs = [trial(journal, Path(folder) / f'{i}.sqlite3', args.chunks, args.idle_readers,
                      args.allow_missing_terminal) for i in range(args.runs)]
    medians = {key: round(statistics.median(r[key] for r in runs), 3) for key in runs[0]
               if isinstance(runs[0][key], (int, float))}
    print(json.dumps(dict(chunks=args.chunks, idle_readers=args.idle_readers, medians=medians, runs=runs), indent=2))


if __name__ == '__main__':
    main()
