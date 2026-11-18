"""Benchmark Astra's durable chat over loopback HTTP with a deterministic fake model.

Run from the repo: runtimes/python/python.exe scripts/benchmark_kernel.py --repeat 3
By default the benchmark uses current source and writes only to an isolated temp
fixture. --trace-sqlite is diagnostic and adds overhead; use it separately from
untraced timing. --journal-source accepts a trusted local source snapshot for A/B.
"""
from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager, redirect_stdout
from dataclasses import dataclass, field
from hashlib import sha256
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import platform
import re
import sqlite3
from statistics import median
import sys
from tempfile import TemporaryDirectory
from threading import Event, Lock, Thread
from time import perf_counter_ns, sleep


ROOT = Path(__file__).resolve().parents[1]
HOST = '127.0.0.1'
MODEL = 'astra-benchmark-fixed'
HTTP_TIMEOUT = 20
SHORT = ('Short ', 'fixture ', 'complete.')
RECONNECT = ('before ', 'during ', 'after ', 'reconnect')
CANCEL_PREFIX = 'Visible partial answer.'
CANCEL_SUFFIX = ' This must never be published.'
PROJECT_RESPONSE = 'Updated the fixture.'
PROJECT_BEFORE = b'VALUE = 1\n'
PROJECT_AFTER = b'VALUE = 2\n'
TERMINALS = {'done', 'cancelled', 'error'}
SCENARIOS = ('short', 'long', 'project', 'reconnect', 'cancel')


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def encode(value):
    return json.dumps(value, ensure_ascii=False).encode('utf-8')


def elapsed_ms(start, end):
    return round((end - start) / 1_000_000, 3)


def loopback_only(event, args):
    # Fail closed on external DNS/resolution and connects, even if the loaded
    # source accidentally ignores the temporary provider configuration.
    if event in {'socket.getaddrinfo', 'socket.gethostbyname', 'socket.gethostbyname_ex'}:
        require(args[0] == HOST, f'benchmark blocked non-loopback lookup: {args[0]!r}')
    elif event == 'socket.connect':
        address = args[1]
        require(isinstance(address, tuple) and address[0] == HOST,
                f'benchmark blocked non-loopback connection: {address!r}')


def load_backend(journal_source):
    sys.path.insert(0, str(ROOT))
    sys.dont_write_bytecode = True
    if journal_source:
        spec = importlib.util.spec_from_file_location('stream_journal', journal_source)
        require(spec is not None and spec.loader is not None, 'invalid journal source')
        module = importlib.util.module_from_spec(spec)
        sys.modules['stream_journal'] = module
        spec.loader.exec_module(module)
    import backend
    return backend


@dataclass
class ModelRun:
    scenario: str
    chunks: tuple[str, ...]
    arrivals: list[int] = field(default_factory=list)
    release: Event = field(default_factory=Event)
    settled: Event = field(default_factory=Event)


