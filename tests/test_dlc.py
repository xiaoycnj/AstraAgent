"""DLC archive boundaries, release selection, cancellation and install rollback."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import dlc_manager as dlc

class DLC(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def package(self,extra=None,ident='astra-local-stt-base',minimum='3.4.1'):
  prefix='.local-stt' if ident=='astra-local-stt-base' else 'dlcs/'+ident
  data={prefix+'/dlc.json':json.dumps({'id':ident,'version':'3.4.1','minimum_app_version':minimum,'platform':'windows-x64'}).encode(),prefix+'/service/test.py':b'payload'}
  if extra:data.update(extra)
  data[prefix+'/file-integrity.json']=json.dumps({n:hashlib.sha256(v).hexdigest() for n,v in data.items()}).encode()
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
   for n,v in data.items():z.writestr(n,v)
  return out.getvalue()
 def write_package(self,raw):
  p=self.root/'fixture.zip';p.write_bytes(raw);return p
 def release(self,raw):
  name='AstraAgent-STT-DLC-base-v3.4.1-win-x64.zip'
  return {'tag_name':'v3.4.1','assets':[{'id':12,'name':name,'size':len(raw),'digest':'sha256:'+hashlib.sha256(raw).hexdigest(),'browser_download_url':'https://github.com/xiaoycnj/AstraAgent/releases/download/v3.4.1/'+name}]}
 def test_install_and_backup(self):
  home=self.root/'.local-stt';home.mkdir();(home/'user-cache.txt').write_text('keep')
  result=dlc.install(self.write_package(self.package()),self.root)
  self.assertEqual((home/'service/test.py').read_bytes(),b'payload')
  self.assertEqual((self.root/result['backup']/'user-cache.txt').read_text(),'keep')
  self.assertEqual(dlc.installed(self.root)[0]['id'],'astra-local-stt-base')
 def test_generic_pack(self):
  result=dlc.install(self.write_package(self.package(ident='demo-pack')),self.root)
  self.assertEqual(result['path'],'dlcs/demo-pack')
 def test_escape_links_duplicates_and_code_overwrite(self):
  for name in ('../outside','/outside','dlcs/demo/../../backend.py','C:/bad','bad\\file','backend.py'):
   with self.subTest(name=name),self.assertRaises(ValueError):
    dlc.install(self.write_package(self.package({name:b'bad'})),self.root)
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as z:
   info=zipfile.ZipInfo('.local-stt/link');info.create_system=3;info.external_attr=0o120777<<16;z.writestr(info,'../outside')
  with self.assertRaises(ValueError):dlc.install(self.write_package(out.getvalue()),self.root)
  with self.assertRaises(ValueError):dlc.install(self.write_package(self.package({'.local-stt/SERVICE/test.py':b'dupe'})),self.root)
  self.assertFalse((self.root/'backend.py').exists())
 def test_hash_manifest_and_compatibility(self):
  raw=self.package()
  source=zipfile.ZipFile(io.BytesIO(raw));out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as z:
   for n in source.namelist():z.writestr(n,b'tampered' if n.endswith('test.py') else source.read(n))
  with self.assertRaisesRegex(ValueError,'校验失败'):dlc.install(self.write_package(out.getvalue()),self.root)
  with self.assertRaisesRegex(ValueError,'先更新'):dlc.install(self.write_package(self.package(minimum='99.0.0')),self.root)
  with patch.object(dlc,'MAX_EXPANDED',10),self.assertRaises(ValueError):dlc.install(self.write_package(raw),self.root)
  event=threading.Event();event.set()
  with self.assertRaises(dlc.Cancelled):dlc.install(self.write_package(raw),self.root,cancel=event)
  self.assertFalse((self.root/'.local-stt').exists())
 def test_rollback_and_linked_target(self):
  home=self.root/'.local-stt';home.mkdir();(home/'old.txt').write_text('original')
  real=os.replace
  def replace(a,b):
   if str(a).endswith('payload'+os.sep+'.local-stt'):raise OSError('locked file fixture')
   return real(a,b)
  with patch.object(dlc.os,'replace',side_effect=replace),self.assertRaises(OSError):dlc.install(self.write_package(self.package()),self.root)
  self.assertEqual((home/'old.txt').read_text(),'original')
  with patch.object(dlc,'no_links',side_effect=ValueError('link')),self.assertRaises(ValueError):dlc.install(self.write_package(self.package()),self.root)
 def test_catalog_tag_and_trusted_asset(self):
  raw=self.package();release=self.release(raw);manager=dlc.Manager(self.root)
  with patch.object(dlc,'open_official',return_value=io.BytesIO(json.dumps(release).encode())) as request:
   value=manager.catalog('3.4.1')
   self.assertTrue(value['assets'][0]['available']);self.assertIn('/tags/v3.4.1',request.call_args.args[0]);manager.catalog('3.4.1');self.assertEqual(request.call_count,1)
  for tag in ('../../x','https://evil.test','latest?x=1'):
   with self.assertRaises(ValueError):manager.catalog(tag)
  for url in ('http://github.com','https://evil.test/dlc','https://github.com:8888/x','https://user@github.com/x'):
   with self.assertRaises(ValueError):dlc.check_url(url)
  release['assets'][0]['digest']=None
  with patch.object(dlc,'open_official',return_value=io.BytesIO(json.dumps(release).encode())):
   self.assertFalse(dlc.Manager(self.root).catalog()['assets'][0]['available'])
 def test_download_job_end_to_end_and_digest_refusal(self):
  raw=self.package();release=self.release(raw);manager=dlc.Manager(self.root)
  def response(url):return io.BytesIO(json.dumps(release).encode() if 'api.github.com' in url else raw)
  with patch.object(dlc,'open_official',side_effect=response):
   manager.run('v3.4.1',12)
  self.assertEqual(manager.status()['phase'],'complete');self.assertTrue((self.root/'.local-stt/dlc.json').exists())
  manager=dlc.Manager(self.root);release['assets'][0]['digest']='sha256:'+'0'*64
  with patch.object(dlc,'open_official',side_effect=response):manager.run('latest',12)
  self.assertEqual(manager.status()['phase'],'failed');self.assertIn('SHA-256',manager.status()['message'])
 def test_job_cancel_and_single_flight(self):
  manager=dlc.Manager(self.root);manager.job={'phase':'downloading'}
  with self.assertRaises(ValueError):manager.start('latest',12)
  self.assertTrue(manager.cancel()['phase']=='downloading');self.assertTrue(manager.cancelled.is_set())
  with self.assertRaises(dlc.Cancelled):manager.update(phase='installing')
  manager.job={'phase':'installing'}
  with self.assertRaises(ValueError):manager.cancel()

if __name__=='__main__':unittest.main()
