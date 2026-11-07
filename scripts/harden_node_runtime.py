"""Reproduce the pinned security overrides for the bundled npm environment."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]


def apply(stage):
    modules=ROOT/'runtimes/node/node_modules/npm/node_modules'
    boundary=modules.resolve()
    sources=[]
    for item in (stage/'node_modules').iterdir():
        if item.name.startswith('.'):
            continue
        sources.extend(item.iterdir() if item.name.startswith('@') else [item])
    changed=[]
    manifest_path=ROOT/'licenses/manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    for source in sources:
        metadata=json.loads((source/'package.json').read_text(encoding='utf-8'))
        relative=source.relative_to(stage/'node_modules')
        destination=modules/relative
        resolved=destination.resolve()
        if resolved==boundary or not resolved.is_relative_to(boundary) or destination.is_symlink():
            raise ValueError('Unsafe runtime package target')
        current=json.loads((destination/'package.json').read_text(encoding='utf-8')) if (destination/'package.json').exists() else {}
        if current.get('version')==metadata['version']:
            continue
        # This exact absolute package directory is verified above before recursive replacement.
        if destination.exists():shutil.rmtree(destination)
        shutil.copytree(source,destination)
        name=metadata['name'];version=metadata['version']
        license_files=[p for p in source.iterdir() if p.is_file() and p.name.lower().startswith(('license','licence','copying'))]
        if not license_files:raise ValueError('Missing license for '+name)
        text='\n\n'.join(p.read_text(encoding='utf-8') for p in sorted(license_files))
        filename=re.sub('[^A-Za-z0-9._-]+','-',name)+'-'+version+'.txt'
        (ROOT/'licenses'/filename).write_text(text,encoding='utf-8')
        old=[item for item in manifest['components'] if item['name']==name]
        manifest['components']=[item for item in manifest['components'] if item['name']!=name]
        manifest['components'].append({'name':name,'version':version,'license':metadata.get('license','See license text'),
            'url':'https://www.npmjs.com/package/'+name,'text':text,'file':'licenses/'+filename})
        for item in old:
            previous=(ROOT/item['file']).resolve()
            if previous.is_relative_to((ROOT/'licenses').resolve()) and previous.name!=filename:previous.unlink(missing_ok=True)
        changed.append({'name':name,'version':version})
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    notices=ROOT/'THIRD_PARTY_NOTICES.md'
    introduction=notices.read_text(encoding='utf-8').split('\n- bottle ')[0]
    notices.write_text(introduction+'\n'+''.join('- '+item['name']+' '+item['version']+' — '+str(item['license'])+' — '+item['file']+'\n' for item in manifest['components']),encoding='utf-8')
    # Record the overrides without pretending this is an unmodified npm distribution.
    npm_path=modules.parent/'package.json'
    package=json.loads(npm_path.read_text(encoding='utf-8'))
    lock=json.loads((ROOT/'security/npm-runtime-lock.json').read_text(encoding='utf-8'))
    package['astraSecurityOverrides']=lock['packages']['']['dependencies']
    for key in ('glob','minimatch'):
        package['dependencies'][key]='^'+package['astraSecurityOverrides'][key]
    npm_path.write_text(json.dumps(package,indent=2),encoding='utf-8')
    shutil.copyfile(ROOT/'security/npm-runtime-lock.json',ROOT/'runtimes/npm-security-lock.json')
    print(json.dumps({'updated':changed},ensure_ascii=False))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,help='Use an already installed lockfile-matching staging directory')
    args=parser.parse_args()
    if args.stage:
        lock=(ROOT/'security/npm-runtime-lock.json').read_bytes()
        if json.loads((args.stage/'package-lock.json').read_text(encoding='utf-8-sig'))!=json.loads(lock):
            raise ValueError('Staging lockfile differs from committed security lock')
        apply(args.stage.resolve())
        return
    with tempfile.TemporaryDirectory(prefix='astra-npm-security-') as temporary:
        stage=Path(temporary)
        lock=json.loads((ROOT/'security/npm-runtime-lock.json').read_text(encoding='utf-8'))
        (stage/'package.json').write_text(json.dumps(lock['packages']['']),encoding='utf-8')
        (stage/'package-lock.json').write_text(json.dumps(lock),encoding='utf-8')
        subprocess.run([str(ROOT/'runtimes/node/node.exe'),str(ROOT/'runtimes/node/node_modules/npm/bin/npm-cli.js'),
                        'ci','--prefix',str(stage),'--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],
                       check=True,cwd=ROOT,timeout=180,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        apply(stage)


if __name__=='__main__':main()
