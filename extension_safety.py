"""Fail closed for extensions without changing the installed packages or preferences."""
import json
import os
from pathlib import Path
import threading
import uuid

_LOCK = threading.RLock()
_reasons = {}
_MARKER = 'extension-safety.json'


def status(data):
    data = Path(data).resolve()
    with _LOCK:
        if data not in _reasons:
            marker = data / _MARKER
            try:
                value = json.loads(marker.read_text(encoding='utf-8'))
                reason = value['reason']
                if not isinstance(reason, str) or not 0 < len(reason) <= 250:
                    raise ValueError()
            except FileNotFoundError:
                reason = ''
            except (ValueError, OSError, KeyError, TypeError, RecursionError):
                reason = '检查 extension-safety.json 后重试。'
            _reasons[data] = reason
        reason = _reasons[data]
        return {'active': bool(reason), 'reason': reason}


def require_normal(data):
    state = status(data)
    if state['active']:
        raise ValueError('扩展安全模式：' + state['reason'])


def latch(data, reason):
    data = Path(data).resolve()
    with _LOCK:
        _reasons[data] = reason
        temp = data / ('.extension-safety-' + uuid.uuid4().hex + '.tmp')
        try:
            data.mkdir(parents=True, exist_ok=True)
            with temp.open('x', encoding='utf-8') as stream:
                json.dump({'reason': reason}, stream, ensure_ascii=False)
                stream.flush()
                os.fsync(stream.fileno())
            temp.replace(data / _MARKER)
        except OSError:
            _reasons[data] += ' 安全状态无法写入磁盘。'
        finally:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
        return status(data)


def _validate(root, data):
    import application_plugins
    import extensions
    import marketplace

    label = 'extensions.json'
    try:
        switches = data / label
        if switches.exists():
            states = json.loads(switches.read_text(encoding='utf-8'))
            if not isinstance(states, dict) or any(type(v) is not bool for v in states.values()):
                raise ValueError()
            for ident in states:
                extensions.valid_id(ident)
        label = 'plugins/'
        base = root / 'plugins'
        marketplace.check_folder(base, base)
        manifests = {}
        for folder in sorted(base.iterdir()) if base.exists() else ():
            if folder.name == '.market-trash' or (not folder.is_dir() and not folder.is_symlink()):
                continue
            ident = extensions.valid_id(folder.name)
            label = f'plugins/{ident}/manifest.json'
            manifest = folder / 'manifest.json'
            marketplace.check_folder(base, manifest)
            manifests[ident] = extensions.read_manifest(manifest)
            label = 'plugins/'
        label = 'marketplace/state.json'
        saved = marketplace.raw_state(data)
        for entry_key, entry in saved['installed'].items():
            kind, ident = entry_key.split(':', 1)
            extensions.valid_id(ident)
            if kind not in ('plugin', 'skin'):
                raise ValueError()
            label = 'marketplace/state.json (' + kind + ':' + ident + ')'
            package = marketplace.package(entry)
            if marketplace.key(package) != entry_key:
                raise ValueError()
            if kind == 'plugin' and manifests.get(ident) != application_plugins.validate(package['payload']):
                label = f'plugins/{ident}/manifest.json 与市场安装记录'
                raise ValueError()
            label = 'marketplace/state.json'
        active = saved.get('active_skin')
        if active is not None and 'skin:' + extensions.valid_id(active) not in saved['installed']:
            raise ValueError()
    except (ValueError, OSError, KeyError, TypeError, AttributeError, RecursionError, RuntimeError):
        # Never include raw JSON, local absolute paths, or user-supplied exception text.
        return '检查或移除损坏的扩展：' + label + '。'
    return ''


def check(root, data, *, retry=False):
    import application_plugins
    import marketplace
    data = Path(data).resolve()
    with marketplace.LOCK, application_plugins.LOCK, _LOCK:
        prior = status(data)
        if prior['active'] and not retry:
            return prior
        reason = _validate(Path(root), data)
        if reason:
            return latch(data, reason)
        if retry:
            try:
                (data / _MARKER).unlink(missing_ok=True)
            except OSError:
                return latch(data, '无法清除 extension-safety.json。')
            _reasons[data] = ''
        return status(data)


def plugin_error(root, data, ident):
    import extensions
    ident = extensions.valid_id(ident)
    prior = status(data)
    if prior['active']:
        return prior
    if not any(p['id'] == ident and p['enabled'] for p in extensions.catalog(root, data)['plugins']):
        raise ValueError('报告的插件未启用。')
    return latch(data, '插件 ' + ident + ' 无法应用；检查后重试。')


def skin_error(data, ident):
    import extensions
    import marketplace
    ident = extensions.valid_id(ident)
    with marketplace.LOCK:
        prior = status(data)
        if prior['active']:
            return prior
        saved = marketplace.state(data)
        if saved.get('active_skin') != ident or 'skin:' + ident not in saved['installed']:
            raise ValueError('报告的皮肤不是当前启用的皮肤。')
        return latch(data, '无法应用皮肤 ' + ident + '；可移除该皮肤后重试。')
