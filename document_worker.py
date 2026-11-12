"""CPU document OCR worker. Input remains local, one disposable process per document."""
import json
from contextlib import closing
import math
from pathlib import Path
import sys

MAX_PIXELS=16_000_000

def recognize(path,name):
    from PIL import Image,ImageOps
    from rapidocr import RapidOCR
    import numpy as np
    Image.MAX_IMAGE_PIXELS=MAX_PIXELS
    engine=RapidOCR(params={'Global.log_level':'error','EngineConfig.onnxruntime.intra_op_num_threads':2,'EngineConfig.onnxruntime.inter_op_num_threads':1})
    pages=[]
    def page_result(image,number):
        if image.width*image.height>MAX_PIXELS:raise ValueError('图片像素过大，请缩小后重试')
        image=ImageOps.exif_transpose(image).convert('RGB')
        output=engine(np.array(image))
        lines=[]
        if output.txts:
            for box,text,score in zip(output.boxes,output.txts,output.scores):
                lines.append({'text':str(text),'confidence':float(score),'box':[[round(float(x),2),round(float(y),2)] for x,y in box]})
        pages.append({'number':number,'width':image.width,'height':image.height,'lines':lines})
    if Path(name).suffix.lower()=='.pdf':
        import pypdfium2 as pdfium
        with closing(pdfium.PdfDocument(str(path))) as document:
            if len(document)>20:raise ValueError('PDF 最多 20 页')
            for index in range(len(document)):
                with closing(document[index]) as page:
                    width,height=page.get_size()
                    if not all(math.isfinite(n) and n>0 for n in (width,height)):raise ValueError('PDF 页面尺寸无效')
                    scale=min(2.0,math.sqrt(MAX_PIXELS/(width*height)))
                    with closing(page.render(scale=scale)) as bitmap:
                        image=bitmap.to_pil().copy()
                    try:page_result(image,index+1)
                    finally:image.close()
    else:
        with Image.open(path) as image:page_result(image,1)
    text='\n\n'.join('【第 '+str(page['number'])+' 页】\n'+'\n'.join(line['text'] for line in page['lines']) for page in pages)
    if len(text)>60000:raise ValueError('识别文本超过 60000 字符，请拆分文档')
    return {'text':text,'pages':pages}

if __name__=='__main__':
    output=Path(sys.argv[3])
    sys.stdout=sys.stderr
    try:
        import socket
        def offline(*args,**kwargs):raise OSError('文档 DLC 离线运行，缺少的模型请重新安装完整包')
        socket.socket.connect=offline
        socket.socket.connect_ex=offline
        import attachments
        parser_job=attachments.parser_limits(2048,160)
        result=recognize(Path(sys.argv[1]),sys.argv[2])
    except Exception as error:result={'error':str(error)[:300]}
    output.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
