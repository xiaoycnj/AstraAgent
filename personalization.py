"""Local appearance assets and portable, declarative ZIP skin packs."""
import copy
import layout_config
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tempfile
import threading
import uuid
import xml.etree.ElementTree as ET
import zipfile
from urllib.parse import parse_qs, urlsplit

LOCK = threading.RLock()
MAX_FILE = 256 * 1024 * 1024
MAX_PACK = 512 * 1024 * 1024
MIMES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
         '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
         '.mp4': 'video/mp4', '.webm': 'video/webm', '.html': 'text/html; charset=utf-8',
         '.htm': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
         '.ttf': 'font/ttf', '.otf': 'font/otf'}
ICON_NAMES = {'home', 'images', 'schedule', 'library', 'plugins', 'more', 'settings', 'profile', 'send', 'brand'}
DEFAULT = {'schema_version': 1, 'name': '自定义外观', 'enabled': False,
           'background': {'asset': None, 'fit': 'cover', 'opacity': 1, 'blur': 0, 'paused': False, 'speed': 1},
           'styles': {'font_family': '', 'font_asset': None, 'font_size': 14,
                      'message_radius': 18, 'composer_radius': 28, 'surface_opacity': .82,
                      'message_color': '', 'composer_color': '', 'text_color': '', 'accent_color': ''},
           'icons': {}, 'layout': copy.deepcopy(layout_config.DEFAULT), 'mods': []}


def asset_path(data, ident):
    if not isinstance(ident, str) or not re.fullmatch(r'[a-f0-9]{64}\.(?:png|jpg|jpeg|webp|gif|svg|mp4|webm|html|htm|woff2|woff|ttf|otf)', ident):
        raise ValueError('外观资源标识无效')
    base = (Path(data) / 'appearance/assets').resolve()
    path = base / ident
    if not path.is_file() or not path.resolve().is_relative_to(base) or path.is_symlink():
        raise ValueError('外观资源不存在')
    return path


