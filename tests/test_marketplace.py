import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import marketplace

class MarketplaceTests(unittest.TestCase):

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name) / 'app'
        self.data = Path(self.folder.name) / 'data'
        (self.root / 'plugins').mkdir(parents=True)
        self.data.mkdir()
        (self.root / 'marketplace').mkdir()
        source = Path(__file__).resolve().parents[1] / 'marketplace/catalog.json'
        (self.root / 'marketplace/catalog.json').write_bytes(source.read_bytes())
        self.entries = marketplace.catalog(self.root, self.data)['entries']

    def test_catalog_integrity_and_validation(self):
        for entry in self.entries:
            self.assertEqual(entry['sha256'], marketplace.digest(entry['payload']))
        broken = copy.deepcopy(self.entries[0])
        broken['payload']['id'] = '../outside'
        with self.assertRaises(ValueError):
            marketplace.install(self.root, self.data, broken)
        broken = copy.deepcopy(self.entries[-1])
        broken['payload']['colors']['--blue'] = 'url(https://example.com)'
        broken['sha256'] = marketplace.digest(broken['payload'])
        with self.assertRaises(ValueError):
            marketplace.install(self.root, self.data, broken)

    def test_plugin_lifecycle_and_collision(self):
        entry = self.entries[0]
        saved = marketplace.install_from_catalog(self.root, self.data, 'plugin', entry['id'], entry['sha256'])
        self.assertIn('plugin:' + entry['id'], saved['installed'])
        self.assertTrue(json.loads((self.data / 'extensions.json').read_text())[entry['id']])
        marketplace.install(self.root, self.data, entry)
        marketplace.uninstall(self.root, self.data, 'plugin', entry['id'])
        self.assertFalse((self.root / 'plugins' / entry['id']).exists())
        self.assertTrue(list((self.root / 'plugins/.market-trash').iterdir()))
        (self.root / 'plugins' / entry['id']).mkdir()
        with self.assertRaises(ValueError):
            marketplace.install(self.root, self.data, entry)

    def test_failed_state_write_restores_plugin_and_switch(self):
        entry = self.entries[0]
        marketplace.install(self.root, self.data, entry)
        manifest = (self.root / 'plugins' / entry['id'] / 'manifest.json').read_bytes()
        switches = (self.data / 'extensions.json').read_bytes()
        with patch.object(marketplace, 'write_state', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                marketplace.install(self.root, self.data, entry)
            with self.assertRaises(OSError):
                marketplace.uninstall(self.root, self.data, 'plugin', entry['id'])
        self.assertEqual(manifest, (self.root / 'plugins' / entry['id'] / 'manifest.json').read_bytes())
        self.assertEqual(switches, (self.data / 'extensions.json').read_bytes())

    def test_skin_lifecycle_and_cache_fallback(self):
        entry = self.entries[-1]
        marketplace.install(self.root, self.data, entry)
        self.assertEqual(marketplace.activate(self.data, entry['id'])['active_skin'], entry['id'])
        self.assertIsNone(marketplace.uninstall(self.root, self.data, 'skin', entry['id'])['active_skin'])
        (self.data / 'marketplace/catalog.json').write_text('broken')
        self.assertEqual(marketplace.catalog(self.root, self.data)['source'], 'bundled')
        with self.assertRaises(ValueError):
            marketplace.activate(self.data, 'missing')

    def test_direct_install_rejects_linked_plugin_root(self):
        import application_plugins
        entry=self.entries[0]
        with patch.object(Path,'is_symlink',return_value=True):
            with self.assertRaises(ValueError):
                application_plugins.install(self.root,entry['payload'])
        self.assertFalse((self.root/'plugins'/entry['id']).exists())

    def test_untrusted_redirect_rejected(self):
        with self.assertRaises(ValueError):
            marketplace.CatalogRedirect().redirect_request(None, None, 302, '', {}, 'https://localhost/catalog')
if __name__ == '__main__':
    unittest.main()
