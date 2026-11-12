import base64
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import attachments
import document_understanding as doc

class DocumentOCR(unittest.TestCase):
    def test_result_enters_image_context_and_preview_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);data=root/'data';home=root/'dlcs/document-understanding'
            for name in ('runtime/python.exe','service/document_worker.py','dlc.json'):
                path=home/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('fixture')
            item=attachments.upload(data,{'name':'scan.png','data':base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()})
            def run(argv,**kwargs):
                Path(argv[-1]).write_text(json.dumps({'text':'【第 1 页】\n订单 OCR2026','pages':[{'number':1,'width':100,'height':100,'lines':[]}]}),encoding='utf-8')
            with patch.object(doc.subprocess,'run',side_effect=run):result=doc.recognize(data,item['id'],root)
            self.assertNotIn('ocr_pages',result)
            saved=attachments.meta(data,item['id']);self.assertEqual(saved['ocr_pages'][0]['number'],1)
            content=attachments.assemble(data,'读取附件',[item['id']]);self.assertIn('OCR2026',content[0]['text']);self.assertEqual(content[1]['type'],'image_url')
            with patch.object(doc.subprocess,'run',side_effect=subprocess.TimeoutExpired('fixture',180)),self.assertRaises(ValueError):doc.recognize(data,item['id'],root)
            self.assertEqual(attachments.meta(data,item['id'])['text'],saved['text'])
    def test_missing_dlc(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError,'安装文档理解'):doc.recognize(Path(temp),'0'*32,Path(temp))
