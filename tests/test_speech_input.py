"""Configured multipart transcription without a live microphone or paid API."""
import base64
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
import local_account


class SpeechInput(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.data=Path(self.temp.name)
        self.calls=[]
        owner=self
        class Service(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                body=self.rfile.read(int(self.headers['Content-Length']))
                owner.calls.append((self.path,dict(self.headers),body))
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(json.dumps({'text':'可编辑的转写文本'}).encode())
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Service)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)+'/v1'
        self.audio=b'RIFF'+bytes(4)+b'WAVE'+b'fake audio fixture'

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.temp.cleanup()

    def test_configuration_normalizes_and_never_exposes_key(self):
        result=local_account.save_stt(self.data,{'base_url':self.url+'/audio/transcriptions','model':'mock-stt','api_key':'fixture-key','language':'zh'})
        self.assertEqual(result['base_url'],self.url)
        self.assertNotIn('api_key',result);self.assertTrue(result['has_key'])
        local_account.save_stt(self.data,{'api_key':''})
        self.assertEqual(local_account.stt_config(self.data)['api_key'],'fixture-key')
        self.assertFalse(local_account.save_stt(self.data,{'clear_key':True})['has_key'])
        for body in [{'base_url':'https://user:pass@example.org'},{'language':'bad_language'},{'model':'bad\nmodel'},{'clear_key':'true'}]:
            with self.assertRaises(ValueError):local_account.save_stt(self.data,body)

    def test_real_multipart_transport_and_no_recording_files(self):
        local_account.save_stt(self.data,{'base_url':self.url,'model':'mock-stt','api_key':'fixture-key','language':'zh'})
        result=local_account.transcribe(self.data,{'data':base64.b64encode(self.audio).decode(),'mime':'audio/wav'},backend.NoRedirect)
        self.assertEqual(result['text'],'可编辑的转写文本')
        path,headers,body=self.calls[0]
        self.assertEqual(path,'/v1/audio/transcriptions')
        self.assertEqual(headers['Authorization'],'Bearer fixture-key')
        message=BytesParser(policy=default).parsebytes(('Content-Type: '+headers['Content-Type']+'\r\n\r\n').encode()+body)
        fields={part.get_param('name',header='content-disposition'):part for part in message.iter_parts()}
        self.assertEqual(fields['model'].get_payload(decode=True),b'mock-stt')
        self.assertEqual(fields['language'].get_payload(decode=True),b'zh')
        self.assertEqual(fields['response_format'].get_payload(decode=True),b'json')
        self.assertEqual(fields['file'].get_filename(),'recording.wav')
        self.assertEqual(fields['file'].get_payload(decode=True),self.audio)
        self.assertEqual([path.name for path in self.data.iterdir()],['stt.json'])

    def test_invalid_recordings_never_call_provider(self):
        with self.assertRaises(ValueError):local_account.transcribe(self.data,{},backend.NoRedirect)
        local_account.save_stt(self.data,{'base_url':self.url,'model':'mock'})
        for body in [{'mime':'audio/webm','data':'!!'},{'mime':'text/plain','data':'YQ=='},{'mime':'audio/wav','data':'YQ=='},{'mime':'audio/wav','data':''}]:
            with self.assertRaises(ValueError):local_account.transcribe(self.data,body,backend.NoRedirect)
        self.assertEqual(self.calls,[])


if __name__=='__main__':unittest.main()
