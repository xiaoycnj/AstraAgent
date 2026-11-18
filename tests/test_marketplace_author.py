import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import application_plugins
import backend
import extensions
import marketplace
import marketplace_author as author
import runtime_engine


class MarketplaceAuthorTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.data = self.root / 'data'
        self.data.mkdir()
        self.config = dict(conversation_mode='agent', access_policy='full', file_permission='all',
                           tools=[author.NAME], _allow_package_authoring=True, _authorized_tool=author.NAME)
        self.args = dict(kind='plugin', id='demo', name='Demo', description='Declarative demo',
                         author='User', license='MIT', version='1.2.3',
                         payload={'hooks': [{'event': 'before_send', 'action': 'prefix', 'value': 'Hi '}]})

    def run_tool(self, **changes):
        return author.execute(self.root, self.data, {**self.args, **changes}, self.config)

    def test_export_import_round_trip_and_no_overwrite(self):
        result = self.run_tool(kind='mod')
        path = self.data / 'files' / result['path']
        raw = path.read_bytes()
        with self.assertRaises(FileExistsError):
            self.run_tool(name='Changed')
        self.assertEqual(raw, path.read_bytes())
        entry = marketplace.package(json.loads(raw))
        self.assertEqual(('plugin', entry['sha256']), (result['kind'], result['sha256']))
        self.assertEqual({}, marketplace.state(self.data)['installed'])
        marketplace.install(self.root, self.data, entry)
        self.assertEqual(application_plugins.before_send(self.root, self.data, 'test'), 'Hi test')

    def test_install_no_hook_until_manually_enabled(self):
        self.assertFalse(self.run_tool(action='install')['active'])
        self.assertFalse(extensions.catalog(self.root, self.data)['plugins'][0]['enabled'])
        with self.assertRaises(ValueError):
            self.run_tool(action='install', version='1.3.0')
        self.assertEqual(application_plugins.before_send(self.root, self.data, 'test'), 'test')
        extensions.toggle_plugin(self.root, self.data, 'demo', True)
        self.assertEqual(application_plugins.before_send(self.root, self.data, 'test'), 'Hi test')

    def test_stale_switch_and_unmanaged_directory_protected(self):
        (self.data / 'extensions.json').write_text('{"demo":true}')
        with self.assertRaises(ValueError):
            self.run_tool(action='install')
        self.assertFalse((self.root / 'plugins').exists())
        (self.data / 'extensions.json').write_text('{}')
        folder = self.root / 'plugins/demo'
        folder.mkdir(parents=True)
        with self.assertRaises(ValueError):
            self.run_tool(action='install')
        self.assertFalse(list(folder.iterdir()))

    def test_failed_install_rolls_back(self):
        with patch.object(marketplace, 'write_state', side_effect=OSError), self.assertRaises(OSError):
            self.run_tool(action='install')
        self.assertFalse((self.root / 'plugins/demo').exists())
        self.assertEqual({}, marketplace.state(self.data)['installed'])

    def test_skin_inactive_and_importable_from_project(self):
        skin = dict(kind='skin', payload={'theme': 'dark', 'colors': {'--theme-color': '#112233', '--blue': '#123456'}, 'background': 'grid'})
        project = self.root / 'project'
        project.mkdir()
        self.config['project_root'] = str(project)
        path = project / self.run_tool(**skin)['path']
        self.assertEqual(marketplace.package(json.loads(path.read_bytes()))['payload']['background'], 'grid')
        self.run_tool(**skin, action='install')
        saved = marketplace.state(self.data)
        self.assertIsNone(saved['active_skin'])
        self.assertIn('skin:demo', saved['installed'])

    def test_rejects_unsafe_or_unknown_inputs_before_writes(self):
        for overrides in ({'id': '../bad'}, {'id': 'nul'}, {'path': 'elsewhere'}, {'action': 'enable'},
                          {'payload': {'script': 'alert(1)'}}, {'payload': {'panels': [{'title': 'x', 'text': '', 'html': 'x'}]}},
                          {'payload': {'hooks': [{'event': 'startup', 'action': 'execute', 'value': 'x'}]}},
                          {'kind': 'skin', 'payload': {'theme': 'light', 'colors': {'--theme-color': 'red', '--blue': '#123456'}}}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.run_tool(**overrides)
        self.assertFalse(list(self.data.iterdir()))

    def test_permissions_fail_closed_and_read_or_ask_require_confirmation(self):
        def authorized(config, approval=True):
            return runtime_engine.authorize(author.NAME, self.args, config, lambda e: None, lambda *args: approval)
        for override in ({'conversation_mode': 'chat'}, {'_allow_package_authoring': False},
                         {'access_policy': None}, {'access_policy': 'deny'}, {'file_permission': 'none'}, {'tools': []}):
            config = {**self.config, **override}
            with self.subTest(override=override):
                self.assertFalse(authorized(config))
                with self.assertRaises(ValueError):
                    author.execute(self.root, self.data, self.args, config)
        for permission in ('ask', 'read'):
            config = {**self.config, 'file_permission': permission}
            self.assertFalse(authorized(config, False))
            self.assertTrue(authorized(config, True))

    def test_completion_dispatch_exports_valid_native_package(self):
        with patch.object(backend, 'ROOT', self.root), patch.object(backend, 'DATA', self.data):
            skill = self.root / 'skills/general/SKILL.md'
            skill.parent.mkdir(parents=True)
            skill.write_text('# General\nHelp')
            backend.initialize()
            backend.local_account.save_profile(self.data, {'use_memory': False})
            runtime_engine.save_settings(self.data, {'access_policy': 'full'})
            config = backend.request_config(dict(model='mock', conversation_mode='agent', allow_tools=True, file_permission='all'))
            responses = [{'choices': [{'message': {'content': None, 'tool_calls': [{'id': 'demo-call', 'type': 'function',
                         'function': {'name': author.NAME, 'arguments': json.dumps(self.args)}}]}}]},
                         {'choices': [{'message': {'content': 'Done'}}]}]
            try:
                with patch.object(backend, 'upstream', side_effect=responses):
                    self.assertEqual(backend.completion(config, []), 'Done')
                path = self.data / 'files/marketplace-packages/demo-1.2.3.plugin.json'
                self.assertEqual(marketplace.package(json.loads(path.read_bytes()))['id'], 'demo')
            finally:
                backend.security_audit.flush_pending()

    def test_agent_config_and_dynamic_load_gate(self):
        with patch.object(backend, 'ROOT', self.root), patch.object(backend, 'DATA', self.data):
            skills = self.root / 'skills/general'
            skills.mkdir(parents=True)
            (skills / 'SKILL.md').write_text('# General\nHelp')
            backend.initialize()
            for mode, allow, files, expected in [('agent',True,'all',True), ('agent',False,'all',False),
                                                  ('agent',True,'none',False), ('chat',True,'all',False)]:
                config = backend.request_config(dict(model='mock', conversation_mode=mode, allow_tools=allow, file_permission=files))
                self.assertEqual(expected, author.NAME in config['tools'])
                loaded = backend.capability_tool('load_tools', {'names': [author.NAME]}, config, None)
                self.assertEqual(expected, 'error' not in loaded)