def validate_asset(path, suffix):
    if suffix not in MIMES or not 0 < path.stat().st_size <= MAX_FILE:
        raise ValueError('不支持的外观文件格式或文件超过 256 MB')
    with path.open('rb') as stream:
        head = stream.read(64)
    signatures = {'.png': head.startswith(b'\x89PNG\r\n\x1a\n'),
                  '.jpg': head.startswith(b'\xff\xd8\xff'), '.jpeg': head.startswith(b'\xff\xd8\xff'),
                  '.gif': head.startswith((b'GIF87a', b'GIF89a')),
                  '.webp': head.startswith(b'RIFF') and head[8:12] == b'WEBP',
                  '.mp4': head[4:8] == b'ftyp', '.webm': head.startswith(b'\x1aE\xdf\xa3'),
                  '.woff2': head.startswith(b'wOF2'), '.woff': head.startswith(b'wOFF'),
                  '.ttf': head.startswith((b'\x00\x01\x00\x00', b'true')), '.otf': head.startswith(b'OTTO')}
    if suffix in signatures and not signatures[suffix]:
        raise ValueError('外观文件内容与扩展名不符')
    if suffix in ('.html', '.htm'):
        if path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('HTML 背景超过 8 MB')
        path.read_text(encoding='utf-8-sig')
    if suffix == '.svg':
        if path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('SVG 图标超过 2 MB')
        text = path.read_text(encoding='utf-8-sig')
        if re.search(r'<!DOCTYPE|<!ENTITY', text, re.I):
            raise ValueError('SVG 不能包含实体声明')
        root = ET.fromstring(text)
        allowed = {'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
                   'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'title', 'desc', 'use'}
        for node in root.iter():
            if node.tag.split('}')[-1] not in allowed:
                raise ValueError('SVG 含不支持的活动内容')
            for key, value in node.attrib.items():
                key = key.split('}')[-1].lower()
                if key.startswith('on') or key == 'style' or re.search(r'url\(\s*[\'"]?(?!#)', value, re.I):
                    raise ValueError('SVG 图标仅支持本地形状')
                if key == 'href' and not value.startswith('#'):
                    raise ValueError('SVG 图标不能引用外部资源')


def store_asset(data, stream, size, name):
    suffix = Path(name).suffix.lower()
    if suffix not in MIMES or not 0 < size <= MAX_FILE:
        raise ValueError('不支持的外观文件格式或文件超过 256 MB')
    folder = Path(data) / 'appearance/assets'
    folder.mkdir(parents=True, exist_ok=True)
    temporary = folder / (uuid.uuid4().hex + '.tmp')
    digest = hashlib.sha256()
    try:
        with temporary.open('wb') as output:
            remaining = size
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise ValueError('外观文件上传中断')
                remaining -= len(chunk)
                digest.update(chunk)
                output.write(chunk)
        validate_asset(temporary, suffix)
        ident = digest.hexdigest() + suffix
        destination = folder / ident
        if destination.is_symlink():
            raise ValueError('外观资源目录含链接')
        if not destination.exists():
            temporary.replace(destination)
        return {'id': ident, 'mime': MIMES[suffix], 'size': size}
    except (UnicodeError, ET.ParseError) as error:
        raise ValueError('外观文件内容无效') from error
    finally:
        temporary.unlink(missing_ok=True)


def number(value, low, high):
    if type(value) not in (int, float) or not low <= value <= high:
        raise ValueError('外观数值超出范围')
    return value


def validate(data, value):
    if not isinstance(value, dict) or value.get('schema_version') != 1 or set(value) - set(DEFAULT):
        raise ValueError('外观配置格式无效')
    result = copy.deepcopy(DEFAULT)
    for group in ('background', 'styles', 'icons'):
        if not isinstance(value.get(group, {}), dict):
            raise ValueError('外观配置分组无效')
    for group in ('background', 'styles'):
        if set(value.get(group, {})) - set(DEFAULT[group]):
            raise ValueError('未知外观配置字段')
        result[group].update(value.get(group, {}))
    name = value.get('name', result['name'])
    if not isinstance(name, str) or not 1 <= len(name) <= 100:
        raise ValueError('皮肤名称无效')
    result['name'] = name
    result['enabled'] = value.get('enabled', False)
    background, styles = result['background'], result['styles']
    if type(result['enabled']) is not bool or type(background['paused']) is not bool:
        raise ValueError('外观开关无效')
    if background['fit'] not in ('cover', 'contain'):
        raise ValueError('背景填充方式无效')
    for key, low, high in [('opacity', 0, 1), ('blur', 0, 30), ('speed', .25, 2)]:
        number(background[key], low, high)
    for key, low, high in [('font_size', 12, 24), ('message_radius', 0, 32),
                           ('composer_radius', 0, 40), ('surface_opacity', .15, 1)]:
        number(styles[key], low, high)
    if not isinstance(styles['font_family'], str) or not re.fullmatch(r'[\w\s,\-\u4e00-\u9fff]{0,120}', styles['font_family']):
        raise ValueError('字体名称无效')
    for key in ('message_color', 'composer_color', 'text_color', 'accent_color'):
        if not isinstance(styles[key], str) or (styles[key] and not re.fullmatch(r'#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?', styles[key])):
            raise ValueError('外观颜色需为十六进制')
    if background['asset'] is not None:
        path = asset_path(data, background['asset'])
        if not MIMES[path.suffix].startswith(('image/', 'video/', 'text/html')):
            raise ValueError('背景资源类型无效')
    if styles['font_asset'] is not None:
        if not MIMES[asset_path(data, styles['font_asset']).suffix].startswith('font/'):
            raise ValueError('字体资源类型无效')
    icons = value.get('icons', {})
    if set(icons) - ICON_NAMES:
        raise ValueError('未知图标位置')
    for ident in icons.values():
        path = asset_path(data, ident)
        if not MIMES[path.suffix].startswith('image/') or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('图标需为 2 MB 以内的图像')
    result['icons'] = dict(icons)
    result['layout'] = layout_config.validate(value.get('layout', {}))
    result['mods'] = layout_config.modules(value.get('mods', []), lambda settings: validate(data, {'schema_version': 1, **settings}))
    if len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > 2 * 1024 * 1024:
        raise ValueError('外观配置超过 2 MB')
    return result


def load(data):
    path = Path(data) / 'appearance/state.json'
    with LOCK:
        if not path.exists():
            return copy.deepcopy(DEFAULT)
        return validate(data, json.loads(path.read_text(encoding='utf-8')))


def save(data, value):
    with LOCK:
        result = validate(data, value)
        path = Path(data) / 'appearance/state.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        return result


def references(value):
    own = [value.get('background', {}).get('asset'), value.get('styles', {}).get('font_asset'), *value.get('icons', {}).values()]
    for module in value.get('mods', []):own.extend(references(module['settings']))
    return own


def remap(value, mapping):
    result = copy.deepcopy(value)
    for group, key in [('background', 'asset'), ('styles', 'font_asset')]:
        current = result.get(group, {}).get(key)
        if current:
            if current not in mapping:
                raise ValueError('皮肤包缺少引用资源')
            result[group][key] = mapping[current]
    if 'icons' in result:result['icons'] = {name: mapping[ident] for name, ident in result['icons'].items()}
    for module in result.get('mods', []):module['settings'] = remap(module['settings'], mapping)
    return result


def import_pack(data, archive, install=False):
    try:
        with zipfile.ZipFile(archive) as pack:
            entries = pack.infolist()
            names = [item.filename for item in entries]
            if len(entries) > 128 or len(set(names)) != len(names) or sum(item.file_size for item in entries) > MAX_PACK:
                raise ValueError('皮肤包文件过多、重复或超过 512 MB')
            for item in entries:
                parts = PurePosixPath(item.filename)
                if parts.is_absolute() or '..' in parts.parts or '\\' in item.filename or ':' in item.filename or (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('皮肤包路径无效')
            if 'astra-skin.json' not in names or pack.getinfo('astra-skin.json').file_size > 2 * 1024 * 1024:
                raise ValueError('皮肤包需包含 astra-skin.json')
            manifest = json.loads(pack.read('astra-skin.json').decode('utf-8-sig'))
            if not isinstance(manifest, dict) or any(not isinstance(manifest.get(key, {}), dict) for key in ('background', 'styles', 'icons')):
                raise ValueError('皮肤包清单无效')
            manifest.setdefault('enabled', True)
            # Validate every declared resource before changing the active appearance.
            mapping = {}
            for item in entries:
                if item.is_dir() or item.filename == 'astra-skin.json':
                    continue
                with pack.open(item) as stream:
                    stored = store_asset(data, stream, item.file_size, item.filename)
                mapping[item.filename] = stored['id']
            imported = validate(data, remap(manifest, mapping))
            if not install:return save(data, imported)
            with LOCK:
                current = load(data)
                additions = imported['mods']
                if not additions:
                    ident = 'skin-' + hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:16]
                    settings = {key: imported[key] for key in ('background', 'styles', 'icons')}
                    if imported['layout']['enabled']:settings['layout'] = imported['layout']
                    additions = [{'id': ident, 'name': imported['name'], 'version': '1.0.0', 'author': '', 'description': '', 'enabled': True, 'settings': settings}]
                installed = {item['id']: item for item in current['mods']}
                installed.update({item['id']: item for item in additions})
                current['mods'] = list(installed.values())
                return save(data, current)
    except (zipfile.BadZipFile, KeyError, UnicodeError, json.JSONDecodeError, RuntimeError) as error:
        raise ValueError('皮肤包无效或缺少引用资源') from error


def export_pack(data, mod=None):
    value = load(data)
    if mod:
        found = next((item for item in value['mods'] if item['id'] == mod), None)
        if found is None:raise ValueError('模组不存在')
        value = {**copy.deepcopy(DEFAULT), 'name': found['name'], 'mods': [found]}
    mapping = {ident: 'assets/' + ident for ident in references(value) if ident}
    output = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    try:
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_STORED) as pack:
            pack.writestr('astra-skin.json', json.dumps(remap(value, mapping), ensure_ascii=False, indent=2))
            for ident, name in mapping.items():
                pack.write(asset_path(data, ident), name)
        output.seek(0)
        return output
    except Exception:
        output.close()
        raise


