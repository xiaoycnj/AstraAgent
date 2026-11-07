"""Shared local security boundaries. DPAPI protects at rest, not from the same OS user."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import uuid
import ctypes
import subprocess

from openai_oauth import protect

LOCK = threading.RLock()
PRIVATE_ROOTS = set()
DIRECTORY_STATUS={}
SECRET_PATTERN = re.compile(
    r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|'
    r'\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|'
    r'AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|'
    r'(?i:(?:api[_ -]?key|access[_ -]?token|password|secret|密码|密钥)\s*[=:：]\s*["\']?[^\s"\']{8,})'
)


def reject_secrets(content):
    if SECRET_PATTERN.search(content):
        raise ValueError('检测到可能的密钥或密码，请移除后再保存长期记忆')


def relative_path(value):
    if not isinstance(value, str) or not value or len(value) > 500:
        raise ValueError('路径无效')
    if value.startswith(('/', '\\')) or any(c in value for c in ':\x00<>"|?*') or any(ord(c)<32 for c in value):
        raise ValueError('仅允许工作区相对路径')
    for part in value.replace('\\', '/').split('/'):
        if part == '..' or part.endswith((' ', '.')) and part != '.':
            raise ValueError('路径不能包含上级目录或末尾空格、点')
        stem = part.split('.')[0].rstrip(' ').upper()
        if re.fullmatch(r'CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³]', stem):
            raise ValueError('路径包含 Windows 保留设备名')
    return value


def protect_private(path):
    resolved = Path(path).resolve()
    roots = PRIVATE_ROOTS | {Path(__file__).resolve().parent / 'data'}
    if any((resolved == root or resolved.is_relative_to(root)) and not resolved.is_relative_to(root / 'files') for root in roots):
        raise ValueError('智能体文件工具不能访问应用私有数据目录')
    return resolved


def private_path(path):
    try:
        protect_private(path)
        return False
    except ValueError:
        return True


def atomic_write(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _windows_user_sid():
    executable=Path(os.environ['SystemRoot'])/'System32'/'whoami.exe'
    result=subprocess.run([str(executable),'/user','/fo','csv','/nh'],capture_output=True,check=True,timeout=10,creationflags=subprocess.CREATE_NO_WINDOW)
    match=re.search(rb'"(S-1-\d+(?:-\d+)+)"',result.stdout)
    if not match:raise ValueError('无法取得当前 Windows 用户 SID')
    return match[1].decode('ascii')

def private_existing_acl(path):
    if os.name!='nt':return path.stat().st_mode&0o077==0
    from ctypes import wintypes
    advapi=ctypes.WinDLL('advapi32',use_last_error=True)
    get=advapi.GetFileSecurityW;get.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(wintypes.DWORD)]
    size=wintypes.DWORD();get(str(path),4,None,0,ctypes.byref(size))
    if not size.value:return False
    buffer=ctypes.create_string_buffer(size.value)
    if not get(str(path),4,buffer,size.value,ctypes.byref(size)):return False
    string=wintypes.LPWSTR();convert=advapi.ConvertSecurityDescriptorToStringSecurityDescriptorW
    convert.argtypes=[ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,ctypes.POINTER(wintypes.LPWSTR),ctypes.c_void_p]
    if not convert(buffer,1,4,ctypes.byref(string),None):return False
    try:sddl=string.value
    finally:
        kernel=ctypes.WinDLL('kernel32');kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree(string)
    if not sddl or not sddl.startswith('D:') or 'NO_ACCESS_CONTROL' in sddl:return False
    sid=_windows_user_sid()
    trusted={sid,'SY','BA','S-1-5-18','S-1-5-32-544'}
    if sid.endswith('-500'):trusted.add('LA') # SDDL local Administrator alias.
    if sid.endswith('-501'):trusted.add('LG') # Alias only when it is this exact user.
    for raw in re.findall(r'\(([^()]*)\)',sddl):
        fields=raw.split(';')
        if fields[0]=='D':continue
        if len(fields)!=6 or fields[0]!='A' or fields[5] not in trusted:return False
    return True

def prepare_directory(path):
    try:restrict_directory(path);status={'mode':'private-acl','warning':''}
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        try:verified=private_existing_acl(path)
        except (OSError,ValueError,subprocess.SubprocessError):verified=False
        if verified:
            status={'mode':'verified-existing-acl','warning':'未能重设目录权限，已验证现有 ACL 仅允许当前用户、SYSTEM 与管理员访问。'}
            print('Data directory warning: '+status['warning'],flush=True)
        else:raise PermissionError('数据目录无法设置或验证私有权限。请使用当前用户的本地 NTFS 目录作为 --data-dir；不会静默降低凭据与会话保护。') from error
    DIRECTORY_STATUS[str(path.resolve())]=status
    return status

def restrict_directory(path):
    """Replace the directory DACL with inheritable current-user and SYSTEM access."""
    if os.name != 'nt':
        path.chmod(0o700)
        return
    from ctypes import wintypes
    executable = Path(os.environ['SystemRoot']) / 'System32' / 'whoami.exe'
    result = subprocess.run([str(executable), '/user', '/fo', 'csv', '/nh'],
                            capture_output=True, check=True, timeout=10,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    match=re.search(rb'"(S-1-\d+(?:-\d+)+)"',result.stdout)
    if not match:
        raise ValueError('无法取得当前 Windows 用户 SID')
    sid=match[1].decode('ascii')
    descriptor = ctypes.c_void_p()
    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    convert = advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW
    convert.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    convert.restype = wintypes.BOOL
    apply = advapi.SetFileSecurityW
    apply.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p]
    apply.restype = wintypes.BOOL
    sddl = f'D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)'
    if not convert(sddl, 1, ctypes.byref(descriptor), None):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not apply(str(path), 0x80000004, descriptor):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree(descriptor)


def seal(value):
    if isinstance(value, list):
        return [seal(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: seal(item) for key, item in value.items() if key not in ('api_key', 'api_key_dpapi')}
    key = value.get('api_key', '')
    if key:
        result['api_key_dpapi'] = base64.b64encode(protect(key.encode(), True)).decode('ascii')
    return result


def unseal(value):
    if isinstance(value, list):
        return [unseal(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: unseal(item) for key, item in value.items() if key != 'api_key_dpapi'}
    if value.get('api_key_dpapi'):
        result['api_key'] = protect(base64.b64decode(value['api_key_dpapi'], validate=True), False).decode()
    return result


def write_config(path, value):
    with LOCK:
        atomic_write(path, json.dumps(seal(value), ensure_ascii=False, indent=2).encode('utf-8'))


def read_config(path, default):
    with LOCK:
        if not path.exists():
            return default.copy()
        raw = json.loads(path.read_text(encoding='utf-8'))
        value = unseal(raw)
        # Complete encryption and atomic replacement before discarding legacy plaintext.
        if '"api_key"' in json.dumps(raw):
            write_config(path, value)
        return value


def save_capability(data, token):
    atomic_write(data / 'session-capability.dpapi', protect(token.encode(), True))


def capability(data):
    return protect((Path(data) / 'session-capability.dpapi').read_bytes(), False).decode()


def launch_url(url, data):
    return url.split('#')[0] + '#access=' + capability(data)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
