"""Create native declarative marketplace entries without accepting executable files."""
import json
from pathlib import Path

import application_plugins
import extensions
import marketplace
import project_workspace
import security_core
import workbench
import workspace_tools

NAME = 'create_marketplace_package'
METADATA = ('id', 'name', 'description', 'author', 'license', 'version')
DEFINITION = {'type': 'function', 'function': {
    'name': NAME,
    'description': '创建可导入市场的声明式插件、皮肤或行为 Mod。默认导出 JSON；install 仅安装，不启用，不覆盖。',
    'parameters': {'type': 'object', 'additionalProperties': False,
                   'required': ['kind', *METADATA, 'payload'], 'properties': {
        **{key: {'type': 'string'} for key in METADATA},
        'kind': {'type': 'string', 'enum': ['plugin', 'skin', 'mod']},
        'action': {'type': 'string', 'enum': ['export', 'install']},
        'payload': {'type': 'object', 'description': (
            '不填元数据或脚本。plugin/mod: hooks [{event,action,value}] (before_send: prefix/limit_length; '
            'after_response: notify/save_output; startup: reading_layout), panels [{title,text}]. '
            'skin: theme light/dark, colors 至少 --theme-color、--blue (hex); 可选 blur, radius, '
            'background, icon_pack, layout, widgets [{type:"shortcut",label,action}].')},
    }},
}}


def check_keys(value, allowed):
    if not isinstance(value, dict) or value.keys() - set(allowed):
        raise ValueError('未知或无效的作品字段')


def build(args):
    check_keys(args, (*METADATA, 'kind', 'action', 'payload'))
    if args.get('action', 'export') not in ('export', 'install'):
        raise ValueError('未知创作操作')
    meta = {key: args[key] for key in METADATA}
    security_core.relative_path(extensions.valid_id(meta['id']))
    kind = args['kind']
    content = args['payload']
    if kind in ('plugin', 'mod'):
        kind = 'plugin'
        check_keys(content, ('hooks', 'panels'))
        for field, allowed in [('hooks', ('event', 'action', 'value')), ('panels', ('title', 'text'))]:
            rows = content.get(field, [])
            if not isinstance(rows, list):
                raise ValueError('插件配置需为列表')
            for row in rows:
                check_keys(row, allowed)
        payload = {'schema_version': 2, **{k: meta[k] for k in ('id', 'name', 'description', 'version')}, **content}
    elif kind == 'skin':
        check_keys(content, ('theme', 'colors', 'blur', 'radius', 'background', 'icon_pack', 'layout', 'widgets'))
        payload = {'schema_version': 1, 'id': meta['id'], **content}
    else:
        raise ValueError('未知作品类别')
    entry = marketplace.package({'schema_version': 1, 'kind': kind, **meta,
                                 'payload': payload, 'sha256': marketplace.digest(payload)})
    if len(encode(entry)) > workspace_tools.LIMIT:
        raise ValueError('作品超过 100 KB')
    return entry


def encode(entry):
    return (json.dumps(entry, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def install_inactive(root, data, entry):
    with marketplace.LOCK, application_plugins.LOCK:
        marketplace.check_folder(data, data / 'marketplace/state.json')
        saved = marketplace.state(data)
        key = marketplace.key(entry)
        ident = entry['id']
        if key in saved['installed']:
            raise ValueError('同名作品已安装，未覆盖')
        if entry['kind'] == 'skin' and saved.get('active_skin') == ident:
            raise ValueError('同名皮肤仍被选中')
        manifest = None
        if entry['kind'] == 'plugin':
            switches = data / 'extensions.json'
            marketplace.check_folder(data, switches)
            if ident in extensions.agent_hub.PLUGINS or (switches.exists() and json.loads(switches.read_text(encoding='utf-8')).get(ident)):
                raise ValueError('此插件 ID 已保留或仍处于启用状态')
            application_plugins.install(root, entry['payload'])
            manifest = root / 'plugins' / ident / 'manifest.json'
        saved['installed'][key] = entry
        try:
            marketplace.write_state(data, saved)
        except Exception:
            if manifest is not None:
                manifest.unlink()
                manifest.parent.rmdir()
            raise


def execute(root, data, args, config):
    if not (config.get('conversation_mode') == 'agent' and config.get('_allow_package_authoring') is True
            and config.get('_authorized_tool') == NAME and NAME in config.get('tools', [])
            and config.get('file_permission') in ('ask', 'read', 'all') and config.get('access_policy') in ('full', 'ask', 'trusted')):
        raise ValueError('作品创作工具未授权')
    entry = build(args)
    receipt = {key: entry[key] for key in ('id', 'version', 'kind', 'sha256')}
    if args.get('action') == 'install':
        install_inactive(root, data, entry)
        return {**receipt, 'ok': True, 'installed': True, 'active': False}
    relative = f"marketplace-packages/{entry['id']}-{entry['version']}.{entry['kind']}.json"
    project = config.get('project_root')
    folder = Path(project) if project else data / 'files'
    with project_workspace.LOCK if project else workspace_tools.LOCK:
        if project:
            project_workspace.target(folder, relative)
        else:
            marketplace.check_folder(data, folder)
        target = workspace_tools.target(folder, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        raw = encode(entry)
        with target.open('xb') as output:
            try:
                output.write(raw)
            except OSError:
                output.close()
                target.unlink()
                raise
        workbench.invalidate_files(folder)
    return {**receipt, 'ok': True, 'path': relative, 'bytes': len(raw), 'installed': False}