def serve_asset(handler, data, ident):
    path = asset_path(data, ident)
    size = path.stat().st_size
    start, end, code = 0, size - 1, 200
    request_range = handler.headers.get('Range')
    if request_range:
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', request_range)
        if not match or not any(match.groups()):
            handler.send_response(416)
            handler.send_header('Content-Range', f'bytes */{size}')
            handler.end_headers()
            return
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            start = max(0, size - int(last))
        if start > end or start >= size:
            handler.send_response(416)
            handler.send_header('Content-Range', f'bytes */{size}')
            handler.end_headers()
            return
        code = 206
    handler.send_response(code)
    handler.send_header('Content-Type', MIMES[path.suffix])
    handler.send_header('Content-Length', str(end - start + 1))
    handler.send_header('Accept-Ranges', 'bytes')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    handler.send_header('Cache-Control', 'private, max-age=86400, immutable')
    handler.send_header('Referrer-Policy', 'no-referrer')
    scripts = "'unsafe-inline'" if path.suffix in ('.html', '.htm') else "'none'"
    sandbox = 'allow-scripts' if path.suffix in ('.html', '.htm') else ''
    handler.send_header('Content-Security-Policy',
                        f"default-src 'none'; script-src {scripts}; style-src 'unsafe-inline'; "
                        "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; "
                        f"frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox {sandbox}")
    if code == 206:
        handler.send_header('Content-Range', f'bytes {start}-{end}/{size}')
    handler.end_headers()
    with path.open('rb') as stream:
        stream.seek(start)
        remaining = end - start + 1
        while remaining:
            chunk = stream.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            handler.wfile.write(chunk)
            remaining -= len(chunk)


