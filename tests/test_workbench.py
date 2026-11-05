import tempfile,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import workbench
class Workbench(unittest.TestCase):
    def test_files_revision_and_escape(self):
        with tempfile.TemporaryDirectory() as data:
            root=Path(data);f=workbench.write_file(root,'src/test.py','print(1)',None)
            with self.assertRaises(FileExistsError):workbench.write_file(root,'src/test.py','bad',None)
            f=workbench.write_file(root,'src/test.py','print(2)',f['revision'])
            self.assertEqual(f['content'],'print(2)')
            self.assertEqual(workbench.files(root)[0]['path'],'src/test.py')
            with self.assertRaises(ValueError):workbench.file_path(root,'../outside')
    def test_shell_ack_and_state(self):
        shells=workbench.available_shells()
        if not shells:self.skipTest('No supported native shell')
        with tempfile.TemporaryDirectory() as data:
            with self.assertRaises(ValueError):workbench.start_terminal(Path(data),shells[0][0],False)
            info=workbench.start_terminal(Path(data),shells[0][0],True);term=workbench.TERMINALS[info['id']]
            try:
                if info['shell'] in ('pwsh','powershell'):
                    term.execute('$asTestValue=41')
                    self.assertIn('42',term.execute('Write-Output ($asTestValue+1)')['output'])
                else:
                    term.execute('AS_TEST_VALUE=41')
                    self.assertIn('42',term.execute('echo $((AS_TEST_VALUE+1))')['output'])
                self.assertFalse(info['isolated'])
            finally:term.close()
