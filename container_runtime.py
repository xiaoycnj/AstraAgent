"""Explicit local Docker execution with bounded resources and no host fallback."""
from contextlib import nullcontext
import csv
import io
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import threading
import security_core
import task_control


IMAGE_ID = re.compile(r'sha256:[a-f0-9]{64}')


def docker_environment():
    return {key: value for key, value in os.environ.items() if key.upper() in {
        'SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP',
        'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA'
    }}


def inspect_docker(executable, args):
    result = subprocess.run([executable, *args], env=docker_environment(), capture_output=True,
                            timeout=8, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode or len(result.stdout) > 64000:
        raise ValueError('Docker 服务不可用，请启动本地 Docker Linux 容器引擎')
    return result.stdout.decode('utf-8', errors='replace').strip()


def status():
    executable = shutil.which('docker')
    if not executable:
        return {'available': False, 'reason': '未检测到 Docker，请先安装并启动 Docker Linux 容器引擎'}
    try:
        endpoint = inspect_docker(executable, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
        if not endpoint.startswith(('npipe://', 'unix://')):
            raise ValueError('隔离模式需要本地 Docker 引擎，当前上下文指向远程服务')
        if inspect_docker(executable, ['info', '--format', '{{.OSType}}']) != 'linux':
            raise ValueError('当前接入支持 Docker Linux 容器，请切换容器引擎')
        return {'available': True, 'engine': 'docker', 'platform': 'linux', 'local': True}
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        return {'available': False, 'reason': str(error)[:250]}


def validate_workspace(workspace):
    workspace = security_core.protect_private(Path(workspace).resolve())
    private_roots = security_core.PRIVATE_ROOTS | {Path(security_core.__file__).resolve().parent / 'data'}
    if any(root.exists() and root.resolve().is_relative_to(workspace) for root in private_roots):
        raise ValueError('项目包含应用私有数据目录，不能整体挂载到容器')
    count = 0
    for parent, directories, names in os.walk(workspace, followlinks=False):
        for name in directories + names:
            path = Path(parent) / name
            count += 1
            if count > 100000:
                raise ValueError('容器挂载目录超过 100000 个条目，请缩小工作区')
            if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
                raise ValueError('容器挂载目录包含链接，请使用无链接的独立工作区')
    return workspace


def command_line(executable, workspace, argv, config, name):
    image = config.get('container_image', '')
    if not isinstance(image, str) or not IMAGE_ID.fullmatch(image):
        raise ValueError('请在设置中填写已在本机安装的 Docker 镜像 ID，格式 sha256:加64位摘要')
    memory = config.get('container_memory_mb', 512)
    if type(memory) is not int or not 128 <= memory <= 8192:
        raise ValueError('容器内存需为 128–8192 MB')
    stream = io.StringIO()
    mount = ['type=bind', 'source=' + str(workspace), 'target=/workspace']
    permission = config.get('file_permission', 'none')
    if permission == 'none':
        raise ValueError('当前文件权限禁止挂载工作区')
    if permission == 'read' or (permission == 'ask' and config.get('_authorized_tool') != 'execute_command'):
        mount.append('readonly')
    csv.writer(stream, lineterminator='').writerow(mount)
    user = str(os.getuid()) + ':' + str(os.getgid()) if hasattr(os, 'getuid') and os.getuid() else '1000:1000'
    return [executable, 'run', '--rm', '--pull=never', '--name', name,
            '--network', 'bridge' if config.get('container_network') is True else 'none',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--pids-limit=128', '--cpus=1', '--memory=' + str(memory) + 'm',
            '--memory-swap=' + str(memory) + 'm', '--log-driver=none', '--user', user,
            '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m', '--mount', stream.getvalue(),
            '--workdir=/workspace', '--env=HOME=/tmp', '--env=PYTHONPYCACHEPREFIX=/tmp/pycache',
            '--env=npm_config_cache=/tmp/npm', '--entrypoint', argv[0], image, *argv[1:]]


def execute(workspace, argv, config):
    task_control.check(config)
    engine = status()
    if not engine['available']:
        return {'error': engine['reason'], 'mode': 'container', 'isolated': False}
    workspace = validate_workspace(workspace)
    executable = shutil.which('docker')
    name = 'astra-' + secrets.token_hex(16)
    invocation = command_line(executable, workspace, argv, config, name)
    task_control.check(config)
    process = subprocess.Popen(invocation, cwd=workspace, env=docker_environment(), stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    output = bytearray()
    total = 0
    def drain():
        nonlocal total
        try:
            while chunk := process.stdout.read(8192):
                total += len(chunk)
                output.extend(chunk[:max(0, 64000 - len(output))])
        except (OSError, ValueError):
            pass
    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    token = config.get('_cancel_token')
    timed_out = False
    cleanup_failed = False
    try:
        with token.resource(lambda: task_control.kill_process(process)) if token else nullcontext():
            try:
                process.wait(timeout=config.get('command_timeout', 120))
            except subprocess.TimeoutExpired:
                timed_out = True
                task_control.kill_process(process)
    finally:
        if process.poll() is None:
            task_control.kill_process(process)
        try:
            removed = subprocess.run([executable, 'rm', '--force', name], env=docker_environment(),
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8,
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            # --rm normally already removed it. A daemon failure needs attention.
            if removed.returncode and not status()['available']:
                cleanup_failed = True
        except (OSError, subprocess.TimeoutExpired):
            cleanup_failed = True
        reader.join(timeout=3)
        process.stdout.close()
    task_control.check(config)
    result = {'mode': 'container', 'isolated': process.returncode != 125, 'exit_code': process.returncode,
              'output': bytes(output).decode('utf-8', errors='replace'), 'truncated': total > 64000,
              'network': config.get('container_network') is True, 'image': config['container_image']}
    if timed_out:
        result['error'] = '容器命令超过执行时限，已请求终止'
    if process.returncode == 125:
        result['error'] = 'Docker 无法启动容器，请检查镜像 ID、挂载和引擎状态'
    if cleanup_failed:
        result['cleanup_warning'] = '请在 Docker 中检查并清理容器 ' + name
    return result
