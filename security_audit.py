"""Append-only, payload-free tool authorization trail. Storage failure blocks dispatch."""
from datetime import datetime, timezone
import json
import os
import threading
import uuid
import hashlib
from pathlib import Path

import security_core

LOCK = threading.Lock()


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
            if target.is_relative_to(root) and target.is_file() and target.stat().st_size<=10_000_000:
                with target.open('rb') as stream:row[field+'_content_sha256']=hashlib.file_digest(stream,'sha256').hexdigest()
        except (ValueError,OSError):pass
    with LOCK:
        path = data / 'security-audit.jsonl'
        with path.open('ab') as stream:
            stream.write((json.dumps(row, ensure_ascii=False) + '\n').encode())
            stream.flush()
            os.fsync(stream.fileno())
    return operation


def recent(data, limit=200):
    path = data / 'security-audit.jsonl'
    if not path.exists():
        return []
    with path.open('rb') as stream:
        stream.seek(max(0, path.stat().st_size - 512000))
        if stream.tell():
            stream.readline()
        return [json.loads(line) for line in stream if line.strip()][-limit:]
