"""Repeatable task acceptance tied to actual sessions, artifacts and verification runs."""
import json
import hashlib
import os
import stat
import time
import uuid
from pathlib import Path
import project_workspace
import attachments
import security_core
import usage_meter


TEMPLATES = [
    {'category': 'coding', 'name': '修复项目问题并验证', 'prompt': '检查当前项目，修复我指定的问题，运行项目验收命令，交付修改摘要与验证结果。', 'expected_files': [], 'expected_outputs': [], 'require_checks': True, 'manual_review': True},
    {'category': 'creator', 'name': '制作可预览网页', 'prompt': '制作一个完整可用的单页网站，保存为 index.html 并直接交付下载。检查布局、资源引用与基本交互。', 'expected_files': [{'path': 'index.html', 'contains': ['<html', '</html>']}], 'expected_outputs': ['document'], 'require_checks': False, 'manual_review': True},
    {'category': 'image', 'name': '参考图创作与检查', 'prompt': '按我提供的创作要求调用生图插件，检查实际返回的图片，交付结果并说明检查范围。', 'expected_files': [], 'expected_outputs': ['image'], 'require_checks': False, 'manual_review': True},
    {'category': 'story', 'name': '完成章节并交付', 'prompt': '根据已确认的设定写一章故事，保持人物和时间线一致，保存 chapter.md 并直接交付下载。', 'expected_files': [{'path': 'chapter.md', 'contains': []}], 'expected_outputs': ['document'], 'require_checks': False, 'manual_review': True},
]


