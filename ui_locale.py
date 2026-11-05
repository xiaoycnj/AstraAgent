"""Validated local UI language packs. Pack values are rendered as text only."""
import json
import locale
import os
from pathlib import Path
import re
import secrets
import ctypes

CODE = re.compile(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*\Z')
MAX_BYTES = 1_500_000


def validate(value):
    if not isinstance(value, dict) or not isinstance(value.get('code'), str) or not CODE.fullmatch(value['code']):
        raise ValueError('Language pack requires a valid code such as fr-FR')
    if not isinstance(value.get('name'), str) or not 0 < len(value['name']) <= 80:
        raise ValueError('Language pack requires a display name')
    messages = value.get('messages')
    code = value.get('locale', value['code'])
    if not isinstance(code, str) or not CODE.fullmatch(code):
        raise ValueError('Language pack locale must be a valid language code')
    if not isinstance(messages, dict) or len(messages) > 5000:
        raise ValueError('Language pack messages must be an object with at most 5000 entries')
    if any(not isinstance(key, str) or not isinstance(text, str) or len(key) > 2000 or len(text) > 8000 for key, text in messages.items()):
        raise ValueError('Language pack entries must contain bounded text strings')
    return {'code': value['code'], 'name': value['name'], 'locale': value.get('locale', value['code']),
            'direction': 'rtl' if value.get('direction') == 'rtl' else 'ltr', 'messages': messages}


def packs(root):
    result = {}
    errors = []
    folder = root / 'i18n'
    for file in sorted(folder.glob('*.json')):
        try:
            if file.is_symlink() or file.stat().st_size > MAX_BYTES:
                raise ValueError('Language pack is too large or is a symlink')
            pack = validate(json.loads(file.read_text(encoding='utf-8-sig')))
            if pack['code'] in result:
                raise ValueError('Duplicate language code')
            result[pack['code']] = pack
        except (ValueError, OSError, UnicodeError) as error:
            errors.append({'file': file.name, 'error': str(error)[:150]})
    return result, errors


def preference(data):
    try:
        value = json.loads((data / 'ui-preferences.json').read_text(encoding='utf-8'))
        return value.get('language', 'system')
    except (ValueError, OSError, AttributeError):
        return 'system'


def save_preference(root, data, language):
    available, _ = packs(root)
    if language != 'system' and language not in available:
        raise ValueError('Language is unavailable')
    data.mkdir(parents=True, exist_ok=True)
    target = data / 'ui-preferences.json'
    temporary = target.with_suffix('.' + secrets.token_hex(6) + '.tmp')
    temporary.write_text(json.dumps({'language': language}), encoding='utf-8')
    temporary.replace(target)
    return {'language': language}


def install(root, value):
    pack = validate(value)
    if pack['code'].lower() in ('zh-cn', 'en'):
        raise ValueError('Use a different language code to keep the built-in packs')
    raw = json.dumps(pack, ensure_ascii=False, indent=2)
    if len(raw.encode()) > MAX_BYTES:
        raise ValueError('Language pack is too large')
    folder = root / 'i18n'
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (pack['code'] + '.json')
    temporary = target.with_suffix('.' + secrets.token_hex(6) + '.tmp')
    temporary.write_text(raw, encoding='utf-8')
    temporary.replace(target)
    return {'code': pack['code'], 'name': pack['name']}


def translator(root, data):
    available, _ = packs(root)
    language = preference(data)
    if language == 'system':
        language = (locale.getlocale()[0] or os.getenv('LANG', 'en')).replace('_', '-')
        if os.name == 'nt':
            buffer = ctypes.create_unicode_buffer(85)
            if ctypes.windll.kernel32.GetUserDefaultLocaleName(buffer, len(buffer)):
                language = buffer.value
        language = next((key for key in available if key.lower() == language.lower()),
                        next((key for key in available if key.split('-')[0].lower() == language.split('-')[0].lower()), 'en'))
    messages = available.get(language, {}).get('messages', {})
    return lambda text: messages.get(text, text)
