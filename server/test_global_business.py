"""Global register contracts. Run with GLOBAL_BUSINESS_TEST_PG for real PG storage."""
import json,os,sqlite3,tempfile,unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI,Header,HTTPException
from fastapi.testclient import TestClient
import global_business as business

class GlobalBusinessTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'))
        self.path=Path(self.temp.name)/'business.sqlite'
        if os.getenv('GLOBAL_BUSINESS_TEST_PG'):
            import psycopg
            from database import PostgresConnection
            self.schema='gb_test_'+__import__('uuid').uuid4().hex
            with psycopg.connect(os.environ['GLOBAL_BUSINESS_TEST_PG']) as c:c.execute('CREATE SCHEMA '+self.schema)
            @contextmanager
            def store():
                with psycopg.connect(os.environ['GLOBAL_BUSINESS_TEST_PG']) as c:
                    c.execute('SET search_path TO '+self.schema)
                    yield PostgresConnection(c)
        else:
            @contextmanager
            def store():
                c=sqlite3.connect(self.path);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON')
                try:yield c;c.commit()
                except BaseException:c.rollback();raise
                finally:c.close()
        self.store=store
        self.admin=patch('global_business.is_admin',side_effect=lambda a:a=='pm');self.admin.start()
        self.role=patch('global_business.role_of',side_effect=lambda a:'sales' if a=='sales' else 'dev');self.role.start()
        self.app=FastAPI()
        def actor(authorization:str=Header(default='')):
            if not authorization:raise HTTPException(401,'请登录')
            return authorization
        business.install(self.app,actor,store);self.client=TestClient(self.app);self.headers={'Authorization':'pm'}
    def tearDown(self):
        self.admin.stop();self.role.stop()
        if hasattr(self,'schema'):
            import psycopg
            with psycopg.connect(os.environ['GLOBAL_BUSINESS_TEST_PG']) as c:c.execute('DROP SCHEMA '+self.schema+' CASCADE')
        self.temp.cleanup()
    def save(self,kind,fields,**extra):return self.client.post('/api/global-business/'+kind+'/batch',headers=self.headers,json={'rows':[{'fields':fields,**extra}]})
    def load(self):return self.client.get('/api/global-business',headers=self.headers).json()
    def test_project_roundtrip_and_revision_conflict(self):
        row=self.save('projects',{'name':'测试','country':'泰国','amount':0,'products':{'BMS':'CET'}}).json()['rows'][0]
        self.assertEqual(self.load()['projects'][0]['products'],{'BMS':'CET'})
        self.assertEqual(float(row['amount']),0)
        self.assertEqual(self.save('projects',{'name':'已更新'},id=row['id'],revision=1).status_code,200)
        self.assertEqual(self.save('projects',{'name':'过期覆盖'},id=row['id'],revision=1).status_code,409)
        self.assertEqual(self.load()['projects'][0]['name'],'已更新')
    def test_batch_conflict_rolls_back_earlier_insert(self):
        row=self.save('projects',{'name':'保留'}).json()['rows'][0]
        result=self.client.post('/api/global-business/projects/batch',headers=self.headers,json={'rows':[{'fields':{'name':'不应留下'}},{'id':row['id'],'revision':99,'fields':{'name':'冲突'}}]})
        self.assertEqual(result.status_code,409);self.assertEqual(len(self.load()['projects']),1)
    def test_validation_and_read_write_permissions(self):
        self.assertEqual(self.client.get('/api/global-business').status_code,401)
        self.assertEqual(self.client.post('/api/global-business/projects/batch',headers={'Authorization':'dev'},json={'rows':[{'fields':{'name':'拒绝'}}]}).status_code,403)
        for data in [{'name':' '},{'name':'x','progress':101},{'name':'x','amount':-1},{'name':'x','due_date':'wrong'},{'name':'x','stage':'虚构'}]:self.assertEqual(self.save('projects',data).status_code,422)
        self.assertFalse(self.client.get('/api/global-business',headers={'Authorization':'dev'}).json()['can_edit'])
    def test_convert_lead_once_and_archive(self):
        lead=self.save('leads',{'name':'询价线索','country':'马来西亚','amount':1200}).json()['rows'][0]
        endpoint='/api/global-business/leads/'+lead['id']+'/convert'
        first=self.client.post(endpoint,headers=self.headers,json={'revision':1});second=self.client.post(endpoint,headers=self.headers,json={'revision':1})
        self.assertEqual(first.status_code,200);self.assertEqual(first.json(),second.json());self.assertEqual(len(self.load()['projects']),1)
        self.assertEqual(self.load()['leads'][0]['stage'],'已转项目')
        project=self.load()['projects'][0]
        self.assertEqual(self.client.post('/api/global-business/projects/'+project['id']+'/archive',headers=self.headers,json={'revision':project['revision']}).status_code,200)
        self.assertEqual(self.load()['projects'],[])
    def test_product_model_only_uses_confirmed_sources(self):
        self.save('knowledge',{'product':'iMeter 7A','title':'待核对','content':'不应发送','status':'待核对'})
        empty=self.client.post('/api/global-business/imeter/ask',headers=self.headers,json={'question':'有哪些认证'})
        self.assertEqual(empty.json()['sources'],[])
        self.save('knowledge',{'product':'iMeter 7A','title':'认证依据','content':'测试证据，不作真实认证','source':'测试原件','version':'V2','kind':'认证报告','status':'已确认'})
        with patch('global_business.request_chat',return_value='按V2资料答复') as model:
            reply=self.client.post('/api/global-business/imeter/ask',headers=self.headers,json={'question':'有哪些认证','product':'iMeter 7A'})
            self.assertEqual(reply.status_code,200);self.assertEqual(reply.json()['sources'][0]['version'],'V2')
            messages=model.call_args.args[0];self.assertNotIn('不应发送',json.dumps(messages,ensure_ascii=False))
        with patch('global_business.request_chat',side_effect=business.ModelError('failure')):
            self.assertEqual(self.client.post('/api/global-business/imeter/ask',headers=self.headers,json={'question':'认证'}).status_code,502)

    def test_country_resources_persist_validate_and_conflict(self):
        row=self.save('operations',{'country':'泰国','category':'logistics','name':'测试物流伙伴','contact':'测试联系人','coverage':'曼谷','status':'可合作'}).json()['rows'][0]
        self.assertEqual(self.load()['operations'][0]['coverage'],'曼谷')
        self.assertEqual(self.save('operations',{'country':'泰国','category':'unknown','name':'非法类型'}).status_code,422)
        self.assertEqual(self.save('operations',{'country':'泰国','category':'logistics','name':'已更新'},id=row['id'],revision=1).status_code,200)
        self.assertEqual(self.save('operations',{'country':'泰国','category':'logistics','name':'旧覆盖'},id=row['id'],revision=1).status_code,409)
        self.assertEqual(self.client.post('/api/global-business/operations/batch',headers={'Authorization':'dev'},json={'rows':[{'fields':{'country':'泰国','category':'offices','name':'拒绝'}}]}).status_code,403)

    def test_unverified_product_sources_require_explicit_trial_option(self):
        self.save('knowledge',{'product':'iMeter 5','title':'演示认证','content':'待核对演示内容','status':'待核对'})
        with patch('global_business.request_chat',return_value='根据待核对演示资料，仅供试用') as model:
            normal=self.client.post('/api/global-business/imeter/ask',headers=self.headers,json={'question':'认证'})
            self.assertEqual(normal.json()['sources'],[]);model.assert_not_called()
            trial=self.client.post('/api/global-business/imeter/ask',headers=self.headers,json={'question':'认证','product':'iMeter 5','include_unverified':True})
            self.assertEqual(trial.status_code,200);self.assertEqual(trial.json()['sources'][0]['status'],'待核对')
            self.assertIn('不得将其描述为已经认证的事实',model.call_args.args[0][0]['content'])

    def test_product_question_prioritizes_the_requested_evidence_kind(self):
        self.save('knowledge',{'product':'iMeter 7A','title':'UL 安全依据','kind':'认证报告','content':'UL 61010 演示证据','status':'已确认'})
        for i in range(14):self.save('knowledge',{'product':'iMeter 7A','title':'其他参数 '+str(i),'kind':'竞品对比','content':'非认证的其他参数','status':'已确认'})
        with patch('global_business.request_chat',return_value='认证依据'):
            response=self.client.post('/api/global-business/imeter/ask',headers=self.headers,json={'question':'iMeter 7A有哪些认证','product':'iMeter 7A'})
            self.assertEqual(response.json()['sources'][0]['title'],'UL 安全依据')

    def test_archived_records_can_be_restored_without_losing_fields(self):
        row=self.save('operations',{'country':'马来西亚','category':'offices','name':'演示办公室','location':'吉隆坡'}).json()['rows'][0]
        self.client.post('/api/global-business/operations/'+row['id']+'/archive',headers=self.headers,json={'revision':1})
        records=self.client.get('/api/global-business/archives',headers=self.headers).json()['operations'];self.assertEqual(records[0]['location'],'吉隆坡');self.assertEqual(self.load()['operations'],[])
        endpoint='/api/global-business/operations/'+row['id']+'/restore'
        self.assertEqual(self.client.post(endpoint,headers=self.headers,json={'revision':2}).status_code,200)
        self.assertEqual(self.load()['operations'][0]['location'],'吉隆坡')
        self.assertEqual(self.client.post(endpoint,headers=self.headers,json={'revision':2}).status_code,409)
        self.assertEqual(self.client.get('/api/global-business/archives',headers={'Authorization':'dev'}).status_code,403)
