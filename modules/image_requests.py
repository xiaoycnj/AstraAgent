"""Provider-specific image bodies. Transport and attachment permissions live upstream."""
import base64
import re
from urllib.parse import urlsplit


def family(provider):
    model = provider['model'].lower()
    host = urlsplit(provider.get('base_url', '')).hostname or ''
    if 'seedream' in model or host.endswith('.volces.com'):
        return 'seedream'
    if model.startswith(('gpt-image', 'chatgpt-image')):
        return 'gpt-image'
    if model.startswith('dall-e-'):
        return 'dall-e'
    return 'compatible'


def seedream_limits(model):
    # Named versions have different pixel budgets. Opaque endpoint IDs use the
    # server's defaults and validation instead of guessing a deployed version.
    if re.search(r'seedream[-_]5[-_.]5|seedream[-_]5[-_.]0[-_](pro|flash)', model):
        return {'1K', '1.5K', '2K'}, 921600, 4624220
    if re.search(r'seedream[-_](4[-_.]5|5[-_.]0[-_]lite)', model):
        tiers = {'2K', '4K'} if re.search(r'4[-_.]5', model) else {'2K', '3K', '4K'}
        return tiers, 3686400, 16777216
    if re.search(r'seedream[-_]4[-_.]0', model):
        return {'1K', '2K', '4K'}, 921600, 16777216
    return {'1K', '1.5K', '2K', '3K', '4K'}, None, None


def hints(provider):
    kind = family(provider)
    model = provider['model'].lower()
    if kind == 'seedream':
        tiers, minimum, maximum = seedream_limits(model)
        return {'protocol': kind, 'size_tiers': sorted(tiers), 'pixel_range': [minimum, maximum], 'reference_field': 'image', 'quality': [], 'note': '省略尺寸使用服务端默认值。参考图 JSON，单张生成，不传 n。未知部署版本由服务端校验。'}
    if kind == 'gpt-image':
        quality = ['auto', 'low', 'medium', 'high']
        if model.startswith(('gpt-image-2.5-sunburst', 'gpt-image-2.5-flare')):
            quality += ['xhigh', 'max']
        return {'protocol': kind, 'sizes': ['auto', '1024x1024', '1536x1024', '1024x1536'], 'quality': quality, 'reference_field': 'images', 'note': 'GPT Image 2 支持受像素预算限制的自定义尺寸，16 的倍数，宽高比 1:3–3:1。'}
    if kind == 'dall-e':
        return {'protocol': kind, 'sizes': ['256x256', '512x512', '1024x1024'] if model == 'dall-e-2' else ['1024x1024', '1792x1024', '1024x1792'], 'quality': [] if model == 'dall-e-2' else ['standard', 'hd'], 'note': '旧版兼容服务，插件仅接入文生图。'}
    return {'protocol': kind, 'note': 'OpenAI 兼容接口，未知别名按兼容协议处理，请核对服务商说明。'}


