"""Build a relocatable, offline Windows CPU STT add-on from an installed environment."""
import argparse
import base64
import hashlib
from importlib import metadata
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION='1.0.0'


def canonical(name):return re.sub(r'[-_.]+','-',name).lower()


def dependency_closure(site):
    try:from packaging.requirements import Requirement
    except ImportError:from pip._vendor.packaging.requirements import Requirement
    installed={canonical(d.metadata['Name']):d for d in metadata.distributions(path=[str(site)])}
    result={};queue=['faster-whisper']
    while queue:
        name=canonical(queue.pop())
        if name in result:continue
        if name not in installed:raise ValueError('Missing speech dependency: '+name)
        distribution=installed[name];result[name]=distribution
        for raw in distribution.requires or []:
            requirement=Requirement(raw)
            if requirement.marker and not requirement.marker.evaluate({'extra':''}):continue
            dep=canonical(requirement.name)
            if dep not in installed or not requirement.specifier.contains(installed[dep].version):raise ValueError('Unsatisfied speech dependency: '+raw)
            queue.append(dep)
    return result


def write(path,text):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text,encoding='utf-8')


def build(root, output, site=None):
    site=(site or root/'.local-stt/venv/Lib/site-packages').resolve()
    dependencies=dependency_closure(site)
    if dependencies['av'].version!='19.0.2':raise ValueError('Native notices in this release match av 19.0.2; update notices before changing the native media build')
    cache=root/'.local-stt/models/models--Systran--faster-whisper-base'
    revision=(cache/'refs/main').read_text().strip()
    if not re.fullmatch('[a-f0-9]{40}',revision):raise ValueError('Invalid model snapshot revision')
    model=cache/'snapshots'/revision
    output.mkdir(parents=True,exist_ok=True)
    destination=output/f'AstraAgent-STT-DLC-base-v{VERSION}-win-x64.zip'
    with tempfile.TemporaryDirectory(prefix='astra-stt-dlc-') as folder:
        stage=Path(folder);home=stage/'.local-stt';runtime=home/'runtime';runtime.mkdir(parents=True)
        for path in (root/'runtimes/python').iterdir():
            if path.is_file() and (path.suffix.lower() in ('.exe','.dll','.pyd','.zip','.cat') or path.name=='LICENSE.txt'):shutil.copy2(path,runtime/path.name)
        if not (runtime/'python.exe').exists() or not (runtime/'python314.zip').exists():raise ValueError('Missing embedded CPython 3.14 runtime')
        write(runtime/'python314._pth','python314.zip\n.\n../site-packages\n../service\nimport site\n')
        for distribution in dependencies.values():
            if not distribution.files:raise ValueError('Wheel file inventory is missing')
            for relative in distribution.files:
                source=Path(distribution.locate_file(relative)).resolve()
                if not source.is_relative_to(site):continue # No absolute-path console entry points.
                if '__pycache__' in source.parts or source.suffix in ('.pyc','.pyo','.pth') or source.name=='direct_url.json':continue
                if not source.is_file():raise ValueError('Dependency file is missing: '+str(relative))
                if relative.hash and relative.hash.mode=='sha256':
                    digest=base64.urlsafe_b64encode(hashlib.sha256(source.read_bytes()).digest()).decode().rstrip('=')
                    if digest!=relative.hash.value:raise ValueError('Installed dependency differs from wheel inventory: '+str(relative))
                target=home/'site-packages'/source.relative_to(site);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
        for name in ('model.bin','config.json','tokenizer.json','vocabulary.txt'):
            source=model/name
            if not source.is_file() or not source.resolve().is_relative_to(cache.resolve()):raise ValueError('Model file missing or outside its cache')
            target=home/'models/base'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
        write(home/'requirements-lock.txt','\n'.join(sorted(d.metadata['Name']+'=='+d.version for d in dependencies.values()))+'\n')
        shutil.copytree(root/'licenses/optional-stt',home/'licenses/optional-stt')
        shutil.copy2(root/'LICENSE',home/'licenses/AstraAgent-MIT.txt')
        (home/'service').mkdir();shutil.copy2(root/'local_stt.py',home/'service/local_stt.py')
        original=json.loads((root/'.local-stt/notices.json').read_text(encoding='utf-8'))
        notices=[]
        for row in original['components']:
            name=canonical(row['name'])
            if name in dependencies:
                if row['version']!=dependencies[name].version:raise ValueError('Regenerate optional dependency notices before packaging')
                notices.append(row)
            elif row['name'] in ('OpenAI Whisper model','PyAV native media libraries'):notices.append(row)
        if not set(dependencies)<={canonical(row['name']) for row in notices}:raise ValueError('Missing dependency license notices')
        python_license=next(row for row in json.loads((root/'licenses/manifest.json').read_text(encoding='utf-8'))['components'] if row['name']=='CPython')
        notices.append({**python_license,'optional':True})
        write(home/'notices.json',json.dumps({'components':notices},ensure_ascii=False,indent=2)+'\n')
        write(home/'start-stt.ps1',r'''param([int]$Port=8790,[int]$Threads=4,[string]$Language='zh')
$ErrorActionPreference='Stop'
$sttArguments=@((Join-Path $PSScriptRoot 'service\local_stt.py'),'--model','base','--cache-dir',(Join-Path $PSScriptRoot 'models'),'--port',$Port,'--threads',$Threads)
if($Language){$sttArguments+=@('--language',$Language)}
& (Join-Path $PSScriptRoot 'runtime\python.exe') @sttArguments
if($LASTEXITCODE -ne 0){throw 'Local STT stopped with an error.'}
''')
        write(stage/'INSTALL-STT-DLC.txt',
              'AstraAgent Local STT DLC / base / Windows x64\n\n'
              'Extract into your AstraAgent folder, keeping the .local-stt directory.\n'
              'AstraAgent 3.4.1+: run AstraAgent.CLI.exe stt\n'
              'Standalone: powershell -File .local-stt/start-stt.ps1\n'
              'No system Python, pip installation, GPU or model download is needed.\n'
              'Base URL: http://127.0.0.1:8790/v1 | Model: base | Language: zh\n'
              'CPU INT8. Ctrl+C stops the service. Nothing starts automatically.\n'
              'All included licenses are in .local-stt/notices.json and runtime/LICENSE.txt.\n'
              'Native media DLLs retain LGPL/GPL and other component terms, not the app MIT license.\n'
              'Source/build references and library replacement information: .local-stt/licenses/optional-stt/native/\n'
              'Uploaded recordings and transcripts are not included in this archive.\n')
        version=subprocess.check_output([str(runtime/'python.exe'),'-I','-c','import sys;print(sys.version.split()[0])'],text=True).strip()
        write(home/'dlc.json',json.dumps({'id':'astra-local-stt-base','version':VERSION,'minimum_app_version':'3.4.1','platform':'windows-x64',
              'python':version,'model':{'id':'base','repo':'Systran/faster-whisper-base','revision':revision},'offline':True},indent=2)+'\n')
        files=[p for p in stage.rglob('*') if p.is_file()]
        inventory={p.relative_to(stage).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        write(home/'file-integrity.json',json.dumps(inventory,indent=2)+'\n')
        files.append(home/'file-integrity.json')
        temporary=destination.with_suffix('.building.zip')
        try:
            with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                for path in sorted(files):archive.write(path,path.relative_to(stage).as_posix())
            with zipfile.ZipFile(temporary) as archive:
                if archive.testzip():raise ValueError('DLC archive integrity failed')
            temporary.replace(destination)
        finally:temporary.unlink(missing_ok=True)
        raw_bytes=sum(p.stat().st_size for p in files)
    with destination.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    Path(str(destination)+'.sha256').write_text(digest+'  '+destination.name+'\n',encoding='ascii')
    result={'path':str(destination),'bytes':destination.stat().st_size,'unpacked_bytes':raw_bytes,'sha256':digest,'dependencies':len(dependencies)}
    print(json.dumps(result),flush=True);return destination


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'dist');parser.add_argument('--site-packages',type=Path)
    args=parser.parse_args();build(ROOT,args.output.resolve(),args.site_packages)
