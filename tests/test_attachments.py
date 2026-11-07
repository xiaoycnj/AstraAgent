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
 def test_pdf(self):
  sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'vendor_python'))
  from pypdf import PdfWriter
  from pypdf.generic import DecodedStreamObject,NameObject,DictionaryObject
  writer=PdfWriter();page=writer.add_blank_page(width=200,height=200);font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')});page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})});stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 10 100 Td (PDF attachment) Tj ET');page[NameObject('/Contents')]=writer._add_object(stream);out=io.BytesIO();writer.write(out)
  item=self.upload('test.pdf',out.getvalue());self.assertIn('PDF attachment',attachments.assemble(self.data,'x',[item['id']]))
