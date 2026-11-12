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
