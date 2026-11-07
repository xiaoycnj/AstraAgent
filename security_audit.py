"""Append-only, payload-free tool authorization trail. Storage failure blocks dispatch."""
from datetime import datetime, timezone
import json
import os
import threading
import uuid
import hashlib
from pathlib import Path

import security_core
import atexit

LOCK = threading.Lock()
DIRTY=set()
FAILURES={}
WAKE=threading.Event()

def flush_pending():
    with LOCK:
        for path in list(DIRTY):
            try:
                with path.open('r+b') as stream:stream.flush();os.fsync(stream.fileno())
                DIRTY.discard(path)
            except FileNotFoundError:DIRTY.discard(path)
            except OSError as error:FAILURES[path]=error;DIRTY.discard(path)

def _flusher():
    while True:
        WAKE.wait();threading.Event().wait(.05);WAKE.clear();flush_pending()

threading.Thread(target=_flusher,name='astra-audit-flush',daemon=True).start()
atexit.register(flush_pending)


def append(data, phase, name, args, config, operation=None, status=None):
    operation = operation or uuid.uuid4().hex
    # No file bodies, command arguments, provider keys, tool results or paths in plaintext.
    row = {'id': operation, 'time': datetime.now(timezone.utc).isoformat(),
           'phase': phase, 'tool': str(name)[:100], 'arguments_sha256': security_core.digest(args),
           'policy': config.get('access_policy', ''), 'model': config.get('model', '')[:200],
           'session': config.get('_session_id', ''), 'status': status}
    for field in ('path', 'destination'):
        value=args.get(field)
        if not isinstance(value,str):continue
        row[field+'_sha256']=security_core.digest(value)
        try:
            security_core.relative_path(value)
            root=Path(config.get('project_root') or data/'files').resolve()
            target=security_core.protect_private((root/value).resolve())
            if phase=='attempt' and target.is_relative_to(root) and target.is_file() and target.stat().st_size<=10_000_000:
                with target.open('rb') as stream:row[field+'_content_sha256']=hashlib.file_digest(stream,'sha256').hexdigest()
        except (ValueError,OSError):pass
    with LOCK:
        path = data / 'security-audit.jsonl'
        if path in FAILURES:raise OSError('安全审计写盘失败，已停止执行') from FAILURES[path]
        try:
            with path.open('ab') as stream:
                stream.write((json.dumps(row, ensure_ascii=False) + '\n').encode())
                stream.flush()
                # Authorization + preceding attempt are durable before dispatch.
                if phase in ('authorization','api_attempt'):
                    os.fsync(stream.fileno());DIRTY.discard(path)
                else:DIRTY.add(path);WAKE.set()
        except OSError as error:FAILURES[path]=error;raise
    return operation


def recent(data, limit=200):
    path = data / 'security-audit.jsonl'
    if not path.exists():
        return []
    with LOCK:
        with path.open('rb') as stream:
            stream.seek(max(0, path.stat().st_size - 512000))
            if stream.tell():stream.readline()
            return [json.loads(line) for line in stream if line.strip()][-limit:]
