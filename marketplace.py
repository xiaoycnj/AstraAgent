"""Curated package catalog, managed plugin installs and validated appearance packs."""
import hashlib
import json
from pathlib import Path
import re
import threading
import uuid
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit
import application_plugins
import extensions
LOCK = threading.RLock()
SOURCE = 'https://raw.githubusercontent.com/xiaoycnj/AstraAgent/main/marketplace/catalog.json'

class CatalogRedirect(HTTPRedirectHandler):

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != 'https' or target.hostname != 'raw.githubusercontent.com':
            raise ValueError('目录重定向地址无效')
        return super().redirect_request(request, fp, code, msg, headers, newurl)
COLOR_TOKENS = {'--theme-color', '--blue', '--accent-color', '--ink', '--muted', '--line', '--soft', '--glass-reading', '--surface'}

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def skin(value):
    if not isinstance(value, dict) or value.get('schema_version') != 1:
        raise ValueError('皮肤格式无效')
    ident = extensions.valid_id(value.get('id'))
    if value.get('theme') not in ('light', 'dark'):
        raise ValueError('皮肤主题无效')
    colors = value.get('colors')
    if not isinstance(colors, dict) or not {'--theme-color', '--blue'} <= colors.keys() or (not colors.keys() <= COLOR_TOKENS):
        raise ValueError('皮肤颜色字段无效')
    if any((not isinstance(v, str) or not re.fullmatch('#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?', v) for v in colors.values())):
        raise ValueError('皮肤仅支持十六进制颜色')
    blur = value.get('blur', 26)
    radius = value.get('radius', 20)
    if type(blur) is not int or not 12 <= blur <= 40 or type(radius) is not int or (not 8 <= radius <= 28):
        raise ValueError('皮肤材质参数超出范围')
    validate_skin_extensions(value)
    return {'schema_version': 1, 'id': ident, 'theme': value['theme'], 'colors': colors, 'blur': blur, 'radius': radius}

def package(value):
    if not isinstance(value, dict) or value.get('schema_version') != 1:
        raise ValueError('市场作品格式无效')
    for key, maximum in [('id', 64), ('name', 100), ('description', 2000), ('author', 100), ('license', 100), ('version', 40)]:
        if not isinstance(value.get(key), str) or not 0 < len(value[key]) <= maximum:
            raise ValueError('作品字段无效：' + key)
    extensions.valid_id(value['id'])
    if not re.fullmatch('\\d+\\.\\d+\\.\\d+', value['version']):
        raise ValueError('作品版本需为 x.y.z')
    kind = value.get('kind')
    payload = value.get('payload')
    if kind == 'plugin':
        normalized = application_plugins.validate(payload)
    elif kind == 'skin':
        normalized = skin(payload)
    else:
        raise ValueError('未知作品类别')
    if normalized['id'] != value['id']:
        raise ValueError('作品 ID 与内容不符')
    if value.get('sha256') != digest(payload):
        raise ValueError('作品内容校验失败')
    result = {key: value[key] for key in ('schema_version', 'id', 'kind', 'name', 'description', 'author', 'license', 'version', 'sha256')}
    result['payload'] = payload
    return result

def read_catalog(path):
    if path.stat().st_size > 500000:
        raise ValueError('市场目录过大')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict) or value.get('schema_version') != 1 or (not isinstance(value.get('entries'), list)) or (len(value['entries']) > 200):
        raise ValueError('市场目录格式无效')
    result = []
    seen = set()
    for entry in value['entries']:
        normalized = package(entry)
        key = (normalized['kind'], normalized['id'])
        if key in seen:
            raise ValueError('市场目录含重复作品')
        seen.add(key)
        result.append(normalized)
    return result

def state(data):
    path = Path(data) / 'marketplace/state.json'
    if not path.exists():
        return {'installed': {}, 'active_skin': None}
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict) or not isinstance(value.get('installed'), dict):
        raise ValueError('市场安装记录无效')
    for entry in value['installed'].values():
        package(entry)
    return value

def write_state(data, value):
    path = Path(data) / 'marketplace/state.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)

def catalog(root, data):
    cached = Path(data) / 'marketplace/catalog.json'
    path = cached if cached.exists() else Path(root) / 'marketplace/catalog.json'
    try:
        rows = read_catalog(path)
    except (ValueError, OSError):
        path = Path(root) / 'marketplace/catalog.json'
        rows = read_catalog(path)
    return {'entries': rows, 'source': 'online-cache' if path == cached else 'bundled', 'state': state(data)}

