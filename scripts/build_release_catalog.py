"""Build the official REST-independent catalog from GitHub release metadata."""
import argparse
import json
from pathlib import Path

def build(source,target):
    value=json.loads(source.read_text(encoding='utf-8-sig'))
    result={k:value[k] for k in ('tag_name','html_url')}
    result.update(body=value.get('body',''),draft=False,prerelease=False,assets=[])
    for asset in value.get('assets',[]):
        if not asset['name'].endswith('.zip'):continue
        result['assets'].append({k:asset[k] for k in ('id','name','size','digest','browser_download_url')})
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('target',type=Path)
    args=parser.parse_args();build(args.source,args.target)