def read_assertion_file(path):
    before = path.stat(follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 1_000_000:
        raise ValueError('文件不存在、为空或超过 1 MB 自动检查限制')
    with path.open('rb') as source:
        opened = os.fstat(source.fileno())
        raw = source.read(1_000_001)
        after = os.fstat(source.fileno())
    last = path.stat(follow_symlinks=False)
    # Windows path stat and handle fstat expose different ctime semantics.
    # Compare identity across APIs, and ctime only within each API.
    stamps = [(item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns) for item in (before, opened, after, last)]
    if len(raw) > 1_000_000 or any(stamp != stamps[0] for stamp in stamps[1:]) or opened.st_ctime_ns != after.st_ctime_ns or before.st_ctime_ns != last.st_ctime_ns:
        raise ValueError('文件在检查时发生变化，请重新执行验收')
    return raw


def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS evaluation_cases(id TEXT PRIMARY KEY,spec TEXT NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS evaluation_runs(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,spec TEXT NOT NULL,session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,agent_run_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,started REAL NOT NULL,finished REAL,result TEXT NOT NULL DEFAULT '{}',review TEXT NOT NULL DEFAULT '');
        CREATE INDEX IF NOT EXISTS evaluation_runs_session ON evaluation_runs(session_id,agent_run_id);
    ''')


def catalog(db):
    cases = [json.loads(row['spec']) for row in db.execute('SELECT spec FROM evaluation_cases ORDER BY updated DESC LIMIT 100')]
    runs = []
    for row in db.execute('SELECT * FROM evaluation_runs ORDER BY started DESC LIMIT 100'):
        item = dict(row)
        item['spec'] = json.loads(item['spec'])
        item['result'] = json.loads(item['result'])
        runs.append(item)
    return {'templates': TEMPLATES, 'cases': cases, 'runs': runs}


def save(db, data, body):
    name, prompt = body.get('name'), body.get('prompt')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        raise ValueError('任务名称需为 1–100 字符')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 16000:
        raise ValueError('任务要求需为 1–16000 字符')
    category = body.get('category')
    if category not in ('coding', 'creator', 'image', 'story'):
        raise ValueError('任务类别无效')
    project_id = body.get('project_id', '')
    if not isinstance(project_id, str):
        raise ValueError('项目 ID 无效')
    if project_id:
        project_workspace.get(data, project_id)
    files = body.get('expected_files', [])
    outputs = body.get('expected_outputs', [])
    if not isinstance(files, list) or len(files) > 12:
        raise ValueError('最多配置十二个文件断言')
    normalized = []
    for rule in files:
        if not isinstance(rule, dict):
            raise ValueError('文件断言需为对象')
        path, contains = rule.get('path'), rule.get('contains', [])
        if not isinstance(path, str) or not path or len(path) > 240:
            raise ValueError('文件断言路径无效')
        security_core.relative_path(path)
        if not isinstance(contains, list) or len(contains) > 12 or any(not isinstance(text, str) or not 1 <= len(text) <= 2000 for text in contains):
            raise ValueError('文本断言需为最多十二条字符串')
        changed = rule.get('require_changed', True)
        if type(changed) is not bool:
            raise ValueError('文件变更断言开关无效')
        normalized.append({'path': path, 'contains': contains, 'require_changed': changed})
    if not isinstance(outputs, list) or len(outputs) > 12 or any(kind not in ('image', 'document') for kind in outputs):
        raise ValueError('输出类型无效')
    for key in ('require_checks', 'manual_review'):
        if type(body.get(key, False)) is not bool:
            raise ValueError('验收开关无效')
    if body.get('require_checks') and not project_id:
        raise ValueError('运行项目验收命令需先选择项目')
    if not (normalized or outputs or body.get('require_checks') or body.get('manual_review')):
        raise ValueError('至少配置一种验收条件')
    key = body.get('id') or uuid.uuid4().hex
    if not isinstance(key, str) or len(key) > 64:
        raise ValueError('任务 ID 无效')
    spec = {'id': key, 'name': name.strip(), 'prompt': prompt.strip(), 'category': category,
            'project_id': project_id, 'expected_files': normalized, 'expected_outputs': outputs,
            'require_checks': body.get('require_checks', False), 'manual_review': body.get('manual_review', False)}
    db.execute('INSERT INTO evaluation_cases VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET spec=excluded.spec,updated=excluded.updated', (key, json.dumps(spec, ensure_ascii=False), time.time()))
    return spec


def start(db, data, case_id):
    row = db.execute('SELECT spec FROM evaluation_cases WHERE id=?', (case_id,)).fetchone()
    if row is None:
        raise ValueError('验收任务不存在')
    spec = json.loads(row['spec'])
    if spec['project_id']:
        project_workspace.get(data, spec['project_id'])
    root = Path(project_workspace.get(data, spec['project_id'])['path']) if spec['project_id'] else data / 'files'
    baseline = {}
    for rule in spec['expected_files']:
        try:
            path = project_workspace.target(root, rule['path'])
            baseline[rule['path']] = hashlib.sha256(read_assertion_file(path)).hexdigest()
        except (ValueError, OSError):
            baseline[rule['path']] = None
    spec['_baseline'] = baseline
    spec['_project_root'] = str(root.resolve())
    sid, key = uuid.uuid4().hex, uuid.uuid4().hex
    title = '验收 · ' + spec['name']
    db.execute('INSERT INTO sessions(id,title,project_id) VALUES(?,?,?)', (sid, title, spec['project_id']))
    db.execute('INSERT INTO evaluation_runs(id,case_id,spec,session_id,status,started) VALUES(?,?,?,?,?,?)', (key, case_id, json.dumps(spec, ensure_ascii=False), sid, 'queued', time.time()))
    session = dict(db.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone())
    return {'id': key, 'session': session, 'prompt': spec['prompt']}


def bind(db, sid, agent_run_id):
    db.execute("UPDATE evaluation_runs SET agent_run_id=?,started=CASE WHEN status='queued' THEN ? ELSE started END,status='running' WHERE session_id=? AND (status='queued' OR agent_run_id=?)", (agent_run_id, time.time(), sid, agent_run_id))


def finish(db, data, sid, agent_run_id, terminal):
    row = db.execute('SELECT * FROM evaluation_runs WHERE session_id=? AND agent_run_id=?', (sid, agent_run_id)).fetchone()
    if row is None:
        return None
    spec = json.loads(row['spec'])
    evidence = [{'name': '智能体任务正常结束', 'passed': terminal == 'done', 'detail': terminal}]
    binding = db.execute('SELECT project_id FROM sessions WHERE id=?', (sid,)).fetchone()
    if not binding or binding['project_id'] != spec['project_id']:
        evidence.append({'name': '项目绑定一致', 'passed': False, 'detail': '会话项目已变化，请重新创建验收任务'})
    try:
        root = Path(project_workspace.get(data, spec['project_id'])['path']) if spec['project_id'] else data / 'files'
        if str(root.resolve()) != spec.get('_project_root'):
            raise ValueError('项目目录已变化')
    except ValueError:
        root = None
        evidence.append({'name': '项目可访问', 'passed': False, 'detail': '项目目录已不可访问'})
    for rule in spec['expected_files']:
        try:
            if root is None:
                raise ValueError('项目目录已不可访问')
            path = project_workspace.target(root, rule['path'])
            raw = read_assertion_file(path)
            content = raw.decode('utf-8') if rule['contains'] else ''
            missing = [text for text in rule['contains'] if text not in content]
            changed = hashlib.sha256(raw).hexdigest() != spec.get('_baseline', {}).get(rule['path'])
            passed = not missing and (changed or not rule.get('require_changed', True))
            evidence.append({'name': rule['path'], 'passed': passed, 'detail': '缺少文本断言' if missing else '文件及文本断言通过' if passed else '文件与任务开始前相同'})
        except (ValueError, OSError) as error:
            evidence.append({'name': rule['path'], 'passed': False, 'detail': str(error)[:200]})
    resources = attachments.resources(db, data, sid)
    remaining = list(resources['outputs'])
    for kind in spec['expected_outputs']:
        item = next((item for item in remaining if not item.get('unavailable') and (item['kind'] == 'image') == (kind == 'image')), None)
        evidence.append({'name': '会话输出 · ' + kind, 'passed': item is not None, 'attachment_id': item['id'] if item else None})
        if item:
            remaining.remove(item)
    if spec['require_checks'] and root is not None:
        with project_workspace.database(data) as project_db:
            check = project_db.execute('SELECT * FROM verifications WHERE project_id=? AND run_id=? ORDER BY rowid DESC LIMIT 1', (spec['project_id'], agent_run_id)).fetchone()
        current = project_workspace.revision(project_workspace.scan(data, project_workspace.get(data, spec['project_id'])))
        passed = bool(check and check['verdict'] == 'passed' and check['revision'] == current)
        evidence.append({'name': '项目验收命令', 'passed': passed, 'verification_id': check['id'] if check else None, 'detail': '使用本次任务和当前文件版本对应的验证记录'})
    passed = all(item['passed'] for item in evidence)
    trace = db.execute('SELECT events FROM runs WHERE id=?', (agent_run_id,)).fetchone()
    approvals = sum(event.get('type') == 'approval' for event in json.loads(trace['events'])) if trace else None
    result = {'evidence': evidence, 'automated_passed': passed, 'duration_seconds': round(max(0, time.time() - row['started']), 2), 'usage': usage_meter.task_summary(data, agent_run_id), 'approval_requests': approvals}
    status = 'needs_review' if passed and spec['manual_review'] else 'passed' if passed else 'failed'
    db.execute('UPDATE evaluation_runs SET status=?,finished=?,result=?,review=\'\' WHERE id=?', (status, time.time(), json.dumps(result, ensure_ascii=False), row['id']))
    return {'id': row['id'], 'status': status, **result}


def review(db, key, body):
    row = db.execute('SELECT * FROM evaluation_runs WHERE id=?', (key,)).fetchone()
    if row is None or row['status'] != 'needs_review':
        raise ValueError('此任务当前不处于人工复核阶段')
    outcome, note = body.get('outcome'), body.get('note', '')
    if outcome not in ('passed', 'failed') or not isinstance(note, str) or len(note) > 2000:
        raise ValueError('人工复核结果无效')
    db.execute('UPDATE evaluation_runs SET status=?,review=? WHERE id=?', (outcome, note, key))
    return {'id': key, 'status': outcome, 'review': note}
