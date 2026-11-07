"""Export licenses from the installed optional speech environment, never application data."""
import argparse
from importlib import metadata
import json
from pathlib import Path


def export(output):
    rows=[]
    fallback=Path(__file__).resolve().parents[1]/'licenses/optional-stt'
    for distribution in metadata.distributions():
        if distribution.metadata.get('Name','').lower() in ('pip','setuptools'):continue
        texts=[]
        for file in distribution.files or []:
            name=Path(str(file)).name.lower()
            if 'license' not in name and 'licence' not in name and 'copying' not in name and name not in ('notice','notice.txt'):continue
            path=Path(distribution.locate_file(file))
            if path.is_file() and path.stat().st_size<=500000:
                texts.append(str(file)+'\n\n'+path.read_text(encoding='utf-8',errors='replace'))
        supplement=fallback/(distribution.metadata.get('Name','').lower()+'.txt')
        if not texts and supplement.is_file():texts.append(supplement.read_text(encoding='utf-8'))
        urls=[distribution.metadata.get('Home-page','')]+[item.partition(',')[2].strip() for item in distribution.metadata.get_all('Project-URL',[])]
        rows.append({'name':distribution.metadata.get('Name','optional STT dependency'),'version':distribution.version,
                     'license':distribution.metadata.get('License-Expression') or distribution.metadata.get('License') or 'See installed distribution notices',
                     'text':'\n\n'.join(texts) or 'No license text was included in this wheel; see its installed distribution metadata.',
                     'url':next((url for url in urls if url.startswith('https://')),''),'optional':True})
    model_license=fallback/'whisper-model.txt'
    if model_license.is_file():rows.append({'name':'OpenAI Whisper model','version':'user-selected','license':'MIT','text':model_license.read_text(encoding='utf-8'),'url':'https://github.com/openai/whisper','optional':True})
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps({'components':sorted(rows,key=lambda r:r['name'].lower())},ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path)
    export(parser.parse_args().output)
