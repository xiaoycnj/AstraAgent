"""Optional CPU speech service. No speech dependencies are imported by AstraAgent."""
import argparse
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent
MAX_AUDIO=5*1024*1024
MAX_BODY=MAX_AUDIO+65536
SAMPLE_RATE=16000


class InputError(ValueError):pass


def multipart(content_type, body):
    if len(content_type)>250 or not content_type.isascii() or '\r' in content_type or '\n' in content_type:raise InputError('Invalid Content-Type')
    message=BytesParser(policy=default).parsebytes(('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode('ascii')+body)
    if message.get_content_type()!='multipart/form-data' or not message.is_multipart() or message.defects:raise InputError('Expected multipart/form-data')
    fields={};audio=None
    parts=list(message.iter_parts())
    if not 1<=len(parts)<=8:raise InputError('Too many multipart fields')
    for part in parts:
        if part.is_multipart() or part.defects:raise InputError('Invalid multipart field')
        name=part.get_param('name',header='content-disposition')
        if part.get_content_disposition()!='form-data' or not name:raise InputError('Invalid form field')
        raw=part.get_payload(decode=True)
        if not isinstance(raw,bytes):raise InputError('Invalid multipart payload')
        if name=='file':
            if audio is not None or not raw or len(raw)>MAX_AUDIO:raise InputError('One nonempty file of at most 5 MB is required')
            audio=raw # Client filenames are never used as filesystem paths.
        else:
            if name in fields or name not in ('model','language','prompt','response_format','temperature') or len(raw)>4000:raise InputError('Unsupported or duplicate field')
            try:fields[name]=raw.decode('utf-8')
            except UnicodeError:raise InputError('Fields must be UTF-8') from None
    if audio is None:raise InputError('Missing audio file')
    return fields,audio


def decode_audio(raw, max_seconds):
    import av
    import numpy as np
    samples=0;chunks=[];deadline=time.monotonic()+20
    resampler=av.AudioResampler(format='s16',layout='mono',rate=SAMPLE_RATE)
    def append(frame):
        nonlocal samples
        samples+=frame.samples
        if samples>max_seconds*SAMPLE_RATE:raise InputError('Audio exceeds the duration limit')
        chunks.append(frame.to_ndarray().reshape(-1).tobytes())
    try:
        # No HTTP/file protocols for playlists or references hidden inside uploads.
        with av.open(io.BytesIO(raw),mode='r',options={'protocol_whitelist':'pipe'}) as container:
            if container.format.name not in ('wav','mp3','ogg','matroska,webm','mov,mp4,m4a,3gp,3g2,mj2','flac'):raise InputError('Unsupported audio container')
            for index,frame in enumerate(container.decode(audio=0)):
                if index>=100000 or time.monotonic()>deadline:raise InputError('Audio decoding limit reached')
                if not 8000<=frame.sample_rate<=192000 or len(frame.layout.channels)>8:raise InputError('Unsupported audio layout')
                frame.pts=None
                for converted in resampler.resample(frame):append(converted)
            for converted in resampler.resample(None):append(converted)
    except InputError:raise
    except Exception:raise InputError('Cannot decode this audio file') from None
    if not samples:raise InputError('Audio contains no samples')
    return np.frombuffer(b''.join(chunks),dtype=np.int16).astype(np.float32)/32768.0


class Engine:
    def __init__(self, model='base', cache=None, threads=4, language=None, offline=True, max_seconds=120):
        self.source=model;self.model_id=Path(model).name if Path(model).is_dir() else model
        portable=Path(cache)/model if cache and model in ('tiny','base','small','medium','large-v3') else None
        if portable and (portable/'model.bin').is_file():self.source=str(portable)
        self.cache=cache;self.threads=threads;self.language=language;self.offline=offline;self.max_seconds=max_seconds;self.model=None
    def load(self):
        if self.model is None:
            try:from faster_whisper import WhisperModel
            except ImportError:raise RuntimeError('Run scripts/install_local_stt.ps1 first; speech dependencies are optional') from None
            self.model=WhisperModel(self.source,device='cpu',compute_type='int8',cpu_threads=self.threads,num_workers=1,download_root=str(self.cache) if self.cache else None,local_files_only=self.offline)
    def transcribe(self, fields, audio):
        if fields.get('model') not in (self.model_id,'whisper-1'):raise InputError('Requested model is not hosted by this service')
        language=fields.get('language') or self.language
        if language and not re.fullmatch('[a-z]{2,3}',language):raise InputError('Use a Whisper language code such as zh or en')
        prompt=fields.get('prompt','')
        if len(prompt)>1000:raise InputError('Prompt is too long')
        try:temperature=float(fields.get('temperature','0'))
        except ValueError:raise InputError('Invalid temperature') from None
        if not 0<=temperature<=1:raise InputError('Temperature must be between zero and one')
        self.load();wave=decode_audio(audio,self.max_seconds)
        segments,info=self.model.transcribe(wave,language=language,initial_prompt=prompt or None,beam_size=3,temperature=temperature,condition_on_previous_text=False,vad_filter=True)
        rows=[];size=0
        for segment in segments:
            size+=len(segment.text)
            if size>32000:raise InputError('Transcript is too long')
            rows.append({'id':len(rows),'start':round(segment.start,3),'end':round(segment.end,3),'text':segment.text})
        return {'text':''.join(s['text'] for s in rows).strip(),'language':info.language,'duration':round(len(wave)/SAMPLE_RATE,3),'segments':rows}


class Server(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address,engine,api_key=''):
        if not api_key.isascii() or len(api_key)>4096 or any(ord(char)<32 for char in api_key):raise ValueError('API key must be printable ASCII')
        self.engine=engine;self.api_key=api_key;self.slot=threading.BoundedSemaphore(1);self.connections=threading.BoundedSemaphore(4)
        super().__init__(address,Handler)
    def process_request(self,request,address):
        if not self.connections.acquire(blocking=False):
            try:request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            finally:self.shutdown_request(request)
            return
        try:super().process_request(request,address)
        except BaseException:self.connections.release();raise
    def process_request_thread(self,*args):
        try:super().process_request_thread(*args)
        finally:self.connections.release()


class Handler(BaseHTTPRequestHandler):
    server_version='AstraLocalSTT/1.0';sys_version=''
    def setup(self):
        super().setup();self.connection.settimeout(20)
    def log_message(self,*args):pass # Never log uploads, prompts, tokens or transcripts.
    def send(self,code,value,text=False):
        raw=value.encode('utf-8') if text else json.dumps(value,ensure_ascii=False).encode('utf-8')
        self.send_response(code);self.send_header('Content-Type','text/plain; charset=utf-8' if text else 'application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Connection','close');self.end_headers();self.close_connection=True
        try:self.wfile.write(raw)
        except OSError:pass
    def error(self,code,message):self.send(code,{'error':{'message':message,'type':'local_stt_error'}})
    def allowed(self):
        host=self.headers.get('Host','')
        if host not in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'):self.error(403,'Invalid Host');return False
        if self.headers.get('Origin') is not None:self.error(403,'Browser cross-origin requests are disabled; use the AstraAgent backend');return False
        if self.server.api_key and not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+self.server.api_key):self.error(401,'Invalid API key');return False
        return True
    def do_GET(self):
        if not self.allowed():return
        path=urlsplit(self.path).path
        if path=='/health':return self.send(200,{'status':'ok','model':self.server.engine.model_id,'ready':self.server.engine.model is not None,'device':'cpu','compute_type':'int8'})
        if path=='/v1/models':return self.send(200,{'object':'list','data':[{'id':self.server.engine.model_id,'object':'model','owned_by':'local'}]})
        return self.error(404,'Route not found')
    def do_POST(self):
        if not self.allowed():return
        if urlsplit(self.path).path!='/v1/audio/transcriptions':return self.error(404,'Route not found')
        if self.headers.get('Transfer-Encoding'):return self.error(400,'Chunked uploads are not supported')
        lengths=self.headers.get_all('Content-Length',[])
        if len(lengths)!=1 or not lengths[0].isdigit():return self.error(411,'A Content-Length is required')
        size=int(lengths[0])
        if not 0<size<=MAX_BODY:return self.error(413,'Upload exceeds 5 MB plus multipart overhead')
        if not self.server.slot.acquire(blocking=False):return self.error(429,'Recognizer is busy; retry after the current request completes')
        try:
            raw=self.rfile.read(size)
            if len(raw)!=size:raise InputError('Incomplete upload')
            fields,audio=multipart(self.headers.get('Content-Type',''),raw)
            response_format=fields.get('response_format','json')
            if response_format not in ('json','text','verbose_json'):raise InputError('Use json, text or verbose_json')
            result=self.server.engine.transcribe(fields,audio)
            if response_format=='text':return self.send(200,result['text'],True)
            return self.send(200,result if response_format=='verbose_json' else {'text':result['text']})
        except InputError as error:return self.error(400,str(error))
        except ValueError:return self.error(400,'Invalid audio or transcription parameters')
        except (TimeoutError,OSError):return self.error(408,'Upload or local inference failed')
        except Exception:return self.error(503,'Recognizer unavailable; check the service console and installed model')
        finally:self.server.slot.release()


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',default='base',help='Whisper model name or a trusted local CTranslate2 model directory')
    parser.add_argument('--cache-dir',type=Path,default=ROOT/'.local-stt/models')
    parser.add_argument('--port',type=int,default=8790)
    parser.add_argument('--threads',type=int,default=min(4,os.cpu_count() or 1))
    parser.add_argument('--language',default=None)
    parser.add_argument('--max-seconds',type=int,default=120)
    parser.add_argument('--download-only',action='store_true',help='Download and load the chosen model, then exit')
    parser.add_argument('--api-key-env',default='ASTRA_STT_API_KEY')
    args=parser.parse_args(argv)
    os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY','1')
    os.environ.setdefault('HF_HUB_DISABLE_XET','1')
    os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT','60')
    if not 0<=args.port<=65535 or not 1<=args.threads<=32 or not 1<=args.max_seconds<=120:parser.error('Port, threads or duration out of range')
    engine=Engine(args.model,args.cache_dir,args.threads,args.language,not args.download_only,args.max_seconds)
    try:engine.load()
    except Exception as error:raise SystemExit('Local STT startup failed: '+str(error)) from None
    if args.download_only:print('Model ready: '+engine.model_id);return
    with Server(('127.0.0.1',args.port),engine,os.environ.get(args.api_key_env,'')) as server:
        print(f'Local STT http://127.0.0.1:{server.server_port}/v1 | {engine.model_id} | CPU INT8 | Ctrl+C to stop',flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass


if __name__=='__main__':main()
