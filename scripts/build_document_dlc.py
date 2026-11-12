"""Build a portable Windows document OCR DLC from an isolated dependency directory."""
import argparse
import hashlib
from importlib import metadata
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]

def build(site,output):
    output.mkdir(parents=True,exist_ok=True)
    destination=output/'AstraAgent-Document-DLC-v1.0.0-win-x64.zip'
    with tempfile.TemporaryDirectory(prefix='astra-document-build-') as temp:
        stage=Path(temp);home=stage/'dlcs/document-understanding'
        runtime=home/'runtime';runtime.mkdir(parents=True)
        for source in (ROOT/'runtimes/python').iterdir():
            if source.is_file() and (source.suffix.lower() in ('.exe','.dll','.pyd','.zip','.cat') or source.name=='LICENSE.txt'):shutil.copy2(source,runtime/source.name)
        (runtime/'python314._pth').write_text('python314.zip\n.\n../site-packages\n../service\nimport site\n',encoding='utf-8')
        shutil.copytree(site,home/'site-packages',ignore=shutil.ignore_patterns('__pycache__','*.pyc','bin'))
        service=home/'service';service.mkdir()
        for name in ('document_worker.py','attachments.py'):shutil.copy2(ROOT/name,service/name)
        rows=[]
        for dist in metadata.distributions(path=[str(site)]):
            texts=[]
            for entry in dist.files or []:
                path=Path(dist.locate_file(entry));name=path.name.lower()
                if path.is_file() and path.stat().st_size<2_000_000 and any(word in str(entry).lower() for word in ('license','licence','copying','notice')):
                    texts.append(str(entry)+'\n'+path.read_text(encoding='utf-8',errors='replace'))
            fallback=ROOT/'licenses/optional-stt'/(dist.metadata['Name'].lower()+'.txt')
            if not texts and fallback.is_file():texts.append(fallback.read_text(encoding='utf-8'))
            if not texts:raise ValueError('Missing license text: '+dist.metadata['Name'])
            rows.append({'name':dist.metadata['Name'],'version':dist.version,'license':dist.metadata.get('License-Expression') or dist.metadata.get('License') or 'See bundled license files','text':'\n\n'.join(texts),'url':dist.metadata.get('Home-page') or 'https://pypi.org/project/'+dist.metadata['Name'],'optional':True})
        rows.append({'name':'CPython','version':'3.14','license':'PSF','text':(runtime/'LICENSE.txt').read_text(encoding='utf-8'),'url':'https://www.python.org','optional':True})
        (home/'notices.json').write_text(json.dumps({'components':rows},ensure_ascii=False),encoding='utf-8')
        (home/'dlc.json').write_text(json.dumps({'id':'document-understanding','version':'1.0.0','minimum_app_version':'3.5.0','platform':'windows-x64','offline':True}),encoding='utf-8')
        (home/'requirements-lock.txt').write_text('\n'.join(row['name']+'=='+row['version'] for row in rows[:-1]),encoding='utf-8')
        files=[p for p in home.rglob('*') if p.is_file()]
        inventory={p.relative_to(stage).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        (home/'file-integrity.json').write_text(json.dumps(inventory),encoding='utf-8')
        with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for path in home.rglob('*'):
                if path.is_file():archive.write(path,path.relative_to(stage).as_posix())
    with destination.open('rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
    Path(str(destination)+'.sha256').write_text(digest+'  '+destination.name+'\n',encoding='ascii')
    print(json.dumps({'path':str(destination),'size':destination.stat().st_size,'sha256':digest}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--site',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();build(args.site.resolve(),args.output.resolve())
