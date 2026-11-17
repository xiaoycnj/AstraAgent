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

    def test_layout_validation_and_old_state_defaults(self):
        value = appearance.validate(self.data, {'schema_version': 1})
        self.assertFalse(value['layout']['enabled'])
        value['layout'].update(enabled=True, home_title='My space', home_width=1000)
        self.assertEqual(appearance.save(self.data, value)['layout']['home_width'], 1000)
        for patch in [{'home_width': 2000}, {'home_columns': '3'}, {'home_order': ['greeting']}, {'sidebar_order': ['missing']}, {'sidebar_names': {'missing': 'Bad'}}]:
            broken = copy.deepcopy(value); broken['layout'].update(patch)
            with self.assertRaises(ValueError):appearance.save(self.data, broken)

    def test_shortcuts_and_module_settings_are_declarative(self):
        value = copy.deepcopy(appearance.DEFAULT)
        shortcut = {'id': 'custom-plan', 'label': 'Plan', 'icon': 'home', 'action': 'prompt', 'prompt': 'Make a plan'}
        value['layout'].update(enabled=True, shortcuts=[shortcut], sidebar_order=['custom-plan'], home_shortcuts=['custom-plan'])
        value['mods'] = [{'id':'focus', 'name':'Focus', 'settings':{'layout':{'home_width':720}}, 'enabled':True}]
        clean = appearance.save(self.data, value)
        self.assertEqual(clean['mods'][0]['settings'], {'layout':{'home_width':720}})
        for action in ['javascript:alert(1)', 'shell']:
            broken = copy.deepcopy(value); broken['layout']['shortcuts'][0]['action'] = action
            with self.assertRaises(ValueError):appearance.save(self.data, broken)
        broken = copy.deepcopy(value); broken['mods'][0]['settings']['script'] = 'run()'
        with self.assertRaises(ValueError):appearance.save(self.data, broken)
        broken = copy.deepcopy(value); broken['mods'].append(copy.deepcopy(broken['mods'][0]))
        with self.assertRaises(ValueError):appearance.save(self.data, broken)

    def test_modules_keep_assets_when_exported_individually(self):
        asset = self.upload('module.html', b'<canvas>module</canvas>')
        value = copy.deepcopy(appearance.DEFAULT)
        value['mods'] = [{'id':'media', 'name':'Media', 'version':'2.0', 'author':'Fixture', 'enabled':False,
                          'settings':{'background':{'asset':asset}, 'styles':{'font_size':18}}}]
        saved = appearance.save(self.data, value)
        with appearance.export_pack(self.data, 'media') as archive, tempfile.TemporaryDirectory() as second:
            imported = appearance.import_pack(Path(second), archive)
            self.assertEqual(imported['mods'], saved['mods'])
            self.assertTrue(appearance.asset_path(Path(second), imported['mods'][0]['settings']['background']['asset']).exists())
        with self.assertRaises(ValueError):appearance.export_pack(self.data, 'missing')

    def test_install_merges_without_changing_manual_layout_and_settings(self):
        value = copy.deepcopy(appearance.DEFAULT); value['layout']['home_width']=1000; value['styles']['font_size']=19
        appearance.save(self.data, value)
        manifest={'schema_version':1,'name':'Layout mods','mods':[{'id':'one','name':'One','settings':{'layout':{'home_width':600}}}]}
        installed=appearance.import_pack(self.data,self.pack(manifest,{}),install=True)
        self.assertEqual(installed['layout']['home_width'],1000)
        self.assertEqual(installed['styles']['font_size'],19)
        self.assertEqual(installed['mods'][0]['settings'],{'layout':{'home_width':600}})
        manifest['mods'][0]['name']='Updated'
        installed=appearance.import_pack(self.data,self.pack(manifest,{}),install=True)
        self.assertEqual(len(installed['mods']),1);self.assertEqual(installed['mods'][0]['name'],'Updated')
        legacy={'schema_version':1,'name':'Legacy','styles':{'font_size':16}}
        installed=appearance.import_pack(self.data,self.pack(legacy,{}),install=True)
        self.assertEqual(len(installed['mods']),2)
        self.assertEqual(installed['styles']['font_size'],19)

    def test_bad_module_pack_does_not_replace_installed_state(self):
        baseline=appearance.save(self.data,appearance.DEFAULT)
        manifest={'schema_version':1,'mods':[{'id':'invalid','name':'Bad','settings':{'styles':{'font_size':100}}}]}
        with self.assertRaises(ValueError):appearance.import_pack(self.data,self.pack(manifest,{}),install=True)
        self.assertEqual(appearance.load(self.data),baseline)

    def test_short_upload_and_size_limit(self):
        with self.assertRaises(ValueError): appearance.store_asset(self.data, io.BytesIO(b'x'), 100, 'file.html')
        with self.assertRaises(ValueError): appearance.store_asset(self.data, io.BytesIO(), appearance.MAX_FILE + 1, 'file.mp4')


if __name__ == '__main__':
    unittest.main()