def handle_request(handler, data):
    url = urlsplit(handler.path)
    path, method = url.path, handler.command
    if path.startswith('/appearance-assets/') and method == 'GET':
        serve_asset(handler, data, path.removeprefix('/appearance-assets/'))
    elif path == '/api/appearance' and method == 'GET':
        handler.reply(200, load(data))
    elif path == '/api/appearance' and method == 'PUT':
        handler.reply(200, save(data, handler.body()))
    elif path == '/api/appearance/validate' and method == 'POST':
        handler.reply(200, validate(data, handler.body()))
    elif path == '/api/appearance/upload' and method == 'POST':
        name = parse_qs(url.query).get('name', [''])[0]
        size = int(handler.headers.get('Content-Length', '0'))
        handler.reply(201, store_asset(data, handler.rfile, size, name))
    elif path == '/api/appearance/import' and method == 'POST':
        size = int(handler.headers.get('Content-Length', '0'))
        if not 0 < size <= MAX_PACK:
            raise ValueError('皮肤包超过 512 MB 或为空')
        with tempfile.TemporaryFile() as archive:
            remaining = size
            while remaining:
                chunk = handler.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise ValueError('皮肤包上传中断')
                archive.write(chunk)
                remaining -= len(chunk)
            archive.seek(0)
            handler.reply(200, import_pack(data, archive, parse_qs(url.query).get('install') == ['1']))
    elif path == '/api/appearance/export' and method == 'GET':
        with export_pack(data, parse_qs(url.query).get('mod', [None])[0]) as archive:
            archive.seek(0, 2)
            size = archive.tell()
            archive.seek(0)
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/zip')
            handler.send_header('Content-Length', str(size))
            handler.send_header('Content-Disposition', 'attachment; filename="astra-skin.zip"')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            handler.end_headers()
            while chunk := archive.read(1024 * 1024):
                handler.wfile.write(chunk)
    else:
        return False
    return True
