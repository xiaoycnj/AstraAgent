"""Release boundaries and Lite launchers using the installed interpreter."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_release', ROOT / 'scripts/build_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseEditions(unittest.TestCase):
    def test_private_data_rejected_vendor_output_docs_allowed(self):
        release.validate_public_paths(ROOT,[ROOT/'runtimes/node/node_modules/npm/docs/output/commands/npm-access.html'])
        for name in ('data/settings.json','web/assets/secret.dpapi','work/archive.zip','dlcs/demo/model.bin','web/assets/providers.json'):
            with self.assertRaises(ValueError):release.validate_public_paths(ROOT,[ROOT/name])

    def test_lite_contents_and_launcher(self):
        with tempfile.TemporaryDirectory(prefix='astra-lite-test-') as directory:
            output = Path(directory)
            package = release.build(ROOT, output, 'lite')
            with zipfile.ZipFile(package) as archive:
                names = archive.namelist()
                for name in names:
                    relative = Path(name).parts[1:]
                    self.assertNotIn(relative[0], ('data', 'runtimes', 'tests'))
                    self.assertNotIn('__pycache__', relative)
                self.assertEqual([name for name in names if '/memory/' in name], ['AstraAgent/memory/README.md'])
                self.assertIn('AstraAgent/vendor_desktop/_cffi_backend.cp314-win_amd64.pyd', names)
                self.assertIn('AstraAgent/web/assets/js/app.js', names)
                self.assertIn('AstraAgent/CHANGELOG.md', names)
                self.assertIn('AstraAgent/dlc_manager.py', names)
                self.assertIn('AstraAgent/web/assets/js/features/dlc.js', names)
                readme=archive.read('AstraAgent/README.md').decode('utf-8')
                self.assertNotRegex(readme,r'(?m)^## V\d')
                self.assertIn('Copyright (c) 2026 cnxiaoy', archive.read('AstraAgent/LICENSE').decode('utf-8'))
                manifest = json.loads(archive.read('AstraAgent/licenses/manifest.json'))
                self.assertEqual({item['name'] for item in manifest['components']}, release.LITE_LICENSES)
                for item in manifest['components']:
                    self.assertIn('AstraAgent/' + item['file'], names)
                self.assertEqual(json.loads(archive.read('AstraAgent/release.json'))['edition'], 'lite')
                archive.extractall(output / 'path with spaces')
            if os.name == 'nt':
                app = output / 'path with spaces/AstraAgent'
                env = os.environ.copy()
                env['PATH'] = str(Path(sys.executable).parent) + os.pathsep + os.environ['WINDIR'] + '\\System32'
                command = [os.environ['COMSPEC'], '/d', '/c', 'call', str(app / 'astra.bat'), 'doctor']
                result = subprocess.run(command, cwd=output,
                                        env=env, capture_output=True, text=True, encoding='utf-8', timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                doctor = json.loads(result.stdout)
                self.assertEqual(doctor['edition'], 'lite')
                self.assertFalse(doctor['portable_python'])
                self.assertFalse(doctor['webview2'])
                command = [os.environ['COMSPEC'], '/d', '/c', 'call', str(app / 'python.bat'), '-c', 'import sys; sys.exit(7)']
                result = subprocess.run(command, cwd=output,
                                        env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 7, result.stdout + result.stderr)
                command = [os.environ['COMSPEC'], '/d', '/c', 'call', str(app / 'python.bat'), '-c', 'print(123)']
                result = subprocess.run(command, cwd=output, env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(result.stdout.strip(), '123')
                env['PATH'] = ''
                result = subprocess.run(command, cwd=app, env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn('requires standard CPython 3.14 x64', result.stdout)

    def test_standard_requires_complete_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'Standard runtime missing'):
                release.source_files(Path(directory), 'standard')


if __name__ == '__main__':
    unittest.main()
