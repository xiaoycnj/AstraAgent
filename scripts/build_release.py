"""Build public Standard/Lite releases from explicit source and builtin allowlists."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
VERSION = '3.11.1'
ROOT_FILES = '''AstraAgent.exe AstraAgent.CLI.exe dlc_manager.py model_catalog.py model_registry.py auto_router.py model_adapters.py anthropic_messages.py marketplace.py application_plugins.py release_feed.py document_understanding.py document_worker.py updater.py local_stt.py execution_state.py task_graph.py native_frame.py tool_provenance.py agent_environment.py agent_hub.py attachments.py backend.py cli.py desktop.py
security_core.py security_audit.py security_net.py security_server.py extensions.py openai_oauth.py openai_responses.py local_account.py mcp_client.py project_workspace.py runtime_engine.py
runtime_paths.py sandbox_worker.py server.py storage_manager.py stream_journal.py
task_control.py usage_meter.py ui_locale.py watchdog.py workbench.py workspace_tools.py
start.bat 启动.bat astra.bat CLI.bat python.bat node.bat README.md CHANGELOG.md
requirements-desktop.txt requirements-stt.txt requirements-document.txt LICENSE SECURITY.md'''.split()
SKILLS = ('engineer', 'general', 'planner', 'study', 'writer')
PLUGINS = '''agent-dispatch code-review data-lab decision-log goals long-memory notebook
reply-archive message-guard reading-layout image-generation research-browser skill-creator task-board workflow-studio world-tree writing-kit writing-studio'''.split()
LITE_LICENSES = {'bottle', 'cffi', 'clr_loader', 'proxy_tools', 'pycparser', 'pythonnet',
                 'pywebview', 'typing_extensions', 'pypdf', 'Marked', 'DOMPurify', 'KaTeX',
                 'CodeMirror', 'KaTeX fonts', 'LobeHub model icons', 'Microsoft WebView2 SDK', 'Models.dev'}


def validate_public_paths(root,files):
    private_roots={'data','work','output','outputs','.git','.local-stt','dlcs'}
    private_names={'.env','session-capability.dpapi','settings.json','providers.json','tts.json','stt.json'}
    for path in files:
        relative=path.relative_to(root)
        if relative.parts[0].lower() in private_roots or path.name.lower() in private_names or path.suffix.lower()=='.dpapi':
            raise ValueError('Private data cannot be packaged: '+relative.as_posix())


def source_files(root, edition):
    files = [root / name for name in ROOT_FILES]
    files += [root / 'scripts' / name for name in ('update_model_registry.py','build_release.py','build_stt_dlc.py','build_document_dlc.py','build_release_catalog.py','check_dependencies.py','harden_node_runtime.py','benchmark_audit.py','install_local_stt.ps1','start_local_stt.ps1','stt_notices.py')]
    files += [path for path in (root/'licenses/optional-stt').rglob('*') if path.is_file()]
    files += [root/'docs/DESIGN-SYSTEM.md',root/'docs/INTERACTION-SPEC.md',root/'docs/UI-UX-ACCEPTANCE.md',root/'docs/MEDIA-AND-ROUTING.md',root/'docs/MODEL-ADAPTERS.md',root/'docs/LOCAL-STT.md',root/'docs/DLC.md',root/'docs/APPLICATION-PLUGINS.md',root/'docs/MARKETPLACE.md',root/'docs/SECURITY-AUDIT-2026-11-13.md']
    files += [root / 'security/npm-runtime-lock.json',root/'security/audit-2026-11-13.json',root / 'docs/UI-DESIGN.md',root/'docs/MODULES.md',root/'docs/AUDIT-2026-11-07.md',root/'docs/EXECUTION-RECOVERY.md',root/'native/Launcher.cs',root/'scripts/build_launcher.ps1']
    files += [root / 'i18n' / name for name in ('README.md', 'en.json', 'zh-CN.json', 'ja.json')]
    files += [root / name / 'README.md' for name in ('memory', 'skills', 'plugins')]
    files += [root / 'skills' / name / 'SKILL.md' for name in SKILLS]
    files += [root / 'plugins' / name / 'manifest.json' for name in PLUGINS]
    folders = ['marketplace', 'modules', 'web', 'vendor_desktop', 'vendor_python']
    if edition == 'standard':
        folders.append('runtimes')
        for name in ('runtimes/python/python.exe', 'runtimes/node/node.exe', 'runtimes/manifest.json'):
            if not (root / name).is_file():
                raise ValueError('Standard runtime missing: ' + name)
        if not list((root / 'runtimes/webview2').glob('**/msedgewebview2.exe')):
            raise ValueError('Standard WebView2 runtime missing')
    for folder in folders:
        files.extend(path for path in (root / folder).rglob('*')
                     if path.is_file() and '__pycache__' not in path.parts
                     and path.suffix.lower() not in ('.pyc', '.pyo')
                     and '.cache' not in path.parts)
    for path in files:
        if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError('Missing or external release file: ' + str(path))
    return sorted(set(files))


def build(root, output, edition):
    files = source_files(root, edition)
    manifest = json.loads((root / 'licenses/manifest.json').read_text(encoding='utf-8'))
    components = [item for item in manifest['components']
                  if edition == 'standard' or item['name'] in LITE_LICENSES]
    licenses = {item['file'] for item in components}
    if edition == 'standard':
        licenses.update(path.relative_to(root).as_posix()
                        for path in (root / 'licenses').glob('*.html'))
    for name in sorted(licenses):
        path = root / name
        if not path.resolve().is_relative_to((root / 'licenses').resolve()) or not path.is_file():
            raise ValueError('Missing or external license: ' + name)
        files.append(path)
    validate_public_paths(root,files)
    notes = '# Third-party notices\n\n'
    notes += 'AstraAgent original code is MIT licensed. See LICENSE. Third-party components retain their original copyright and license terms.\n\n'
    notes += 'This list describes components shipped in the ' + edition + ' edition. Original texts are in licenses/ and Settings / About.\n\n'
    notes += '\n'.join('- ' + item['name'] + ' ' + item['version'] + ' — ' + item['file'] for item in components) + '\n'
    release = {'app': 'AstraAgent', 'version': VERSION, 'edition': edition, 'license': 'MIT', 'platform': 'windows-x64',
               'bundled_runtime': edition == 'standard', 'python_requirement': 'CPython 3.14 x64 (GIL enabled)'}
    instructions = '''# AstraAgent {version} — {edition}

完整解压到可写目录。start.bat / 启动.bat 启动桌面，CLI.bat 打开终端助手。
Extract to a writable local folder. Run start.bat for desktop or CLI.bat for the terminal.

{environment}

astra.bat doctor 检查环境。API 地址、模型和密钥需自行配置。
Run astra.bat doctor to inspect the environment. Configure your model API before chatting.

两版使用相同应用功能。用户会话、密钥、记忆及自定义插件不随发行包提供。
Both editions share app features. User data, API keys, memories and custom plugins are excluded.
'''.format(version=VERSION, edition=edition.title(), environment=(
        '标准版内置 Python、pip、Node.js、npm 和固定 WebView2。Windows .NET Framework 使用系统组件。\n'
        'Standard bundles Python, pip, Node.js, npm and fixed WebView2. Windows .NET Framework is a system component.'
        if edition == 'standard' else
        'Lite 需本机安装标准 CPython 3.14 x64，安装时启用 Python launcher 或加入 PATH。\n'
        '桌面需系统 WebView2 Runtime 与 Windows .NET Framework。Node.js/npm 仅在相关工具或 MCP 使用时需要。\n'
        'Lite requires standard CPython 3.14 x64, available through the Python launcher or PATH.\n'
        'Desktop requires system WebView2 Runtime and Windows .NET Framework. Node.js/npm are optional for Node-based tools/MCP.\n'
        'https://www.python.org/downloads/windows/\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n'
        '也可使用 astra.bat serve --open 打开浏览器界面。\nUse astra.bat serve --open for the browser UI.'))
    generated = {'release.json': json.dumps(release, ensure_ascii=False, indent=2) + '\n',
                 'licenses/manifest.json': json.dumps({'components': components}, ensure_ascii=False, indent=2) + '\n',
                 'THIRD_PARTY_NOTICES.md': notes, 'RELEASE.md': instructions}
    sbom={'bomFormat':'CycloneDX','specVersion':'1.6','serialNumber':'urn:uuid:'+str(uuid.uuid4()),
          'version':1,'metadata':{'component':{'type':'application','name':'AstraAgent','version':VERSION}},
          'components':[{'type':'library','name':item['name'],'version':item['version'],
                         'bom-ref':item['name']+'@'+item['version'],
                         'properties':[{'name':'astra:license-file','value':item['file']}]} for item in components]}
    generated['sbom.cdx.json']=json.dumps(sbom,ensure_ascii=False,indent=2)+'\n'
    inventory={}
    for path in files:
        with path.open('rb') as stream:inventory[path.relative_to(root).as_posix()]=hashlib.file_digest(stream,'sha256').hexdigest()
    inventory.update({name:hashlib.sha256(content.encode('utf-8')).hexdigest() for name,content in generated.items()})
    generated['file-integrity.json']=json.dumps(inventory,ensure_ascii=False,indent=2)+'\n'
    output.mkdir(parents=True, exist_ok=True)
    destination = output / f'AstraAgent-V{VERSION}-{edition}-win-x64.zip'
    temporary = destination.with_suffix('.building.zip')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in files:
                archive.write(path, 'AstraAgent/' + path.relative_to(root).as_posix())
            for name, content in generated.items():
                archive.writestr('AstraAgent/' + name, content)
        with zipfile.ZipFile(temporary) as archive:
            invalid = archive.testzip()
            if invalid:
                raise ValueError('Corrupt archive entry: ' + invalid)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    with destination.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    Path(str(destination) + '.sha256').write_text(digest + '  ' + destination.name + '\n', encoding='ascii')
    print(json.dumps({'edition': edition, 'path': str(destination), 'bytes': destination.stat().st_size,
                      'sha256': digest, 'licenses': len(components)}), flush=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--edition', choices=['standard', 'lite', 'all'], default='all')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    for edition in ('standard', 'lite') if args.edition == 'all' else (args.edition,):
        build(ROOT, args.output.resolve(), edition)


if __name__ == '__main__':
    main()
