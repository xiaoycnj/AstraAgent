"""Local STT protocol tests use a fake recognizer; real-model smoke is separate."""
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request,urlopen
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import local_stt
import local_account


def form(fields=None,audio=b'RIFF\x00\x00\x00\x00WAVEdata',filename='recording.wav'):
    boundary='SpeechTestBoundary';parts=[]
    for key,value in (fields or {'model':'base'}).items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: audio/wav\r\n\r\n'.encode(),audio,f'\r\n--{boundary}--\r\n'.encode()])
    return 'multipart/form-data; boundary='+boundary,b''.join(parts)


class FakeEngine:
    model_id='base';model=object()
    def __init__(self):self.calls=[];self.wait=None;self.entered=threading.Event()
    def transcribe(self,fields,audio):
        self.calls.append((fields,audio));self.entered.set()
        if self.wait:self.wait.wait(3)
        return {'text':'本地转写测试','language':'zh','duration':1.5,'segments':[{'id':0,'start':0,'end':1.5,'text':'本地转写测试'}]}


class Service(unittest.TestCase):
    def setUp(self):
        self.engine=FakeEngine();self.server=local_stt.Server(('127.0.0.1',0),self.engine)
        threading.Thread(target=self.server.serve_forever,daemon=True).start();self.base=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        if self.engine.wait:self.engine.wait.set()
        self.server.shutdown();self.server.server_close()
    def request(self,path='/v1/audio/transcriptions',fields=None,audio=None,headers=None):
        content_type,body=form(fields,**({'audio':audio} if audio is not None else {}))
        return Request(self.base+path,data=body,headers={'Content-Type':content_type,**(headers or {})})
    def assertHTTP(self,status,request):
        with self.assertRaises(HTTPError) as caught:urlopen(request,timeout=3)
        self.assertEqual(caught.exception.code,status);caught.exception.close()
    def test_models_and_openai_response_formats(self):
        with urlopen(self.base+'/v1/models') as response:self.assertEqual(json.load(response)['data'][0]['id'],'base')
        for kind in ('json','verbose_json','text'):
            with urlopen(self.request(fields={'model':'base','response_format':kind}),timeout=3) as response:
                raw=response.read().decode()
                self.assertEqual(raw if kind=='text' else json.loads(raw)['text'],'本地转写测试')
                if kind=='verbose_json':self.assertEqual(json.loads(raw)['segments'][0]['end'],1.5)
    def test_host_origin_authentication_and_size_boundaries(self):
        self.assertHTTP(403,self.request(headers={'Origin':'https://evil.example'}))
        self.assertHTTP(403,self.request(headers={'Host':'evil.example'}))
        self.server.api_key='test-secret'
        self.assertHTTP(401,self.request())
        with urlopen(self.request(headers={'Authorization':'Bearer test-secret'})) as result:self.assertEqual(result.status,200)
        self.server.api_key=''
        self.assertHTTP(413,self.request(headers={'Content-Length':str(local_stt.MAX_BODY+1)}))
        self.assertHTTP(400,self.request(headers={'Transfer-Encoding':'chunked'}))
    def test_malformed_and_unsupported_requests(self):
        self.assertHTTP(400,Request(self.base+'/v1/audio/transcriptions',data=b'bad',headers={'Content-Type':'application/json'}))
        self.assertHTTP(400,self.request(fields={'model':'base','extra':'not supported'}))
        self.assertHTTP(400,self.request(fields={'model':'base','response_format':'srt'}))
        self.assertHTTP(404,self.request('/admin'))
        with self.assertRaises(local_stt.InputError):local_stt.multipart('text/plain',b'a')
    def test_busy_recognizer_does_not_block_health(self):
        self.engine.wait=threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            job=pool.submit(lambda:urlopen(self.request(),timeout=5).read())
            self.assertTrue(self.engine.entered.wait(2));self.assertHTTP(429,self.request())
            with urlopen(self.base+'/health',timeout=2) as health:self.assertEqual(json.load(health)['device'],'cpu')
            self.engine.wait.set();self.assertIn('本地',job.result().decode())
        self.assertEqual(len(self.engine.calls),1)
    def test_existing_astra_stt_client_connects_without_writing_recordings(self):
        import base64
        import backend
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder);local_account.save_stt(data,{'base_url':self.base+'/v1','model':'base','language':'zh'})
            result=local_account.transcribe(data,{'data':base64.b64encode(b'RIFF0000WAVEaudio').decode(),'mime':'audio/wav'},backend.NoRedirect)
            self.assertEqual(result['text'],'本地转写测试');self.assertFalse(list(data.glob('*.wav')))


class Parameters(unittest.TestCase):
    def test_cli_uses_isolated_runtime_without_starting_app_backend(self):
        import cli
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);executable=root/('.local-stt/venv/Scripts/python.exe' if cli.os.name=='nt' else '.local-stt/venv/bin/python')
            executable.parent.mkdir(parents=True);executable.write_bytes(b'')
            with patch.object(cli,'ROOT',root),patch.object(cli.subprocess,'call',return_value=0) as launch,patch.object(cli,'Client',side_effect=AssertionError('backend should not start')):
                self.assertEqual(cli.main(['stt','--model','small','--download-model']),0)
                args=launch.call_args.args[0];self.assertIn(str(executable),args);self.assertIn('--download-only',args);self.assertIn('small',args)
    def test_client_cannot_change_server_model_or_pass_paths(self):
        engine=local_stt.Engine('base')
        for requested in ('../../private','https://example.com/model','small'):
            with self.assertRaises(local_stt.InputError):engine.transcribe({'model':requested},b'')
        for temperature in ('nan','inf','-1','2','wrong'):
            with self.assertRaises(local_stt.InputError):engine.transcribe({'model':'base','temperature':temperature},b'')
        with self.assertRaises(local_stt.InputError):engine.transcribe({'model':'base','language':'../../path'},b'')
    def test_filename_is_ignored_and_duplicate_fields_rejected(self):
        content_type,raw=form(filename='../../private.txt');fields,audio=local_stt.multipart(content_type,raw)
        self.assertEqual(fields['model'],'base');self.assertTrue(audio.startswith(b'RIFF'))
        duplicate=raw.replace(b'--SpeechTestBoundary--',b'--SpeechTestBoundary\r\nContent-Disposition: form-data; name="model"\r\n\r\nbase\r\n--SpeechTestBoundary--')
        with self.assertRaises(local_stt.InputError):local_stt.multipart(content_type,duplicate)


if __name__=='__main__':unittest.main()
