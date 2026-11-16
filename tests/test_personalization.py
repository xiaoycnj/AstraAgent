import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import personalization as appearance


class PersonalizationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.data = Path(self.folder.name)

    def upload(self, name, value):
        return appearance.store_asset(self.data, io.BytesIO(value), len(value), name)['id']

    def pack(self, manifest, assets):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('astra-skin.json', json.dumps(manifest))
            for name, value in assets.items():
                archive.writestr(name, value)
        output.seek(0)
        return output

    def test_asset_validation_and_content_addressing(self):
        ident = self.upload('wallpaper.HTML', b'<html><script>console.log(1)</script></html>')
        self.assertEqual(ident, self.upload('other.html', b'<html><script>console.log(1)</script></html>'))
        self.assertTrue(appearance.asset_path(self.data, ident).exists())
        for name, value in [('x.mp4', b'not a video'), ('x.exe', b'MZ'), ('x.svg', b'<svg><script/></svg>'),
                            ('x.svg', b'<svg><use href="https://example.com/x.svg"/></svg>')]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.upload(name, value)
        self.assertEqual(list((self.data / 'appearance/assets').glob('*.tmp')), [])

    def test_settings_roundtrip_and_validation(self):
        value = copy.deepcopy(appearance.DEFAULT)
        value['enabled'] = True
        value['background']['asset'] = self.upload('test.html', b'<h1>Wallpaper</h1>')
        value['styles']['message_color'] = '#ffffff80'
        value['styles']['font_family'] = 'Microsoft YaHei, Segoe UI'
        value['icons']['send'] = self.upload('send.svg', b'<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5"/></svg>')
        self.assertEqual(appearance.save(self.data, value), appearance.load(self.data))
        broken = copy.deepcopy(value)
        broken['styles']['font_family'] = 'url(https://example.com)'
        with self.assertRaises(ValueError): appearance.save(self.data, broken)
        broken = copy.deepcopy(value)
        broken['background']['opacity'] = float('nan')
        with self.assertRaises(ValueError): appearance.save(self.data, broken)
        broken['background']['opacity'] = .5
        broken['background']['asset'] = '../settings.json'
        with self.assertRaises(ValueError): appearance.save(self.data, broken)
        self.assertEqual(appearance.load(self.data), value)

    def test_portable_pack_roundtrip(self):
        manifest = {'schema_version': 1, 'name': 'Portable', 'background': {'asset': 'assets/bg.html'},
                    'styles': {'composer_radius': 32}, 'icons': {'home': 'assets/home.svg'}}
        assets = {'assets/bg.html': b'<canvas></canvas>', 'assets/home.svg': b'<svg xmlns="http://www.w3.org/2000/svg"><circle r="3"/></svg>'}
        saved = appearance.import_pack(self.data, self.pack(manifest, assets))
        self.assertTrue(saved['enabled'])
        self.assertEqual(saved['styles']['composer_radius'], 32)
        with appearance.export_pack(self.data) as archive, tempfile.TemporaryDirectory() as second:
            imported = appearance.import_pack(Path(second), archive)
            self.assertEqual(saved, imported)

    def test_invalid_pack_preserves_active_skin(self):
        baseline = appearance.save(self.data, appearance.DEFAULT)
        for assets in [{'../outside.html': b'<h1>No</h1>'}, {'x.html': b'Valid'}]:
            manifest = {'schema_version': 1, 'background': {'asset': 'missing.html'}}
            with self.assertRaises(ValueError): appearance.import_pack(self.data, self.pack(manifest, assets))
            self.assertEqual(appearance.load(self.data), baseline)
        self.assertFalse((self.data / 'outside.html').exists())

    def test_short_upload_and_size_limit(self):
        with self.assertRaises(ValueError): appearance.store_asset(self.data, io.BytesIO(b'x'), 100, 'file.html')
        with self.assertRaises(ValueError): appearance.store_asset(self.data, io.BytesIO(), appearance.MAX_FILE + 1, 'file.mp4')


if __name__ == '__main__':
    unittest.main()