class Stub:
    def __init__(self):
        self.runs = {}
        self.errors = []
        self.lock = Lock()

    def handler(self):
        stub = self

        class ModelHandler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                model_run = None
                try:
                    arrived = perf_counter_ns()  # First statement with parsed HTTP headers.
                    payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    require(self.path == '/v1/chat/completions', f'unexpected model path: {self.path}')
                    require(payload['model'] == MODEL and payload['stream'] is True,
                            'unexpected model or non-streaming request')
                    user = next(row['content'] for row in reversed(payload['messages']) if row['role'] == 'user')
                    require(isinstance(user, str), 'expected a text fixture prompt')
                    key = user.splitlines()[0]
                    with stub.lock:
                        model_run = stub.runs[key]
                        model_run.arrivals.append(arrived)
                        stage = len(model_run.arrivals)
                    self.reply(model_run, stage, payload)
                except ConnectionError as error:
                    if not model_run or model_run.scenario != 'cancel' or not model_run.release.is_set():
                        stub.record_error(error)
                except Exception as error:
                    stub.record_error(error)
                    if model_run is None:
                        self.send_error(500, 'invalid benchmark model request')
                finally:
                    if model_run and model_run.scenario == 'cancel':
                        model_run.settled.set()

            def reply(self, run, stage, payload):
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                if run.scenario == 'project':
                    self.project(stage, payload)
                else:
                    require(stage == 1, f'{run.scenario} called the model more than once')
                    for index, text in enumerate(run.chunks):
                        if index and run.scenario in ('reconnect', 'cancel'):
                            require(run.release.wait(HTTP_TIMEOUT), f'{run.scenario} gate not released')
                            sleep(0.025)
                        self.delta({'content': text})
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()

            def delta(self, delta):
                self.wfile.write(b'data: ' + encode({'choices': [{'delta': delta}]}) + b'\n\n')
                self.wfile.flush()

            def project(self, stage, payload):
                commands = {item['function']['name'] for item in payload.get('tools', [])}
                require({'read_file', 'write_file'} <= commands, 'project tools not offered')
                results = [row for row in payload['messages'] if row['role'] == 'tool']
                require(len(results) == stage - 1, 'project tool results missing or duplicated')
                if stage == 1:
                    name, args = 'read_file', {'path': 'answer.txt'}
                elif stage == 2:
                    require(results[-1]['tool_call_id'] == 'bench-read_file', 'wrong read call id')
                    observed = json.loads(results[-1]['content'])
                    require(observed['content'].encode() == PROJECT_BEFORE and
                            observed['revision'] == sha256(PROJECT_BEFORE).hexdigest(),
                            'model did not receive the actual original file and revision')
                    name, args = 'write_file', {'path': 'answer.txt', 'revision': observed['revision'],
                                                'content': PROJECT_AFTER.decode()}
                elif stage == 3:
                    require(results[-1]['tool_call_id'] == 'bench-write_file', 'wrong write call id')
                    observed = json.loads(results[-1]['content'])
                    require('error' not in observed and observed.get('path') == 'answer.txt',
                            f'actual project write failed: {observed}')
                    self.delta({'content': PROJECT_RESPONSE})
                    return
                else:
                    raise AssertionError(f'unexpected project call {stage}')
                self.delta({'tool_calls': [{'index': 0, 'id': 'bench-' + name, 'type': 'function',
                                            'function': {'name': name, 'arguments': json.dumps(args)}}]})

        return ModelHandler

    def record_error(self, error):
        with self.lock:
            self.errors.append(f'{type(error).__name__}: {error}')


class Client:
    def __init__(self, port, token):
        self.port = port
        self.token = token

    @contextmanager
    def open(self, method, path, body=None, *, sse=False):
        connection = HTTPConnection(HOST, self.port, timeout=HTTP_TIMEOUT)
        raw = encode(body) if body is not None else None
        headers = {'X-App-Token': self.token, 'Content-Type': 'application/json'}
        try:
            began = perf_counter_ns()  # Immediately before sending the HTTP request.
            connection.request(method, path, raw, headers)
            with connection.getresponse() as response:
                require(response.status in (200, 201),
                        f'{method} {path}: HTTP {response.status}: {response.read(4096)!r}'
                        if response.status not in (200, 201) else '')
                if sse:
                    require(response.headers.get_content_type() == 'text/event-stream',
                            f'{method} {path}: response is not SSE')
                yield began, response
        finally:
            connection.close()

    def json(self, method, path, body=None):
        with self.open(method, path, body) as (_, response):
            return json.load(response)


@dataclass(frozen=True)
class Frame:
    cursor: int
    event: dict
    arrived: int = field(compare=False)


def frames(response) -> Iterator[Frame]:
    cursor = None
    data = []
    for line in iter(response.readline, b''):
        line = line.rstrip(b'\r\n')
        if not line:
            if data:
                arrived = perf_counter_ns()  # Complete SSE frame, before JSON decoding.
                require(cursor is not None, 'missing SSE id')
                yield Frame(cursor, json.loads(b'\n'.join(data)), arrived)
            cursor, data = None, []
        elif line.startswith(b'id:'):
            require(cursor is None, 'duplicate SSE id field')
            cursor = int(line[3:])
        elif line.startswith(b'data:'):
            data.append(line[5:].removeprefix(b' '))
    require(cursor is None and not data, 'incomplete SSE frame at EOF')


