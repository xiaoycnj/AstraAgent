import unittest
import runtime_engine
import security_server

class AuditFollowup(unittest.TestCase):
    def test_invalid_policy_cannot_be_approved(self):
        def unexpected(*args):
            self.fail('invalid policy reached approval')
        self.assertFalse(runtime_engine.authorize('execute_command',{'argv':['whoami']},{'access_policy':'FULL'},True,unexpected))

    def test_marketplace_refresh_is_expensive(self):
        with security_server.LOCK:
            security_server.REQUESTS.clear()
            security_server.EXPENSIVE.clear()
        try:
            for _ in range(60):
                self.assertTrue(security_server.allow('/api/marketplace/refresh','POST'))
            self.assertFalse(security_server.allow('/api/marketplace/refresh','POST'))
        finally:
            with security_server.LOCK:
                security_server.REQUESTS.clear()
                security_server.EXPENSIVE.clear()

    def test_updater_rejects_link_before_resolving(self):
        from unittest.mock import patch
        from pathlib import Path
        import updater
        with patch.object(Path,'is_symlink',return_value=True):
            with self.assertRaisesRegex(ValueError,'链接'):
                updater.install('unused.zip',Path('work/unused-update'))

    def test_mcp_relative_script_is_pinned_to_launch_root(self):
        from unittest.mock import patch
        from pathlib import Path
        import mcp_client
        import sys
        with patch.object(mcp_client,'resolved_argv',return_value=[sys.executable,'mcp_client.py']),patch.object(mcp_client.security_core,'digest',side_effect=lambda value:value):
            value=mcp_client.fingerprint({})
        self.assertIn(str(Path(mcp_client.__file__).resolve()),[item['path'] for item in value['files']])
