"""Create-only local tool: filesystem behavior, permissions, and exposure."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend
import runtime_engine
import workbench


class CreateFile(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.data = self.root / 'data'
        self.project = self.root / 'project'
        self.project.mkdir()
        for key, value in [('DATA', self.data), ('ROOT', self.root)]:
            p = patch.object(backend, key, value)
            p.start()
            self.addCleanup(p.stop)
        skill = self.root / 'skills/general/SKILL.md'
        skill.parent.mkdir(parents=True)
        skill.write_text('# General\nHelp', encoding='utf-8')
        backend.initialize()

    def create(self, path, content, project=None):
        return backend.run_file_tool('create_file', {'path': path, 'content': content}, project)

    def test_exclusive_utf8_creation_cache_and_existing_target(self):
        for project in (None, self.project):
            root = project or self.data / 'files'
            (root / 'nested').mkdir(parents=True)
            workbench.files(self.data, project)
            raw = '你好\nline\r\n'.encode()
            result = self.create('nested/new.txt', raw.decode(), project)
            self.assertEqual(result['bytes'], len(raw))
            self.assertNotIn(str(root.resolve()), workbench.FILE_CACHE)
            self.assertEqual(self.create('nested/new.txt', 'replacement', project)['code'], 'conflict')
            self.assertEqual((root / 'nested/new.txt').read_bytes(), raw)
            self.assertTrue(self.create('new/sub/empty', '', project)['created'])
            self.assertEqual((root / 'new/sub/empty').read_bytes(), b'')

    def test_invalid_paths_and_encoded_byte_limits(self):
        for project, limit in ((None, 100_000), (self.project, 500_000)):
            for path in ('../outside', '/absolute', 'CON', 'file:stream', '.'):
                self.assertIn('error', self.create(path, 'text', project))
            for content in (None, 'é' * (limit // 2 + 1), '\ud800'):
                self.assertIn('error', self.create('rejected/file', content, project))
            self.assertFalse(((project or self.data / 'files') / 'rejected').exists())
            self.assertEqual(self.create('limit', 'é' * (limit // 2), project)['bytes'], limit)
        self.assertIn('error', self.create('.git/private', 'x', self.project))
        self.assertFalse((self.project / '.git').exists())

    def test_request_exposure(self):
        def exposed(**options):
            return 'create_file' in backend.request_config({'model': 'mock', 'allow_tools': True, **options})['tools']
        self.assertFalse(exposed(file_permission='none'))
        for permission in ('read', 'ask', 'all'):
            self.assertTrue(exposed(file_permission=permission))
        self.assertFalse(exposed(file_permission='all', allow_tools=False, tools=['create_file']))
        self.assertFalse(exposed(file_permission='all', conversation_mode='chat'))
        self.assertFalse(exposed(file_permission='all', access_policy='deny'))
        runtime_engine.save_settings(self.data, {'access_policy': 'full'})
        self.assertTrue(exposed(file_permission='none', access_policy='full'))
        backend.feature_modules.set_enabled(self.data, 'workspace', False)
        self.assertFalse(exposed(file_permission='all'))

    def test_permission_decisions_and_actual_tool_loop(self):
        for permission, granted, succeeds, prompts in [('none', True, False, 0), ('read', False, False, 1),
                ('ask', False, False, 1), ('ask', True, True, 1), ('all', False, True, 0)]:
            name = permission + str(granted)
            config = {'model': 'mock', 'tools': ['create_file'], 'access_policy': 'full', 'file_permission': permission}
            args = json.dumps({'path': name, 'content': 'received'})
            answers = [{'choices': [{'message': {'tool_calls': [{'id': 'create', 'function': {'name': 'create_file', 'arguments': args}}]}}]},
                       {'choices': [{'message': {'content': 'done'}}]}]
            approve = Mock(return_value=granted)
            with patch.object(backend, 'stream_upstream', side_effect=answers), patch.object(backend, 'approve_tool', approve):
                backend.completion(config, [{'role': 'user', 'content': 'create'}], lambda e: None)
            self.assertEqual(approve.call_count, prompts)
            self.assertEqual((self.data / 'files' / name).is_file(), succeeds)
            self.assertEqual(config.get('_mutation_epoch', 0), int(succeeds))


if __name__ == '__main__':
    unittest.main()