@contextmanager
def serve(server):
    with server:
        worker = Thread(target=server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
        worker.start()
        try:
            yield server.server_port
        finally:
            server.shutdown()
            worker.join()


class JournalTrace:
    """Count commits containing stream_events inserts, not disk flushes/fsyncs."""
    def __init__(self, data):
        self.path = data / 'workspace.sqlite3'
        self.connect = sqlite3.connect
        self.counts = Counter()
        self.lock = Lock()

    def __enter__(self):
        def connect(database, *args, **kwargs):
            db = self.connect(database, *args, **kwargs)
            if str(database) != str(self.path):
                return db
            pending = Counter()

            def trace(sql):
                sql = sql.lstrip()
                if sql.upper().startswith('INSERT INTO STREAM_EVENTS'):
                    match = re.search(r"VALUES\s*\(\s*'(bench-[a-z0-9-]+)'", sql, re.I)
                    if match:
                        pending[match.group(1)] += 1
                elif pending:
                    operation = sql.split(None, 1)[0].upper()
                    if operation == 'COMMIT':
                        with self.lock:
                            for request_id, insertions in pending.items():
                                self.counts[request_id, 'commits'] += 1
                                self.counts[request_id, 'inserts'] += insertions
                        pending.clear()
                    elif operation == 'ROLLBACK':
                        pending.clear()

            db.set_trace_callback(trace)
            return db

        sqlite3.connect = connect
        return self

    def __exit__(self, *_):
        sqlite3.connect = self.connect

    def result(self, key, events):
        with self.lock:
            commits = self.counts[key, 'commits']
            inserts = self.counts[key, 'inserts']
        require(inserts == events and 0 < commits <= inserts,
                f'{key}: SQLite trace counted {inserts} inserts / {commits} commits for {events} SSE frames')
        return {'insert_statements': inserts, 'write_transactions': commits}


def verify_argv():
    # A fixed read-only check, not a model-generated command.
    script = ('from pathlib import Path; import sys; '
              f'sys.exit(Path("answer.txt").read_bytes() != {PROJECT_AFTER!r})')
    return [sys.executable, '-I', '-S', '-c', script]


def create_project(client, folder):
    folder.mkdir()
    (folder / 'answer.txt').write_bytes(PROJECT_BEFORE)
    return client.json('PUT', '/api/projects', {
        'name': 'Benchmark fixture', 'path': str(folder),
        'instructions': 'Set the fixture value to two, then finish.',
        'checks': [{'name': 'Check value', 'argv': verify_argv()}],
    })['id']


def approve_fixture_call(client, folder, event):
    name, args = event['name'], event['args']
    allowed = (
        name == 'write_file' and args == {'path': 'answer.txt', 'content': PROJECT_AFTER.decode(),
                                          'revision': sha256(PROJECT_BEFORE).hexdigest()}
        or name == 'execute_command' and args == {'argv': verify_argv(), 'cwd': str(folder),
                                                    'verification': 'Check value'}
    )
    require(client.json('POST', '/api/approvals', {'id': event['id'], 'allow': allowed}) == {'ok': True},
            'approval API did not acknowledge fixture decision')
    require(allowed, f'unexpected project approval: {event}')


def check_project(client, project_id, folder, events, terminal):
    tool_names = [event['name'] for event in events if event['type'] == 'tool_start']
    require(tool_names == ['read_file', 'write_file'], f'wrong project tools: {tool_names}')
    require((folder / 'answer.txt').read_bytes() == PROJECT_AFTER, 'project file has wrong bytes')
    commands = [event for event in events if event['type'] == 'verification_command']
    require(len(commands) == 1 and commands[0]['result']['exit_code'] == 0,
            f'project verification command did not exit 0: {commands}')
    require(terminal['verdict'] == 'passed', f'project did not pass: {terminal}')
    path = f'/api/projects/{project_id}'
    history = client.json('GET', path + '/history')
    checkpoint = terminal['checkpoint_id']
    require(any(item['id'] == checkpoint for item in history['checkpoints']), 'missing saved checkpoint')
    require(len(history['verifications']) == 1 and history['verifications'][0]['verdict'] == 'passed',
            'missing saved passing verification')
    diff = client.json('POST', path + '/diff', {'checkpoint_id': checkpoint})['changes']
    require(len(diff) == 1 and diff[0]['path'] == 'answer.txt' and diff[0]['kind'] == 'modified' and
            '-VALUE = 1\n+VALUE = 2\n' in diff[0]['diff'], f'unexpected project diff: {diff}')


def run_case(client, stub, fixture, scenario, index, burst_chunks, trace):
    key = f'bench-{scenario}-{index:02d}-request'
    chunks = {
        'short': SHORT,
        'long': tuple(f'{i:04x} abracadabra ' for i in range(burst_chunks)),
        'project': (PROJECT_RESPONSE,),
        'reconnect': RECONNECT,
        'cancel': (CANCEL_PREFIX, CANCEL_SUFFIX),
    }[scenario]
    model_run = ModelRun(scenario, chunks)
    stub.runs[key] = model_run
    prompt = key + '\n' + {
        'short': 'Return the short response.',
        'long': 'Repeat this fixed long-context workload.\n' + ('0123456789abcdef\n' * 1400),
        'project': 'Set VALUE to 2 in answer.txt.',
        'reconnect': 'Continue the stream across a client disconnect.',
        'cancel': 'Stream until the client cancels.',
    }[scenario].rstrip()
    body = {'content': prompt, 'stream': True, 'request_id': key, 'allow_tools': False,
            'iui_enabled': False, 'auto_memory': False}
    folder = fixture / key
    if scenario == 'project':
        project_id = create_project(client, folder)
        body.update(project_id=project_id, tools=['read_file', 'write_file'], allow_tools=True,
                    access_policy='full')
    sid = client.json('POST', '/api/sessions', {'title': key})['id']
    session = f'/api/sessions/{sid}'
    stream = f'/api/stream/{key}'
    measured = []
    cancellation = None
    replay_samples = {}
    try:
        with client.open('POST', session + '/chat', body, sse=True) as (started, response):
            for frame in frames(response):
                measured.append(frame)
                if frame.event['type'] == 'approval':
                    require(scenario == 'project', f'unexpected approval in {scenario}')
                    approve_fixture_call(client, folder, frame.event)
                if frame.event['type'] != 'delta':
                    continue
                if scenario == 'reconnect':
                    break  # Drop the TCP response while the provider is gated.
                if scenario == 'cancel' and cancellation is None:
                    cancel_started = perf_counter_ns()
                    cancellation = client.json('POST', stream + '/cancel', {})
                    require(cancellation == {'accepted': True, 'status': 'cancelling'},
                            f'cancellation was not accepted: {cancellation}')
        if scenario == 'reconnect':
            require(measured and measured[-1].event.get('text') == RECONNECT[0],
                    'initial SSE connection did not deliver exactly the first chunk')
            cursor = measured[-1].cursor
            with client.open('GET', f'{stream}?after={cursor}', sse=True) as (resumed, response):
                model_run.release.set()
                suffix = list(frames(response))
            require(suffix and all(frame.cursor > cursor for frame in suffix), 'resume cursor is not exclusive')
            measured.extend(suffix)
            replay_samples = {'disconnect_cursor': cursor, 'resumed_frames': len(suffix),
                              'resume_to_first_frame_ms': elapsed_ms(resumed, suffix[0].arrived)}
        if scenario == 'cancel':
            require(cancellation is not None, 'no cancellation request was sent')
    finally:
        model_run.release.set()
    if scenario == 'cancel':
        require(model_run.settled.wait(HTTP_TIMEOUT), 'cancelled model handler did not exit')

    require(not stub.errors, f'stub errors: {stub.errors}')
    events = [frame.event for frame in measured]
    ids = [frame.cursor for frame in measured]
    require(ids and ids[0] > 0 and ids == sorted(set(ids)), f'{key}: unordered or duplicate SSE ids')
    require(events[0]['type'] == 'start' and events[0]['request_id'] == key, f'{key}: wrong start event')
    terminal_kind, status = ('cancelled', 'cancelled') if scenario == 'cancel' else ('done', 'complete')
    require([e['type'] for e in events if e['type'] in TERMINALS] == [terminal_kind] and
            events[-1]['type'] == terminal_kind, f'{key}: wrong terminal event: {events[-1]}')
    terminal = events[-1]
    deltas = [f for f in measured if f.event['type'] == 'delta']
    expected = (CANCEL_PREFIX,) if scenario == 'cancel' else chunks
    require(tuple(frame.event['text'] for frame in deltas) == expected, f'{key}: incorrect delta sequence')
    checked_answer = ''.join(expected)
    if scenario == 'project':
        checked_answer += '\n\n\u9879\u76ee\u9a8c\u6536 \u00b7 \u9a8c\u8bc1\u901a\u8fc7'
    elif scenario == 'cancel':
        checked_answer += ('\n\n\u4efb\u52a1\u5df2\u53d6\u6d88\u3002'
                           '\u5df2\u53d1\u751f\u7684\u9879\u76ee\u53d8\u66f4'
                           '\u53ef\u68c0\u67e5\u5e76\u56de\u9000\u3002')
    require(terminal['content'] == checked_answer, f'{key}: terminal answer differs from expected')
    # Compare all events, not just text, with the durable journal after completion.
    with client.open('GET', stream + '?after=0', sse=True) as (_, response):
        require(list(frames(response)) == measured, f'{key}: durable replay differs from live stream')
    if scenario == 'reconnect':
        with client.open('POST', session + '/chat', body, sse=True) as (_, response):
            require(list(frames(response)) == measured, 'duplicate submission did not replay identical events')
    elif scenario == 'cancel':
        require(client.json('POST', stream + '/cancel', {}) == {'accepted': False, 'status': 'cancelled'},
                'second cancellation was accepted')
    stored_stream = client.json('GET', session + '/stream')
    require(stored_stream['id'] == key and stored_stream['status'] == status,
            f'{key}: wrong stored stream state')
    stored_run = client.json('GET', session + '/runs')
    require(len(stored_run) == 1 and stored_run[0]['id'] == events[0]['run_id'] and
            stored_run[0]['status'] == status and stored_run[0]['events'][-1]['type'] == terminal_kind,
            f'{key}: persisted run diverges')
    messages = client.json('GET', session + '/messages')
    require([(row['role'], row['content']) for row in messages] == [('user', prompt), ('assistant', checked_answer)]
            and messages[-1]['id'] == terminal['message_id'], f'{key}: persisted messages diverge')
    if scenario == 'project':
        check_project(client, project_id, folder, events, terminal)
    require(len(model_run.arrivals) == (3 if scenario == 'project' else 1) and not stub.errors,
            f'{key}: incorrect provider call count or stub error: {stub.errors}')
    upstream = model_run.arrivals[0]
    first_delta = deltas[0].arrived
    require(started <= upstream <= first_delta <= measured[-1].arrived, f'{key}: invalid timing order')
    result = {
        'scenario': scenario, 'iteration': index, 'status': status, 'sse_events': len(events),
        'delta_events': len(deltas), 'model_calls': len(model_run.arrivals),
        'request_to_upstream_ms': elapsed_ms(started, upstream),
        'request_to_first_delta_ms': elapsed_ms(started, first_delta),
        'upstream_to_first_delta_ms': elapsed_ms(upstream, first_delta),
        'request_to_terminal_ms': elapsed_ms(started, measured[-1].arrived),
        **replay_samples,
    }
    if scenario == 'cancel':
        result['cancel_request_to_terminal_ms'] = elapsed_ms(cancel_started, measured[-1].arrived)
    if trace:
        result['sqlite_journal_trace'] = trace.result(key, len(events))
    return result


def benchmark(options):
    backend = load_backend(options.journal_source)
    stub = Stub()

    class QuietHandler(backend.Handler):
        def log_message(self, *_):
            pass

    with TemporaryDirectory(prefix='astra-kernel-bench-') as directory, ExitStack() as stack:
        fixture = Path(directory).resolve()
        backend.ROOT, backend.DATA = fixture, fixture / 'data'
        skill = fixture / 'skills' / 'general'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('# Benchmark assistant\nFollow the benchmark request.\n', encoding='utf-8')
        backend.initialize()
        provider_port = stack.enter_context(serve(ThreadingHTTPServer((HOST, 0), stub.handler())))
        app_port = stack.enter_context(serve(backend.LocalServer((HOST, 0), QuietHandler)))
        client = Client(app_port, backend.TOKEN)
        client.token = client.json('GET', '/api/bootstrap')['token']
        client.json('PUT', '/api/settings', {'base_url': f'http://{HOST}:{provider_port}/v1',
                                             'model': MODEL, 'timeout': 15})
        client.json('PUT', '/api/runtime', {'access_policy': 'full'})
        trace = stack.enter_context(JournalTrace(backend.DATA)) if options.trace_sqlite else None
        samples = [run_case(client, stub, fixture, name, index, options.burst_chunks, trace)
                   for index in range(1, options.repeat + 1) for name in SCENARIOS]

    summary = {}
    for scenario in SCENARIOS:
        rows = [row for row in samples if row['scenario'] == scenario]
        summary[scenario] = {key: round(median(row[key] for row in rows), 3)
                             for key in rows[0] if key.endswith('_ms')}
    files = [Path(backend.__file__), Path(backend.stream_journal.__file__)]
    return {
        'schema_version': 1, 'correctness': 'passed', 'python': platform.python_version(),
        'platform': platform.platform(), 'repeat': options.repeat, 'burst_chunks': options.burst_chunks,
        'trace_sqlite': options.trace_sqlite,
        'source': {path.name: {'path': str(path), 'sha256': sha256(path.read_bytes()).hexdigest()}
                   for path in files},
        'timing': 'milliseconds, same-process monotonic clock; request begins before client HTTP send; '
                  'upstream at stub handler entry; delta/terminal at complete client SSE frame',
        'sqlite_trace_scope': 'COMMIT statements containing stream_events inserts, not fsyncs; '
                              'tracing adds timing overhead' if options.trace_sqlite else None,
        'median_ms': summary, 'samples': samples,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repeat', type=int, default=3, help='samples per scenario (1..10; default: 3)')
    parser.add_argument('--burst-chunks', type=int, default=800, help='unpaced long-case chunks (default: 800)')
    parser.add_argument('--trace-sqlite', action='store_true', help='count SQL journal write transactions')
    parser.add_argument('--journal-source', type=lambda value: Path(value).resolve(), metavar='PATH',
                        help='load a trusted local stream_journal.py snapshot instead of current source')
    parser.add_argument('--report', type=Path, metavar='PATH', help='also save the JSON report here')
    options = parser.parse_args()
    if not 1 <= options.repeat <= 10 or not 1 <= options.burst_chunks <= 2000:
        parser.error('--repeat must be 1..10 and --burst-chunks must be 1..2000')
    if options.journal_source and not options.journal_source.is_file():
        parser.error('--journal-source must point to a local Python source file')
    sys.addaudithook(loopback_only)
    with redirect_stdout(sys.stderr):
        result = benchmark(options)
    raw = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if options.report:
        options.report.write_text(raw, encoding='utf-8')
    print(raw, end='')


if __name__ == '__main__':
    main()
