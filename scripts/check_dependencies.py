"""Query OSV for shipped dependency versions. Run explicitly; no app telemetry."""
import argparse
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
PYPI={'bottle','cffi','clr_loader','proxy_tools','pycparser','pythonnet','pywebview','typing_extensions','pypdf'}
NPM={'Marked':'marked','DOMPurify':'dompurify','KaTeX':'katex','CodeMirror':'codemirror','LobeHub model icons':'@lobehub/icons'}


def query_for(item):
    name=item['name']
    if name in PYPI:ecosystem='PyPI'
    elif name in NPM or (name and (name[0].islower() or name.startswith('@')) and ' ' not in name):ecosystem='npm'
    else:return None
    return {'package':{'ecosystem':ecosystem,'name':NPM.get(name,name)},'version':item['version']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--online',action='store_true',help='Send package names/versions to api.osv.dev')
    args=parser.parse_args()
    items=json.loads((ROOT/'licenses/manifest.json').read_text(encoding='utf-8'))['components']
    queries=[(item,query_for(item)) for item in items]
    covered=[(item,query) for item,query in queries if query is not None]
    unsupported=[item['name'] for item,query in queries if query is None]
    if not args.online:
        print(json.dumps({'packages':len(covered),'manual_review':unsupported,'online_check':False},ensure_ascii=False))
        return 0
    findings=[]
    for start in range(0,len(covered),100):
        batch=covered[start:start+100]
        request=Request('https://api.osv.dev/v1/querybatch',data=json.dumps({'queries':[query for _,query in batch]}).encode(),headers={'Content-Type':'application/json'})
        with urlopen(request,timeout=60) as response:results=json.load(response)['results']
        if len(results)!=len(batch):raise ValueError('Incomplete OSV response')
        for (item,_),result in zip(batch,results):
            if result.get('vulns'):findings.append({'name':item['name'],'version':item['version'],'ids':[row['id'] for row in result['vulns']]})
    print(json.dumps({'findings':findings,'manual_review':unsupported,'online_check':True},ensure_ascii=False,indent=2))
    return 1 if findings else 0


if __name__=='__main__':
    try:sys.exit(main())
    except (OSError,ValueError,KeyError) as error:
        print('Dependency check incomplete: '+type(error).__name__,file=sys.stderr)
        sys.exit(2)