def refresh(root, data):
    with build_opener(CatalogRedirect()).open(Request(SOURCE, headers={'User-Agent': 'AstraAgent-Marketplace'}), timeout=20) as response:
        raw = response.read(500001)
    if len(raw) > 500000:
        raise ValueError('在线目录过大')
    folder = Path(data) / 'marketplace'
    folder.mkdir(parents=True, exist_ok=True)
    temporary = folder / ('catalog-' + uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_bytes(raw)
        read_catalog(temporary)
        with LOCK:
            temporary.replace(folder / 'catalog.json')
    finally:
        temporary.unlink(missing_ok=True)
    return catalog(root, data)

def key(entry):
    return entry['kind'] + ':' + entry['id']

def check_folder(root, path):
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('插件安装路径无效')
    current = path
    while True:
        if current.is_symlink() or getattr(current, 'is_junction', lambda: False)():
            raise ValueError('插件安装路径不能包含链接')
        if current == root:
            break
        current = current.parent

def install(root, data, value):
    entry = package(value)
    with LOCK, application_plugins.LOCK:
        saved = state(data)
        previous_switches = (Path(data) / 'extensions.json').read_bytes() if (Path(data) / 'extensions.json').exists() else None
        entry_key = key(entry)
        old = saved['installed'].get(entry_key)
        backup = None
        target = Path(root) / 'plugins' / entry['id']
        if entry['kind'] == 'plugin':
            check_folder(Path(root) / 'plugins', target)
            if target.exists():
                if not old:
                    raise ValueError('同名本地插件已存在，请先在插件管理中处理')
                backup = Path(root) / 'plugins/.market-trash' / (entry['id'] + '-' + uuid.uuid4().hex)
                check_folder(Path(root) / 'plugins', backup)
                backup.parent.mkdir(parents=True, exist_ok=True)
                target.rename(backup)
            try:
                application_plugins.install(root, entry['payload'])
                extensions.toggle_plugin(root, data, entry['id'], True)
            except Exception:
                restore_switches(data, previous_switches)
                if (target / 'manifest.json').is_file():
                    (target / 'manifest.json').unlink()
                    target.rmdir()
                if backup:
                    backup.rename(target)
                raise
        saved['installed'][entry_key] = entry
        try:
            write_state(data, saved)
        except Exception:
            restore_switches(data, previous_switches)
            if entry['kind'] == 'plugin':
                (target / 'manifest.json').unlink()
                target.rmdir()
                if backup:
                    backup.rename(target)
            raise
        return saved

def install_from_catalog(root, data, kind, ident, expected):
    entry = next((row for row in catalog(root, data)['entries'] if row['kind'] == kind and row['id'] == ident), None)
    if not entry or entry['sha256'] != expected:
        raise ValueError('目录已变化，请刷新后重试')
    return install(root, data, entry)

def activate(data, ident):
    with LOCK:
        saved = state(data)
        if ident is not None and 'skin:' + str(ident) not in saved['installed']:
            raise ValueError('请先安装皮肤')
        saved['active_skin'] = ident
        write_state(data, saved)
        return saved

def uninstall(root, data, kind, ident):
    with LOCK, application_plugins.LOCK:
        saved = state(data)
        previous_switches = (Path(data) / 'extensions.json').read_bytes() if (Path(data) / 'extensions.json').exists() else None
        entry_key = str(kind) + ':' + str(ident)
        if entry_key not in saved['installed']:
            raise ValueError('此作品未由市场安装')
        entry = saved['installed'][entry_key]
        target = Path(root) / 'plugins' / entry['id']
        backup = None
        if entry['kind'] == 'plugin' and target.exists():
            check_folder(Path(root) / 'plugins', target)
            backup = Path(root) / 'plugins/.market-trash' / (entry['id'] + '-' + uuid.uuid4().hex)
            check_folder(Path(root) / 'plugins', backup)
            backup.parent.mkdir(parents=True, exist_ok=True)
            try:
                extensions.toggle_plugin(root, data, entry['id'], False)
                target.rename(backup)
            except Exception:
                restore_switches(data, previous_switches)
                raise
        del saved['installed'][entry_key]
        if saved['active_skin'] == ident and kind == 'skin':
            saved['active_skin'] = None
        try:
            write_state(data, saved)
        except Exception:
            restore_switches(data, previous_switches)
            if backup:
                backup.rename(target)
            raise
        return saved

def restore_switches(data, previous):
    path = Path(data) / 'extensions.json'
    if previous is None:
        path.unlink(missing_ok=True)
    else:
        temporary=path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
        try:
            temporary.write_bytes(previous)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def validate_skin_extensions(value):
    choices={'background':('art','aurora','grid','solid'),'icon_pack':('rounded','fine','bold'),'layout':('comfortable','compact','focus')}
    for field,allowed in choices.items():
        if value.get(field,allowed[0]) not in allowed:
            raise ValueError('未知皮肤选项：'+field)
    widgets=value.get('widgets',[])
    if not isinstance(widgets,list) or len(widgets)>4:
        raise ValueError('皮肤控件数量无效')
    seen=set()
    for widget in widgets:
        if not isinstance(widget,dict) or set(widget)-{'type','label','action'}:
            raise ValueError('皮肤控件格式无效')
        if widget.get('type')!='shortcut' or widget.get('action') not in ('home','library','images','marketplace'):
            raise ValueError('未知皮肤控件动作')
        label=widget.get('label')
        if not isinstance(label,str) or not 1<=len(label)<=30 or widget['action'] in seen:
            raise ValueError('皮肤控件标签或动作重复')
        seen.add(widget['action'])