def parameters(provider, args, images):
    kind = family(provider)
    protocol = args.get('image_protocol', 'auto')
    if protocol not in ('auto', 'gpt-image', 'dall-e', 'seedream', 'compatible'):
        raise ValueError('图片协议无效')
    if protocol != 'auto':
        kind = protocol
    model = provider['model'].lower()
    prompt = args.get('prompt')
    limit = 1000 if model == 'dall-e-2' else 4000 if kind == 'dall-e' else 12000
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > limit:
        raise ValueError('生图提示词需为 1–' + str(limit) + ' 字符')
    body = {'model': provider['model'], 'prompt': prompt}
    if kind == 'seedream':
        body.update(response_format='b64_json', sequential_image_generation='disabled')
        if images:
            refs = ['data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii') for mime, raw in images]
            body['image'] = refs[0] if len(refs) == 1 else refs
    else:
        body['n'] = 1
        if kind != 'gpt-image':
            body['response_format'] = 'b64_json'
        elif images:
            body['images'] = [{'image_url': 'data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii')} for mime, raw in images]
    if model == 'dall-e-3' and images:
        raise ValueError('DALL·E 3 不支持参考图编辑，请选择 GPT Image 或 Seedream')
    if model == 'dall-e-2' and images:
        raise ValueError('此插件未接入 DALL·E 2 的方形 PNG 编辑流程，请选择 GPT Image 或 Seedream')

    size = args.get('size', 'auto' if kind == 'gpt-image' else None)
    if size is not None:
        if not isinstance(size, str):
            raise ValueError('图片尺寸必须是字符串')
        size = size.strip().replace('*', 'x').replace('×', 'x').replace('X', 'x')
        dimensions = re.fullmatch(r'([0-9]{2,5})x([0-9]{2,5})', size)
        if kind == 'seedream':
            tiers, minimum, maximum = seedream_limits(model)
            if size.upper() in tiers:
                size = size.upper()
            elif dimensions:
                width, height = map(int, dimensions.groups())
                if not height or not width or not 1 / 16 <= width / height <= 16 or (minimum and not minimum <= width * height <= maximum):
                    raise ValueError('Seedream 尺寸不符合该版本的总像素或宽高比限制')
            else:
                raise ValueError('Seedream 尺寸需为该版本支持的分辨率档位或宽x高')
        elif kind == 'dall-e':
            sizes = {'256x256', '512x512', '1024x1024'} if model == 'dall-e-2' else {'1024x1024', '1792x1024', '1024x1792'}
            if size not in sizes:
                raise ValueError('DALL·E 尺寸不支持此值')
        elif kind == 'gpt-image':
            if size not in {'auto', '1024x1024', '1536x1024', '1024x1536'}:
                modern = bool(re.match(r'gpt-image-[2-9]', model))
                if not modern or not dimensions:
                    raise ValueError('此 GPT Image 模型不支持该尺寸')
                width, height = map(int, dimensions.groups())
                if min(width, height) < 256 or max(width, height) > 3840 or width * height > 3840 * 2160 or width % 16 or height % 16 or not 1 / 3 <= width / height <= 3:
                    raise ValueError('GPT Image 尺寸需符合 16 倍数、宽高比和像素预算限制')
        elif not dimensions or any(not 256 <= int(value) <= 4096 or int(value) % 8 for value in dimensions.groups()):
            raise ValueError('兼容接口尺寸需为 256–4096 且为 8 的倍数')
        body['size'] = size
    elif kind in ('dall-e', 'compatible'):
        body['size'] = '1024x1024'

    allowed = {
        'gpt-image': {'quality', 'background', 'output_format', 'output_compression', 'input_fidelity'},
        'dall-e': {'quality', 'style'} if model != 'dall-e-2' else set(),
        'seedream': {'watermark', 'seed', 'output_format', 'background'},
        'compatible': {'quality', 'background', 'output_format'},
    }[kind]
    optional = {'quality', 'background', 'style', 'output_format', 'output_compression', 'input_fidelity', 'seed', 'watermark'}
    for key in optional.intersection(args):
        if key not in allowed:
            raise ValueError('此图片接口不支持参数 ' + key)
        value = args[key]
        choices = {
            'quality': {'auto', 'low', 'medium', 'high'},
            'background': {'auto', 'transparent', 'opaque'},
            'style': {'vivid', 'natural'},
            'output_format': {'png', 'jpeg', 'webp'},
            'input_fidelity': {'low', 'high'},
        }
        if key == 'quality' and kind == 'dall-e':
            choices[key] = {'standard', 'hd'}
        if key == 'quality' and kind == 'compatible':
            choices[key] |= {'standard', 'hd'}
        if key == 'quality' and model.startswith(('gpt-image-2.5-sunburst', 'gpt-image-2.5-flare')):
            choices[key] |= {'xhigh', 'max'}
        if key == 'output_format' and kind == 'seedream':
            choices[key] = {'png', 'jpeg'}
        if key in choices and (not isinstance(value, str) or value not in choices[key]):
            raise ValueError('生图参数值无效 ' + key)
        if key == 'watermark' and type(value) is not bool:
            raise ValueError('watermark 必须为布尔值')
        if key == 'seed' and (type(value) is not int or not -1 <= value <= 2147483647):
            raise ValueError('seed 必须在 -1 到 2147483647 之间')
        if key == 'output_compression' and (type(value) is not int or not 0 <= value <= 100):
            raise ValueError('output_compression 必须在 0 到 100 之间')
        if key == 'input_fidelity' and (not images or model.startswith('gpt-image-2') or (model.startswith('gpt-image-1-mini') and value != 'low')):
            raise ValueError('此模型或文生图请求不支持 input_fidelity')
        if kind == 'seedream' and key in {'output_format', 'background'}:
            if re.search(r'seedream[-_]4', model):
                raise ValueError('Seedream 4.x 不支持 ' + key)
            pro_flash = bool(re.search(r'seedream[-_]5[-_.]0[-_](pro|flash)', model))
            if key == 'background' and ('lite' in model or (pro_flash and value == 'auto')):
                raise ValueError('此 Seedream 模型不支持该背景模式')
            if key == 'background' and pro_flash and value == 'transparent':
                alpha_png = len(images or []) == 1 and images[0][0] == 'image/png' and len(images[0][1]) > 25 and images[0][1][25] in (4, 6)
                if not alpha_png:
                    raise ValueError('Seedream 5.0 pro/flash 透明背景需一张含透明通道的 PNG 参考图')
        body[key] = value
    if body.get('background') == 'transparent' and body.get('output_format') == 'jpeg':
        raise ValueError('透明背景需使用 PNG 或 WebP')
    if body.get('background') == 'transparent':
        body.setdefault('output_format', 'png')
    if 'output_compression' in body and body.get('output_format', 'png') not in {'jpeg', 'webp'}:
        raise ValueError('output_compression 仅适用于 JPEG 或 WebP')
    return body, '/images/edits' if images and kind != 'seedream' else '/images/generations'
