import hashlib,json,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import updater
class UpdateTests(unittest.TestCase):
 def package(self,folder,bad=False):
  raw={'a.txt':b'new','b.txt':b'next'};inv={k:hashlib.sha256(v).hexdigest() for k,v in raw.items()};p=folder/'update.zip'
  if bad:inv['a.txt']='0'*64
  with zipfile.ZipFile(p,'w') as z:
   for k,v in raw.items():z.writestr('AstraAgent/'+k,v)
   z.writestr('AstraAgent/file-integrity.json',json.dumps(inv))
  return p
 def test_install_preserves_user_data(self):
  with tempfile.TemporaryDirectory() as t:
   f=Path(t);target=f/'app';target.mkdir();(target/'data').mkdir();(target/'data/key').write_text('kept');updater.install(self.package(f),target)
   self.assertEqual((target/'a.txt').read_text(),'new');self.assertEqual((target/'data/key').read_text(),'kept')
 def test_failure_rolls_back(self):
  with tempfile.TemporaryDirectory() as t:
   f=Path(t);target=f/'app';target.mkdir();(target/'a.txt').write_text('old');real=updater.os.replace
   def replace(a,b):
    if str(a).endswith('stage\\b.txt') or str(a).endswith('stage/b.txt'):raise OSError('locked')
    return real(a,b)
   with patch.object(updater.os,'replace',side_effect=replace),self.assertRaises(OSError):updater.install(self.package(f),target)
   self.assertEqual((target/'a.txt').read_text(),'old');self.assertFalse((target/'b.txt').exists())
 def test_bad_digest_and_source_checkout_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   f=Path(t);target=f/'app';target.mkdir()
   with self.assertRaises(ValueError):updater.install(self.package(f,True),target)
   (target/'.git').mkdir()
   with self.assertRaises(ValueError):updater.install(self.package(f),target)
 def test_traversal_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'bad.zip'
   with zipfile.ZipFile(p,'w') as z:z.writestr('AstraAgent/../escape','x')
   with zipfile.ZipFile(p) as z,self.assertRaises(ValueError):updater.checked_members(z)
 def test_worker_stages_self_contained_window(self):
  with tempfile.TemporaryDirectory() as t:
   folder = Path(t)
   with patch.object(updater.tempfile, 'mkdtemp', return_value=t), \
        patch.object(updater.shutil, 'copytree'), \
        patch.object(updater.subprocess, 'Popen') as popen:
    popen.return_value.pid = 123
    updater.launch(folder / 'data', 42)
   for relative in ('web/assets/startup/update.html', 'web/assets/startup/window.css',
                    'web/assets/startup/light-rainbow.css', 'web/assets/startup/window.js', 'web/assets/startup/astra.svg',
                    'web/assets/icons/brand/astra.ico'):
    self.assertEqual((folder / relative).read_bytes(), (updater.ROOT / relative).read_bytes(), relative)
   self.assertIn('src="astra.svg"', (folder / 'web/assets/startup/update.html').read_text(encoding='utf-8'))
   self.assertEqual(popen.call_args.kwargs['cwd'], folder)
if __name__=='__main__':unittest.main()
