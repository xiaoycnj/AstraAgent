import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import web_search


class SearchProvider(unittest.TestCase):
    @patch('web_search._path')
    @patch('web_search.protect', return_value=b'brave-example-key')
    @patch('web_search.security_net.opener')
    def test_public_request_and_filtered_results(self, opener, protect, path):
        response = {'web': {'results': [
            {'title': 'Example', 'url': 'https://example.org/报道', 'description': 'public page'},
            {'title': 'Unsafe', 'url': 'javascript:alert(1)'},
            {'title': 'Bad link', 'url': 'https://example.org/x>\n[bad]'},
        ]}}
        transport = opener.return_value
        transport.open.return_value = io.BytesIO(json.dumps(response).encode())
        result = web_search.search(Path('.'), {'query': '城市 新闻'})
        request = transport.open.call_args.args[0]
        uri = urlsplit(request.full_url)
        self.assertEqual((uri.scheme, uri.netloc), ('https', 'api.search.brave.com'))
        self.assertEqual(parse_qs(uri.query)['q'], ['城市 新闻'])
        self.assertEqual(request.get_header('X-subscription-token'), 'brave-example-key')
        self.assertEqual(len(result['results']), 1)
        self.assertTrue(result['results'][0]['url'].startswith('https://example.org/%'))
        self.assertNotIn('brave-example-key', json.dumps(result))

        transport.open.reset_mock()
        self.assertIn('error', web_search.search(Path('.'), {'query': 'password: abcdefghijkl'}))
        transport.open.assert_not_called()

        transport.open.side_effect = HTTPError(request.full_url, 429, 'limit', {}, None)
        self.assertIn('额度', web_search.search(Path('.'), {'query': 'news'})['error'])
