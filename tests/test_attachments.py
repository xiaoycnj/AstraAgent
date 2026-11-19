import base64,io,json,tempfile,unittest,zipfile,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import attachments
class Attachments(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.data=Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def upload(self,name,raw):return attachments.upload(self.data,{'name':name,'data':base64.b64encode(raw).decode()})
 def test_text_and_images(self):
  text=self.upload('test.txt','你好，附件'.encode());self.assertEqual(text['kind'],'text');self.assertIn('你好',attachments.assemble(self.data,'read',[text['id']]))
  image=self.upload('pixel.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII='))
  parts=attachments.assemble(self.data,'image',[image['id']]);self.assertEqual(parts[1]['type'],'image_url');self.assertTrue(parts[1]['image_url']['url'].startswith('data:image/png;base64,'))
  with self.assertRaises(ValueError):attachments.assemble(self.data,'x',[text['id'],text['id']])
  with self.assertRaises(ValueError):attachments.meta(self.data,'../x')
 def test_docx_and_limits(self):
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w') as z:z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:t>Word attachment</w:t></w:document>')
  item=self.upload('test.docx',b.getvalue());self.assertIn('Word attachment',attachments.assemble(self.data,'x',[item['id']]))
  with self.assertRaises(ValueError):self.upload('fake.jpg',b'bad image')
  with self.assertRaises(ValueError):self.upload('large.txt',b'a'*(attachments.MAX_FILE+1))
 def test_library_metadata_and_outputs(self):
  import sqlite3
  db=sqlite3.connect(':memory:');attachments.initialize(db)
  item=self.upload('notes.txt',b'private extracted content')
  db.execute('INSERT INTO session_outputs(session_id,attachment_id) VALUES (?,?)',('session',item['id']))
  result=attachments.library(db,self.data)
  self.assertEqual(len(result['items']),1)
  self.assertTrue(result['items'][0]['output'])
  self.assertNotIn('text',result['items'][0])
  self.assertNotIn('private extracted content',json.dumps(result))
  db.close()
 def test_native_save_preserves_original_bytes_and_handles_cancel(self):
  raw='原始文本\r\n'.encode('utf-8-sig')
  item=self.upload('NUL.txt',raw)
  target=self.data/'chosen.txt'
  suggestions=[]
  def choose(name):
   suggestions.append(name)
   return (str(target),)
  self.assertTrue(attachments.save_copy(self.data,item['id'],choose))
  self.assertEqual(suggestions,['_NUL.txt'])
  self.assertEqual(target.read_bytes(),raw)
  target.write_bytes(b'keep this')
  self.assertFalse(attachments.save_copy(self.data,item['id'],lambda _:None))
  self.assertEqual(target.read_bytes(),b'keep this')
  with self.assertRaisesRegex(ValueError,'无法保存附件'):
   attachments.save_copy(self.data,item['id'],lambda _:(str(self.data),))
 def test_native_save_rejects_invalid_or_missing_content_before_dialog(self):
  item=self.upload('notes.txt',b'hello')
  source=attachments.location(self.data,item['id'])/'content'
  source.write_bytes(b'\x00'*(attachments.MAX_FILE+1))
  def unexpected(_):self.fail('Invalid attachment must not open the save dialog')
  for key in (item['id'],'../notes','0'*32):
   with self.assertRaises(ValueError):attachments.save_copy(self.data,key,unexpected)
  source.unlink()
  with self.assertRaises(ValueError):attachments.save_copy(self.data,item['id'],unexpected)
 def test_pdf(self):
  sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'vendor_python'))
  from pypdf import PdfWriter
  from pypdf.generic import DecodedStreamObject,NameObject,DictionaryObject
  writer=PdfWriter();page=writer.add_blank_page(width=200,height=200);font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')});page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})});stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 10 100 Td (PDF attachment) Tj ET');page[NameObject('/Contents')]=writer._add_object(stream);out=io.BytesIO();writer.write(out)
  item=self.upload('test.pdf',out.getvalue());self.assertIn('PDF attachment',attachments.assemble(self.data,'x',[item['id']]))
