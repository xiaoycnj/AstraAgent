"""Invoke the optional offline document parser from its portable DLC runtime."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import attachments

ROOT=Path(__file__).resolve().parent
SLOT=threading.BoundedSemaphore(1)

def status(root=ROOT):
    home=Path(root)/'dlcs/document-understanding'
    return {'available':all((home/name).is_file() for name in ('runtime/python.exe','service/document_worker.py','dlc.json')),'id':'document-understanding'}

def recognize(data,key,root=ROOT):
    if not status(root)['available']:raise ValueError('请先在关于页安装文档理解 DLC')
    item=attachments.meta(data,key)
    if item['kind'] not in ('image','pdf'):raise ValueError('OCR 支持图片和 PDF')
    if not SLOT.acquire(blocking=False):raise ValueError('正在识别另一份文档，请稍后重试')
    try:
        home=Path(root)/'dlcs/document-understanding'
        folder=attachments.location(data,key)
        with tempfile.TemporaryDirectory(prefix='astra-document-') as temp:
            output=Path(temp)/'result.json'
            subprocess.run([str(home/'runtime/python.exe'),'-I',str(home/'service/document_worker.py'),str(folder/'content'),item['name'],str(output)],check=True,timeout=180,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if output.stat().st_size>4_000_000:raise ValueError('识别结果过大，请拆分文档')
            result=json.loads(output.read_text(encoding='utf-8'))
        if result.get('error'):raise ValueError(result['error'])
        item.update(text=result['text'],ocr_pages=result['pages'],ocr_status='complete')
        temporary=folder/'meta.ocr.tmp'
        temporary.write_text(json.dumps(item,ensure_ascii=False),encoding='utf-8')
        os.replace(temporary,folder/'meta.json')
        return attachments.public(item)
    except (subprocess.SubprocessError,OSError) as error:
        raise ValueError('文档识别失败或超时，请拆分文件并重试') from error
    finally:SLOT.release()
