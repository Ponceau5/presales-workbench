"""One multipart batch submission with independently committed file outcomes."""
import asyncio,json
from fastapi import Depends,File,Form,HTTPException,UploadFile
from pydantic import BaseModel,Field,ValidationError

TYPES={'项目档案','规格与要求','图纸','点表与配置','澄清记录','成果工件','工件模板'}
class Metadata(BaseModel):
 title:str=Field(min_length=1,max_length=240)
 version:str=Field(default='V0',min_length=1,max_length=80)
 business_type:str='项目档案'
 description:str=Field(default='',max_length=2000)

def install(app,db,actor):
 with db() as c:c.execute("CREATE TABLE IF NOT EXISTS document_annotations(document_id TEXT PRIMARY KEY,description TEXT NOT NULL)")
 @app.post('/api/projects/{project_id}/documents/batch')
 async def import_batch(project_id:str,metadata:str=Form(...),files:list[UploadFile]=File(...),account:str=Depends(actor)):
  from app import upload_document
  from access_control import check_project,check_owner,role_of
  check_project(account,project_id);check_owner(account,project_id,role_of(account))
  try:items=json.loads(metadata)
  except (ValueError,TypeError):raise HTTPException(422,'导入信息格式错误') from None
  if not isinstance(items,list) or len(items)!=len(files):raise HTTPException(422,'文件与导入信息数量不一致')
  slots=asyncio.Semaphore(3)
  async def one(file,raw):
   try:
    item=Metadata.model_validate(raw)
    if not item.title.strip() or not item.version.strip() or item.business_type not in TYPES:raise HTTPException(422,'请填写名称、版本并选择类型')
    async with slots:
     def save():return asyncio.run(upload_document(project_id,item.title.strip(),item.version.strip(),file,account,item.business_type))
     result=await asyncio.to_thread(save)
     with db() as c:c.execute('INSERT OR REPLACE INTO document_annotations VALUES (?,?)',(result['id'],item.description.strip()))
    return {'success':True,**result,'title':item.title.strip(),'business_type':item.business_type,'description':item.description.strip()}
   except ValidationError:return {'success':False,'error':'名称、版本或说明不符合要求'}
   except HTTPException as error:return {'success':False,'error':str(error.detail)}
   except Exception:return {'success':False,'error':'导入失败，请重试'}
  results=await asyncio.gather(*(one(file,item) for file,item in zip(files,items)))
  return {'results':results,'succeeded':sum(row['success'] for row in results),'failed':sum(not row['success'] for row in results)}
