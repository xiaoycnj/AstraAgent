"""Read official release metadata with a REST-independent release-asset fallback."""
import json
import re
from urllib.error import HTTPError,URLError
from urllib.parse import urlsplit
from urllib.request import Request,build_opener,HTTPRedirectHandler

REPO='xiaoycnj/AstraAgent'
class Redirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,url):
        target=urlsplit(url)
        if target.username or target.password or target.port not in (None,443):raise ValueError('更新服务地址无效')
        if target.scheme!='https' or target.hostname not in ('github.com','api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'):raise ValueError('更新服务重定向来源无效')
        return super().redirect_request(req,fp,code,msg,headers,url)

def read(url):
    with build_opener(Redirect()).open(Request(url,headers={'User-Agent':'AstraAgent-Updater','Accept':'application/vnd.github+json'}),timeout=20) as response:
        raw=response.read(2_000_001)
    if len(raw)>2_000_000:raise ValueError('发行清单过大')
    return json.loads(raw)

def fetch(tag='latest'):
    if tag!='latest' and not re.fullmatch(r'v\d+\.\d+\.\d+',tag):raise ValueError('发行版本无效')
    endpoint='latest' if tag=='latest' else 'tags/'+tag
    try:return read('https://api.github.com/repos/'+REPO+'/releases/'+endpoint)
    except (HTTPError,URLError,TimeoutError,OSError):
        endpoint='latest/download' if tag=='latest' else 'download/'+tag
        result=read('https://github.com/'+REPO+'/releases/'+endpoint+'/release-catalog.json')
        if not isinstance(result,dict) or not re.fullmatch(r'v\d+\.\d+\.\d+',result.get('tag_name','')) or not isinstance(result.get('assets'),list):raise ValueError('发行清单无效')
        if tag!='latest' and result['tag_name']!=tag:raise ValueError('发行清单版本不匹配')
        prefix='https://github.com/'+REPO+'/releases/download/'+result['tag_name']+'/'
        for asset in result['assets']:
            if not isinstance(asset,dict) or not isinstance(asset.get('name'),str) or '/' in asset['name'] or '\\' in asset['name'] or asset.get('browser_download_url')!=prefix+asset['name']:raise ValueError('发行资源地址无效')
            if type(asset.get('size')) is not int or asset['size']<0 or not re.fullmatch(r'sha256:[a-f0-9]{64}',asset.get('digest','')):raise ValueError('发行资源缺少可信校验')
        return result
