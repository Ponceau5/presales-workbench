"""Bounded source-image extraction and multimodal attachment snapshots."""
import base64,io,zipfile
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import Response
from PIL import Image,UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from object_storage import materialize
IMAGE_EXTENSIONS={'.png','.jpg','.jpeg','.webp','.gif','.bmp','.tif','.tiff','.ico'}
def image_png(raw):
 with Image.open(io.BytesIO(raw)) as image:
  if image.width*image.height>40_000_000:raise HTTPException(413,'图片尺寸过大，请缩小后上传')
  image.seek(0);image.thumbnail((1600,1600));rgba=image.convert('RGBA');canvas=Image.new('RGB',rgba.size,'white');canvas.paste(rgba,mask=rgba.getchannel('A'));out=io.BytesIO();canvas.save(out,format='PNG');return out.getvalue()
def figures(path):
 """Yield original embedded images; never manufacture a figure from document text."""
 suffix=path.suffix.lower()
 if suffix in IMAGE_EXTENSIONS:yield path.read_bytes(),'原图';return
 if suffix in {'.docx','.xlsx','.pptx'}:
  with zipfile.ZipFile(path) as archive:
   for item in archive.infolist():
    if '/media/' in item.filename and Path(item.filename).suffix.lower() in IMAGE_EXTENSIONS and item.file_size<=10*1024*1024:
     yield archive.read(item),Path(item.filename).name
 elif suffix=='.pdf':
  for number,page in enumerate(PdfReader(str(path)).pages[:50],1):
   for item in page.images:yield item.data,f'第 {number} 页 · {item.name}'
def document_figures(document,limit=4):
 result=[]
 with materialize(document['path']) as path:
  try:
   for index,(raw,label) in enumerate(figures(path),1):
    if index>limit:break
    try:data=image_png(raw)
    except (UnidentifiedImageError,OSError):continue
    except Image.DecompressionBombError:raise HTTPException(413,'图片尺寸过大，请缩小后上传') from None
    result.append({'index':index,'label':document['title']+' · '+str(document.get('version',''))+' · '+label,'data':data,'url':f"/api/documents/{document['id']}/figures/{index}"})
  except (ValueError,zipfile.BadZipFile,OSError,PdfReadError):pass
 return result

def attachment_snapshot(connection,project,identifiers):
 sources=[];blocks=[]
 for identifier in dict.fromkeys(identifiers):
  row=connection.execute('SELECT * FROM documents WHERE id=? AND project_id=?',(identifier,project)).fetchone()
  if not row:raise HTTPException(403,'附件不属于当前项目')
  doc=dict(row);texts=[r[0] for r in connection.execute('SELECT text FROM document_pages WHERE document_id=? ORDER BY page',(identifier,))]
  images=document_figures(doc,limit=2) if len(blocks)<4 else []
  source={'id':identifier,'title':doc['title'],'version':doc['version'],'purpose':'input','text':'\n\n'.join(texts)[:16000],'figures':[{'url':i['url'],'label':i['label']} for i in images],'read_status':'正文已提取' if texts else '图像已提供' if images else '仅原件已保存，当前无法解析正文，不得声称已读'}
  sources.append(source)
  for figure in images[:4-len(blocks)]:blocks.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(figure['data']).decode()}})
 return sources,blocks

def install(app,db,actor):
 from fastapi import Depends
 @app.get('/api/documents/{identifier}/figures/{index}')
 def figure(identifier:str,index:int,user:str=Depends(actor)):
  if index<1 or index>4:raise HTTPException(404,'图片不存在')
  with db() as c:row=c.execute('SELECT * FROM documents WHERE id=?',(identifier,)).fetchone()
  if not row:raise HTTPException(404,'资料不存在')
  import access_control
  access_control.check_project(user,row['project_id'])
  item=next((v for v in document_figures(dict(row)) if v['index']==index),None)
  if not item:raise HTTPException(404,'原件中没有此图片')
  return Response(item['data'],media_type='image/png',headers={'Cache-Control':'private, no-store'})

def source_visuals(connection,project,sources):
 """Attach figures from selected original versions without duplicating their text."""
 blocks=[];seen=set()
 for source in sources:
  identifier=source.get('id')
  if not identifier or identifier in seen or len(blocks)>=4:continue
  seen.add(identifier)
  row=connection.execute('SELECT * FROM documents WHERE id=? AND project_id=?',(identifier,project)).fetchone()
  if not row:continue
  images=document_figures(dict(row),limit=min(2,4-len(blocks)))
  source['figures']=[{'url':i['url'],'label':i['label']} for i in images]
  for figure in images:blocks.append({'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(figure['data']).decode()}})
 return blocks
