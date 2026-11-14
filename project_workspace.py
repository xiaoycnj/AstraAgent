"""Registered project roots, content-addressed checkpoints and verification evidence."""
import security_core
from contextlib import contextmanager
from datetime import datetime, timezone
import difflib
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import stat
import threading
import uuid

EXCLUDED = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', 'dist', 'build'}
MAX_FILES = 10000
MAX_FILE_BYTES = 10_000_000
MAX_PROJECT_BYTES = 100_000_000
LOCK = threading.RLock()
LEASES = {}


@contextmanager
def database(data):
    data.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(data / 'projects.sqlite3', timeout=15)
    db.row_factory = sqlite3.Row
    try:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,instructions TEXT NOT NULL,checks TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS checkpoints(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,label TEXT NOT NULL,run_id TEXT,manifest TEXT NOT NULL,created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS verifications(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT,results TEXT NOT NULL,revision TEXT NOT NULL,verdict TEXT NOT NULL,created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS rollbacks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,undo_id TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS reviews(project_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,path TEXT NOT NULL,fingerprint TEXT NOT NULL,scope TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(project_id,checkpoint_id,path,fingerprint,scope));
        ''')
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def now():
    return datetime.now(timezone.utc).isoformat()


def public(row):
    result = dict(row)
    result['checks'] = json.loads(result['checks'])
    result['excluded_directories'] = sorted(EXCLUDED)
    return result


def projects(data):
    with database(data) as db:
        return [public(row) for row in db.execute('SELECT * FROM projects ORDER BY rowid DESC')]


def get(data, key):
    with database(data) as db:
        row = db.execute('SELECT * FROM projects WHERE id=?', (key,)).fetchone()
    if not row:
        raise ValueError('项目不存在')
    result = public(row)
    root = Path(result['path'])
    if not root.is_dir() or root.resolve() != root:
        raise ValueError('项目目录不可访问')
    return result


def save(data, body):
    path = body.get('path')
    name = body.get('name')
    instructions = body.get('instructions', '')
    checks = body.get('checks', [])
    if not isinstance(path, str) or not Path(path).is_absolute():
        raise ValueError('请选择项目的绝对目录')
    root = Path(path).resolve()
    if not root.is_dir() or root == root.parent or root.is_relative_to(data.resolve()):
        raise ValueError('请选择已有项目目录')
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError('项目名称需为 1–100 字符')
    if not isinstance(instructions, str) or len(instructions) > 12000:
        raise ValueError('项目指令最多 12000 字符')
    if not isinstance(checks, list) or len(checks) > 12:
        raise ValueError('最多保存十二个验证命令')
    for check in checks:
        if not isinstance(check, dict) or not isinstance(check.get('name'), str) or not 0 < len(check['name']) <= 100:
            raise ValueError('每个验证命令需填写名称')
        argv = check.get('argv')
        if not isinstance(argv, list) or not 0 < len(argv) <= 20 or any(not isinstance(arg, str) or not arg or len(arg) > 4000 for arg in argv):
            raise ValueError('验证命令需使用完整 argv 数组')
    with LOCK, database(data) as db:
        old = db.execute('SELECT id FROM projects WHERE id=? OR path=?', (body.get('id', ''), str(root))).fetchone()
        key = old['id'] if old else uuid.uuid4().hex
        if key in LEASES:
            raise ValueError('项目正在执行，请先取消或等待任务结束')
        db.execute('INSERT INTO projects(id,name,path,instructions,checks) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,instructions=excluded.instructions,checks=excluded.checks', (key, name.strip(), str(root), instructions, json.dumps(checks, ensure_ascii=False)))
    return get(data, key)


def acquire(key, owner):
    with LOCK:
        if key in LEASES and LEASES[key] != owner:
            raise ValueError('项目正在其他窗口执行任务')
        LEASES[key] = owner


def release(key, owner):
    with LOCK:
        if LEASES.get(key) == owner:
            LEASES.pop(key, None)


def idle(key):
    with LOCK:
        if key in LEASES:
            raise ValueError('项目任务仍在运行，请先取消或等待结束')


def target(root, relative):
    root=Path(root).resolve()
    security_core.relative_path(relative)
    if not isinstance(relative, str) or not relative or len(relative) > 500 or ':' in relative:
        raise ValueError('文件路径无效')
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('仅允许项目内的相对文件路径')
    current = root
    for part in path.parts:
        if part in EXCLUDED:
            raise ValueError('此目录被排除在项目变更管理之外')
        current = current / part
        if current.is_symlink() or getattr(current, 'is_junction', lambda: False)():
            raise ValueError('项目工具不跟随符号链接或目录联接')
    resolved = current.resolve()
    if resolved == root or not resolved.is_relative_to(root):
        raise ValueError('路径超出项目目录')
    return security_core.protect_private(resolved)


def instructions(project):
    return '\n\n'.join(part for part in (project['instructions'], repository_instructions(project)) if part)

def repository_instructions(project):
    root = Path(project['path'])
    file = root / 'AGENTS.md'
    if file.is_file() and file.resolve().is_relative_to(root) and file.stat().st_size <= 50000:
        return file.read_text(encoding='utf-8')[:12000]
    return ''


def scan(data, project, store=False, token=None):
    root = Path(project['path'])
    storage = data.resolve()
    manifest = {}
    total = 0
    blobs = data / 'project-history' / 'blobs'
    if store:
        blobs.mkdir(parents=True, exist_ok=True)
    for parent, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(name for name in dirs if name not in EXCLUDED and not (Path(parent) / name).is_symlink() and not getattr(Path(parent) / name, 'is_junction', lambda: False)() and not (Path(parent) / name).resolve().is_relative_to(storage))
        for name in sorted(names):
            if token:
                token.check()
            path = Path(parent) / name
            before_stat = path.stat(follow_symlinks=False)
            if not stat.S_ISREG(before_stat.st_mode):
                continue
            if len(manifest) >= MAX_FILES or before_stat.st_size > MAX_FILE_BYTES:
                raise ValueError('项目超过快照限制（10000 文件，单文件 10 MB）')
            with path.open('rb') as source:
                raw = source.read(before_stat.st_size + 1)
            after_stat = path.stat(follow_symlinks=False)
            if (before_stat.st_mtime_ns,before_stat.st_ctime_ns,before_stat.st_ino,before_stat.st_size) != (after_stat.st_mtime_ns,after_stat.st_ctime_ns,after_stat.st_ino,after_stat.st_size):
                raise ValueError('文件在快照时发生变化，请重试')
            total += len(raw)
            if len(raw) > MAX_FILE_BYTES or total > MAX_PROJECT_BYTES:
                raise ValueError('项目快照超过 100 MB 限制')
            digest = hashlib.sha256(raw).hexdigest()
            relative = path.relative_to(root).as_posix()
            manifest[relative] = {'sha256': digest, 'size': len(raw), 'mode': stat.S_IMODE(before_stat.st_mode)}
            if store and not (blobs / digest).exists():
                temporary = blobs / (digest + '.' + secrets.token_hex(6))
                temporary.write_bytes(raw)
                temporary.replace(blobs / digest)
    return manifest


def revision(manifest):
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()


def checkpoint(data, key, label='手动检查点', run_id='', token=None):
    project = get(data, key)
    manifest = scan(data, project, store=True, token=token)
    identifier = uuid.uuid4().hex
    with database(data) as db:
        db.execute('INSERT INTO checkpoints VALUES(?,?,?,?,?,?)', (identifier, key, label[:200], run_id, json.dumps(manifest), now()))
    return {'id': identifier, 'project_id': key, 'files': len(manifest), 'revision': revision(manifest)}


def load_checkpoint(data, key, identifier):
    with database(data) as db:
        row = db.execute('SELECT * FROM checkpoints WHERE id=? AND project_id=?', (identifier, key)).fetchone()
    if not row:
        raise ValueError('检查点不存在')
    result = dict(row)
    result['manifest'] = json.loads(result['manifest'])
    return result


def history(data, key):
    get(data, key)
    with database(data) as db:
        points = [dict(row) for row in db.execute('SELECT id,label,run_id,created FROM checkpoints WHERE project_id=? ORDER BY rowid DESC LIMIT 100', (key,))]
        checks = [dict(row) for row in db.execute('SELECT * FROM verifications WHERE project_id=? ORDER BY rowid DESC LIMIT 30', (key,))]
        operations = [dict(row) for row in db.execute('SELECT * FROM rollbacks WHERE project_id=? ORDER BY rowid DESC LIMIT 20', (key,))]
    for check in checks:
        check['results'] = json.loads(check['results'])
    return {'checkpoints': points, 'verifications': checks, 'rollbacks': operations}


def diff(data, key, identifier, token=None, current=None):
    project = get(data, key)
    baseline = load_checkpoint(data, key, identifier)['manifest']
    if current is None:current = scan(data, project, token=token)
    changes = []
    root = Path(project['path'])
    with database(data) as db:
        reviewed = {(row['path'], row['fingerprint'], row['scope']) for row in db.execute('SELECT path,fingerprint,scope FROM reviews WHERE project_id=? AND checkpoint_id=?', (key, identifier))}
    for relative in sorted(set(baseline) | set(current)):
        before = baseline.get(relative)
        after = current.get(relative)
        if before == after:
            continue
        raw_before = (data / 'project-history/blobs' / before['sha256']).read_bytes() if before else b''
        raw_after = target(root, relative).read_bytes() if after else b''
        if after and hashlib.sha256(raw_after).hexdigest()!=after['sha256']:
            raise ValueError('文件在生成差异时发生变化，请重新验证')
        text = ''
        binary = b'\x00' in raw_before + raw_after
        if not binary and len(raw_before) + len(raw_after) <= 1_000_000:
            try:
                text = ''.join(difflib.unified_diff(raw_before.decode('utf-8').splitlines(keepends=True), raw_after.decode('utf-8').splitlines(keepends=True), fromfile='before/' + relative, tofile='after/' + relative))[:100000]
            except UnicodeError:
                binary = True
        fingerprint = hashlib.sha256(json.dumps([before, after], sort_keys=True).encode()).hexdigest()
        hunks = []
        if before and after and not binary and text and len(raw_before) + len(raw_after) <= 1_000_000:
            for block in change_blocks(raw_before, raw_after):
                hunks.append({'id': block['id'], 'diff': block['diff'], 'reviewed': (relative, fingerprint, block['id']) in reviewed})
        changes.append({'path': relative, 'kind': 'added' if not before else 'deleted' if not after else 'modified', 'binary': binary, 'diff': text, 'before': before, 'after': after, 'hunks': hunks, 'reviewed': (relative, fingerprint, '*') in reviewed})
    return {'checkpoint_id': identifier, 'revision': revision(current), 'changes': changes, 'excluded_directories': sorted(EXCLUDED)}


def change_blocks(before, after):
    old = before.decode('utf-8').splitlines(keepends=True)
    new = after.decode('utf-8').splitlines(keepends=True)
    blocks = []
    for group in difflib.SequenceMatcher(None, old, new).get_grouped_opcodes(3):
        start_old, end_old = group[0][1], group[-1][2]
        start_new, end_new = group[0][3], group[-1][4]
        signature = json.dumps([start_old, end_old, start_new, end_new, old[start_old:end_old], new[start_new:end_new]])
        text = ''.join(difflib.unified_diff(old[start_old:end_old], new[start_new:end_new], fromfile='before', tofile='after'))
        blocks.append({'id': hashlib.sha256(signature.encode()).hexdigest(), 'diff': text, 'old': (start_old, end_old), 'new': (start_new, end_new)})
        if len(blocks) >= 100:
            break
    return blocks


def review(data, key, body):
    action = body.get('action')
    if action not in ('keep', 'revert'):
        raise ValueError('审阅操作无效')
    relative = body.get('path')
    if not isinstance(relative, str):
        raise ValueError('请选择要审阅的文件')
    owner = 'review-' + uuid.uuid4().hex
    acquire(key, owner)
    try:
        with LOCK:
            preview = diff(data, key, body.get('checkpoint_id', ''))
            if body.get('revision') != preview['revision']:
                raise FileExistsError('项目在预览后已发生变化，请刷新差异')
            change = next((row for row in preview['changes'] if row['path'] == relative), None)
            if change is None:
                raise ValueError('此文件没有可审阅的变更')
            scope = body.get('hunk_id') or '*'
            if not isinstance(scope, str) or (scope != '*' and scope not in {row['id'] for row in change['hunks']}):
                raise ValueError('变更块已过期或不支持局部撤销')
            if action == 'keep':
                fingerprint = hashlib.sha256(json.dumps([change['before'], change['after']], sort_keys=True).encode()).hexdigest()
                with database(data) as db:
                    db.execute('INSERT OR REPLACE INTO reviews VALUES(?,?,?,?,?,?)', (key, preview['checkpoint_id'], relative, fingerprint, scope, now()))
                return {'ok': True, 'action': action, 'path': relative, 'revision': preview['revision']}
            undo = checkpoint(data, key, '局部撤销前保护检查点')
            if undo['revision'] != preview['revision']:
                raise FileExistsError('项目在审阅时发生变化，请刷新差异')
            root = Path(get(data, key)['path'])
            if scope == '*':
                path = target(root, relative)
                expected = change['after']
                if path.exists() != (expected is not None) or (expected and hashlib.sha256(path.read_bytes()).hexdigest() != expected['sha256']):
                    raise FileExistsError('文件在审阅时被外部修改，请刷新差异')
                restore_entry(data, root, relative, change['before'])
            else:
                old = (data / 'project-history/blobs' / change['before']['sha256']).read_bytes()
                after = target(root, relative).read_bytes()
                if hashlib.sha256(old).hexdigest() != change['before']['sha256'] or hashlib.sha256(after).hexdigest() != change['after']['sha256']:
                    raise FileExistsError('文件在审阅时发生变化，请刷新差异')
                block = next(row for row in change_blocks(old, after) if row['id'] == scope)
                lines = after.decode('utf-8').splitlines(keepends=True)
                start, end = block['new']
                before_start, before_end = block['old']
                lines[start:end] = old.decode('utf-8').splitlines(keepends=True)[before_start:before_end]
                raw = ''.join(lines).encode('utf-8')
                digest = hashlib.sha256(raw).hexdigest()
                blobs = data / 'project-history/blobs'
                temporary = blobs / (digest + '.' + secrets.token_hex(6))
                temporary.write_bytes(raw)
                temporary.replace(blobs / digest)
                restore_entry(data, root, relative, {**change['after'], 'sha256': digest, 'size': len(raw)})
            return {'ok': True, 'action': action, 'path': relative, 'undo_checkpoint': undo['id']}
    finally:
        release(key, owner)


def restore_entry(data, root, relative, entry):
    path = target(root, relative)
    if entry is None:
        if path.exists():
            path.unlink()
        return
    raw = (data / 'project-history/blobs' / entry['sha256']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise ValueError('检查点内容校验失败')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.astra-' + secrets.token_hex(6) + '.tmp')
    try:
        temporary.write_bytes(raw)
        temporary.chmod(entry['mode'])
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def rollback(data, key, identifier, expected_revision):
    owner = 'rollback-' + uuid.uuid4().hex
    acquire(key, owner)
    try:
        with LOCK:
            project = get(data, key)
            baseline = load_checkpoint(data, key, identifier)['manifest']
            current = scan(data, project)
            if not expected_revision or revision(current) != expected_revision:
                raise FileExistsError('项目在预览后已发生变化，请刷新差异再回退')
            undo = checkpoint(data, key, '回退前保护检查点')
            operation = uuid.uuid4().hex
            with database(data) as db:
                db.execute('INSERT INTO rollbacks(id,project_id,checkpoint_id,undo_id,status) VALUES(?,?,?,?,?)', (operation, key, identifier, undo['id'], 'applying'))
            applied = []
            root = Path(project['path'])
            try:
                for relative in sorted(set(baseline) | set(current)):
                    if baseline.get(relative) == current.get(relative):
                        continue
                    path = target(root, relative)
                    expected = current.get(relative)
                    if (path.exists() != (expected is not None)) or (expected and hashlib.sha256(path.read_bytes()).hexdigest() != expected['sha256']):
                        raise FileExistsError('文件在回退时被外部修改，已停止')
                    restore_entry(data, root, relative, baseline.get(relative))
                    applied.append(relative)
                if scan(data, project) != baseline:
                    raise FileExistsError('项目在回退时被外部修改，已停止')
            except Exception:
                for relative in reversed(applied):
                    path = target(root, relative)
                    restored = baseline.get(relative)
                    if (path.exists() != (restored is not None)) or (restored and hashlib.sha256(path.read_bytes()).hexdigest() != restored['sha256']):
                        continue
                    restore_entry(data, root, relative, current.get(relative))
                with database(data) as db:
                    db.execute("UPDATE rollbacks SET status='failed',error='回退失败，请检查回退前保护检查点及外部修改' WHERE id=?", (operation,))
                raise
            with database(data) as db:
                db.execute("UPDATE rollbacks SET status='complete' WHERE id=?", (operation,))
            return {'ok': True, 'restored': len(applied), 'undo_checkpoint': undo['id']}
    finally:
        release(key, owner)


def verify(data, key, checks, runner, run_id='', token=None, capture=None):
    results = []
    for check in checks:
        if token:
            token.check()
        result = runner(check)
        results.append({'name': check['name'], 'argv': check['argv'], **result})
    if token:
        token.check()
    current = scan(data, get(data, key), token=token)
    if capture is not None:capture.update(current)
    verdict = 'unverified' if not results else 'passed' if all(result.get('exit_code') == 0 and not result.get('error') for result in results) else 'failed'
    identifier = uuid.uuid4().hex
    with database(data) as db:
        db.execute('INSERT INTO verifications VALUES(?,?,?,?,?,?,?)', (identifier, key, run_id, json.dumps(results, ensure_ascii=False), revision(current), verdict, now()))
    return {'id': identifier, 'verdict': verdict, 'results': results, 'revision': revision(current)}
