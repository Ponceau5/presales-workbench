"""Exercise native SDK/agent cancellation, leases and per-conversation ordering."""
import asyncio, os, sqlite3, subprocess, sys, tempfile, threading, time, unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
import httpx
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.testclient import TestClient
from openai import AsyncOpenAI
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk
import execution_control as control
import model_gateway
import agent_engine


class ExecutionControlTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'))
        self.path=Path(self.temp.name)/'tasks.sqlite'
        @contextmanager
        def db():
            c=sqlite3.connect(self.path,timeout=5,check_same_thread=False);c.row_factory=sqlite3.Row
            try:yield c;c.commit()
            except BaseException:c.rollback();raise
            finally:c.close()
        self.db=db;self.old_db=control._db;self.app=FastAPI()
        async def actor(request:Request):
            user=request.headers.get('x-user','alice')
            await control.bind_request(request,user)
            return user
        control.install(self.app,db,actor);self.client=TestClient(self.app)
        self.actor=actor
        self.config=model_gateway.ModelConfig('deepseek','fixture','https://fixture.invalid/v1','fixture')
    def tearDown(self):
        control._db=self.old_db;self.temp.cleanup()
    def row(self,task):
        with self.db() as c:return dict(c.execute('SELECT * FROM model_tasks WHERE id=?',(task.id,)).fetchone())
    def worker(self,task,function):
        errors=[]
        def run():
            with control.bind(task):
                try:function()
                except BaseException as e:errors.append(e);task.fail(e)
                finally:task.finish()
        t=threading.Thread(target=run);t.start();return t,errors

    def test_start_rolls_back_task_when_attempt_insert_fails(self):
        task=control.Task('alice','A','F1','atomic-start')
        with self.db() as c:
            c.execute("CREATE TRIGGER reject_attempt BEFORE INSERT ON model_task_attempts BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):task.start()
        with self.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM model_tasks WHERE id=?',(task.id,)).fetchone()[0],0)
        self.assertNotIn(task.id,control._active)

    def test_cancel_notifies_model_even_when_status_write_fails(self):
        task=control.Task('alice','A','F1','cancel-db');task.start()
        notified=threading.Event()
        @contextmanager
        def unavailable():
            raise sqlite3.OperationalError('fixture unavailable')
            yield
        try:
            with task.on_cancel(notified.set),patch.object(control,'_db',unavailable):
                with self.assertRaises(sqlite3.OperationalError):task.cancel()
            self.assertTrue(notified.is_set())
        finally:task.finish()

    def test_failed_finish_is_recovered_without_stuck_admission_or_attempt(self):
        old=control.Task('alice','A','F1','recover');old.start()
        @contextmanager
        def unavailable():
            raise sqlite3.OperationalError('fixture unavailable')
            yield
        with patch.object(control,'_db',unavailable):
            with self.assertRaises(sqlite3.OperationalError):old.finish()
        self.assertNotIn(old.id,control._active)
        retry=control.Task('alice','A','F1','recover')
        try:
            retry.start()
            with self.db() as c:
                attempt=c.execute('SELECT status,finished_at FROM model_task_attempts WHERE task_id=?',(old.id,)).fetchone()
            self.assertEqual(attempt['status'],'interrupted')
            self.assertIsNotNone(attempt['finished_at'])
            self.assertEqual(self.row(old)['admitted'],0)
        finally:retry.finish()

    def test_startup_reconciles_unfinished_attempts_of_finished_tasks(self):
        task=control.Task('alice','A','F1','old-version');task.start();task.finish()
        with self.db() as c:
            c.execute("UPDATE model_task_attempts SET finished_at=NULL,status='running' WHERE task_id=?",(task.id,))
        control.install(FastAPI(),self.db,self.actor)
        with self.db() as c:
            row=c.execute('SELECT status,finished_at FROM model_task_attempts WHERE task_id=?',(task.id,)).fetchone()
        self.assertEqual(row['status'],'completed');self.assertIsNotNone(row['finished_at'])

    def process_worker(self):
        # An independent OS process shares only the SQLite task ledger.
        program = """
import asyncio,sqlite3,sys
from contextlib import contextmanager
from fastapi import FastAPI
import execution_control as control
@contextmanager
def db():
    c=sqlite3.connect(sys.argv[1],timeout=5);c.row_factory=sqlite3.Row
    try:yield c;c.commit()
    except BaseException:c.rollback();raise
    finally:c.close()
control.install(FastAPI(),db,lambda: 'alice')
task=control.Task('alice','A','F1','cross-process','child-task')
async def source():
    try:
        print('ready',flush=True)
        await asyncio.Future()
        yield 'unexpected'
    finally:print('model-closed',flush=True)
with control.bind(task):
    try:
        with control.model_slot():list(control.sync_stream(source()))
    except control.ExecutionCancelled:pass
    finally:task.finish()
print('finished',flush=True)
"""
        process=subprocess.Popen([sys.executable,'-u','-c',program,str(self.path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=Path(__file__).parent)
        # Bounded readiness wait; no hanging read if the child fails to start.
        import select
        ready,_,_=select.select([process.stdout],[],[],5)
        if not ready:
            process.kill();out,err=process.communicate();self.fail('worker did not start: '+err)
        self.assertEqual(process.stdout.readline().strip(),'ready')
        return process

    def test_cancel_reaches_stream_owned_by_another_process(self):
        process=self.process_worker()
        try:
            response=self.client.post('/api/model-tasks/child-task/cancel',headers={'x-user':'alice'})
            self.assertEqual(response.status_code,200,response.text)
            out,err=process.communicate(timeout=5)
            self.assertEqual(process.returncode,0,err)
            self.assertIn('model-closed',out);self.assertIn('finished',out)
            with self.db() as c:
                row=c.execute("SELECT status,admitted FROM model_tasks WHERE id='child-task'").fetchone()
            self.assertEqual(tuple(row),('cancelled',0))
        finally:
            if process.poll() is None:process.kill();process.communicate()

    def test_worker_crash_is_recovered_before_same_conversation_retries(self):
        process=self.process_worker()
        process.kill();process.communicate(timeout=5)
        retry=control.Task('alice','A','F1','cross-process','retry-task')
        try:
            retry.start()
            with self.db() as c:
                row=c.execute("SELECT status,admitted FROM model_tasks WHERE id='child-task'").fetchone()
                attempt=c.execute("SELECT status,finished_at FROM model_task_attempts WHERE task_id='child-task'").fetchone()
            self.assertEqual(tuple(row),('interrupted',0))
            self.assertEqual(attempt['status'],'interrupted');self.assertIsNotNone(attempt['finished_at'])
        finally:retry.finish()

    def sdk_cancel(self,stream):
        entered,exited=threading.Event(),threading.Event()
        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                entered.set()
                try:await asyncio.Future();yield b''
                finally:exited.set()
            async def aclose(self):exited.set()
        async def transport(request):
            if stream:return httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Body())
            entered.set()
            try:await asyncio.Future()
            finally:exited.set()
        def sdk(**kwargs):return AsyncOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)))
        task=control.Task('alice','A','F1','chat')
        with patch.object(model_gateway,'AsyncOpenAI',side_effect=sdk):
            call=lambda:list(model_gateway._request_chat_stream([],config=self.config)) if stream else model_gateway.request_chat([],10,config=self.config)
            thread,errors=self.worker(task,call)
            try:
                self.assertTrue(entered.wait(2));task.cancel();thread.join(2)
                self.assertFalse(thread.is_alive());self.assertTrue(exited.is_set())
                self.assertIsInstance(errors[0],control.ExecutionCancelled)
                self.assertEqual((self.row(task)['status'],self.row(task)['admitted'],self.row(task)['failed_phase']),('cancelled',0,'model_wait'))
            finally:task.cancel();thread.join(2)
    def test_native_sdk_stream_cancel_closes_body(self):self.sdk_cancel(True)
    def test_native_sdk_nonstream_cancel_before_headers(self):self.sdk_cancel(False)

    def test_native_langchain_agent_cancel_reaches_model(self):
        entered,exited=threading.Event(),threading.Event()
        class Model(BaseChatModel):
            @property
            def _llm_type(self):return 'fixture'
            def bind_tools(self,tools,**kwargs):return self
            def _generate(self,*args,**kwargs):raise AssertionError('must use async')
            async def _astream(self,*args,**kwargs):
                entered.set()
                try:await asyncio.Future();yield ChatGenerationChunk(message=AIMessageChunk(content='never'))
                finally:exited.set()
        task=control.Task('alice','A','F1','chat')
        def call():
            with control.model_slot():list(agent_engine.stream_agent(Model(),[],'test','test',[]))
        thread,errors=self.worker(task,call)
        try:
            self.assertTrue(entered.wait(2));task.cancel();thread.join(2)
            self.assertFalse(thread.is_alive());self.assertTrue(exited.is_set())
            self.assertIsInstance(errors[0],control.ExecutionCancelled)
        finally:task.cancel();thread.join(2)

    def test_tool_retains_admission_and_retry_lock_until_actual_exit(self):
        entered,release,exited=threading.Event(),threading.Event(),threading.Event()
        task=control.Task('alice','A','F1','same-chat',identifier='same-task')
        def tool():
            entered.set()
            try:release.wait(3)
            finally:exited.set()
        def call():
            with control.model_slot():agent_engine.bounded_tool(tool)()
        thread,errors=self.worker(task,call)
        try:
            self.assertTrue(entered.wait(2));task.cancel();time.sleep(.08)
            self.assertTrue(thread.is_alive());self.assertEqual(self.row(task)['admitted'],1)
            self.assertEqual(self.row(task)['status'],'cancelling')
            for identifier in ('new-turn','same-task'):
                with self.assertRaises(HTTPException):control.Task('alice','A','F1','same-chat',identifier).start()
            release.set();thread.join(2)
            self.assertTrue(exited.is_set());self.assertFalse(thread.is_alive())
            self.assertEqual((self.row(task)['admitted'],self.row(task)['status']),(0,'cancelled'))
            retry=control.Task('alice','A','F1','same-chat',identifier='same-task');retry.start();retry.finish()
            with self.db() as c:self.assertEqual(c.execute('SELECT count(*) FROM model_task_attempts WHERE task_id=?',('same-task',)).fetchone()[0],2)
        finally:release.set();thread.join(3)

    def test_cooperative_tool_stops_at_checkpoint(self):
        entered,exited=threading.Event(),threading.Event();task=control.Task('alice','A','F1','chat')
        def tool():
            entered.set()
            try:
                while True:control.checkpoint();task.cancelled.wait(.005)
            finally:exited.set()
        def call():
            with control.model_slot():agent_engine.bounded_tool(tool)()
        thread,errors=self.worker(task,call)
        try:
            self.assertTrue(entered.wait(2));task.cancel();thread.join(2)
            self.assertTrue(exited.is_set());self.assertFalse(thread.is_alive())
            self.assertEqual(self.row(task)['failed_phase'],'tool:tool')
        finally:task.cancel();thread.join(2)

    def test_projects_parallel_and_cancellation_owner_is_checked(self):
        tasks=[control.Task('alice','A','F1','chat','task-A'),control.Task('alice','B','F1','chat','task-B'),control.Task('bob','A','F1','chat','task-C')]
        try:
            for t in tasks:t.start()
            self.assertEqual(self.client.post('/api/model-tasks/task-A/cancel',headers={'x-user':'bob'}).status_code,404)
            self.assertFalse(tasks[0].cancelled.is_set())
            self.assertEqual(self.client.post('/api/model-tasks/task-A/cancel',headers={'x-user':'alice'}).status_code,200)
            self.assertTrue(tasks[0].cancelled.is_set())
            self.assertFalse(tasks[1].cancelled.is_set());self.assertFalse(tasks[2].cancelled.is_set())
        finally:
            for t in tasks:t.finish()

    def test_identity_and_failed_phase_are_persisted_for_skill_entry(self):
        @self.app.post('/api/projects/{project}/workspaces/{stage}/flows/skill')
        def fail(project:str,stage:str,user=Depends(self.actor)):
            with control.model_slot():
                control.current().set_phase('model_parse')
                error=model_gateway.ModelError('模型未返回可解析的结构化结果');control.current().fail(error)
                raise HTTPException(422,str(error))
        response=self.client.post('/api/projects/A/workspaces/F1/flows/skill',json={'conversation_id':'chat','turn_id':'turn'})
        self.assertEqual(response.status_code,422)
        with self.db() as c:r=c.execute('SELECT * FROM model_tasks').fetchone()
        self.assertEqual((r['actor'],r['project'],r['stage'],r['conversation']),('alice','A','F1','chat'))
        self.assertEqual((r['status'],r['failed_phase']),('failed','model_parse'))
        self.assertEqual(r['entry'],'/api/projects/A/workspaces/F1/flows/skill')

    def http_disconnect(self, streaming):
        import json
        from fastapi.responses import StreamingResponse
        from streaming import heartbeat_stream,event
        entered,exited=threading.Event(),threading.Event()
        async def transport(request):
            entered.set()
            try:await asyncio.Future()
            finally:exited.set()
        def sdk(**kwargs):return AsyncOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)))
        path='/api/projects/A/workspaces/F1/ask-stream' if streaming else '/api/projects/A/workspaces/F1/flows/skill'
        def endpoint(user=Depends(self.actor)):
            if streaming:
                def produce():
                    try:
                        for value in model_gateway._request_chat_stream([],config=self.config):yield event('delta',text=value)
                    except model_gateway.ModelError as error:yield event('error',message=str(error))
                return StreamingResponse(heartbeat_stream(produce(),interval=.01),media_type='text/event-stream')
            try:return {'text':model_gateway.request_chat([],10,config=self.config)}
            except model_gateway.ModelError as error:raise HTTPException(502,str(error))
        self.app.post(path)(endpoint)
        async def exercise():
            incoming=asyncio.Queue();await incoming.put({'type':'http.request','body':json.dumps({'conversation_id':'http-chat'}).encode(),'more_body':False})
            sent=[]
            async def send(message):sent.append(message)
            scope={'type':'http','asgi':{'version':'3.0','spec_version':'2.4'},'http_version':'1.1','method':'POST','scheme':'http','path':path,'raw_path':path.encode(),'query_string':b'','root_path':'','headers':[(b'content-type',b'application/json')],'client':('127.0.0.1',1),'server':('test',80)}
            app_task=asyncio.create_task(self.app(scope,incoming.get,send))
            self.assertTrue(await asyncio.to_thread(entered.wait,2))
            await incoming.put({'type':'http.disconnect'})
            await asyncio.wait_for(app_task,2)
            self.assertTrue(await asyncio.to_thread(exited.wait,1))
            with self.db() as c:r=c.execute('SELECT * FROM model_tasks').fetchone()
            self.assertEqual((r['status'],r['admitted']),('cancelled',0))
            self.assertEqual(r['failed_phase'],'model_wait')
        with patch.object(model_gateway,'AsyncOpenAI',side_effect=sdk):asyncio.run(exercise())

    def test_json_disconnect_cancels_sdk_before_response(self):self.http_disconnect(False)
    def test_sse_disconnect_cancels_sdk(self):self.http_disconnect(True)

    def test_cancel_after_agent_has_already_emitted_text(self):
        first,exited=threading.Event(),threading.Event()
        class Model(BaseChatModel):
            @property
            def _llm_type(self):return 'midstream-fixture'
            def bind_tools(self,tools,**kwargs):return self
            def _generate(self,*args,**kwargs):raise AssertionError('must use async')
            async def _astream(self,*args,**kwargs):
                try:
                    yield ChatGenerationChunk(message=AIMessageChunk(content='first chunk'))
                    await asyncio.Future()
                finally:exited.set()
        task=control.Task('alice','A','F1','chat')
        def call():
            with control.model_slot():
                for item in agent_engine.stream_agent(Model(),[],'test','test',[]):
                    if item['type']=='delta':first.set()
        thread,errors=self.worker(task,call)
        try:
            self.assertTrue(first.wait(2));task.cancel();thread.join(2)
            self.assertFalse(thread.is_alive());self.assertTrue(exited.is_set())
            self.assertEqual((self.row(task)['status'],self.row(task)['admitted']),('cancelled',0))
        finally:task.cancel();thread.join(2)

    def test_async_generator_keeps_one_task_across_all_chunks(self):
        async def source():
            owner=asyncio.current_task()
            for i in range(5):
                await asyncio.sleep(.001)
                self.assertIs(asyncio.current_task(),owner)
                yield i
        self.assertEqual(list(control.sync_stream(source())),list(range(5)))

    def test_cancel_does_not_interrupt_database_cleanup_statements(self):
        # Use the actual app database context, including its interruption hook.
        with patch.dict(os.environ,{'PRESALES_DATA_DIR':str(Path(self.temp.name)/'app')}):
            import app as application
        control._db=application.db
        task=control.Task('alice','A','F1','chat')
        try:
            with control.bind(task):
                task.start();task.cancel()
                with application.db() as c:
                    total=c.execute('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) SELECT sum(x) FROM n').fetchone()[0]
                    self.assertEqual(total,50005000)
                task.finish()
            with application.db() as c:r=c.execute('SELECT status,admitted FROM model_tasks WHERE id=?',(task.id,)).fetchone()
            self.assertEqual(tuple(r),('cancelled',0))
        finally:
            control._db=self.db

    def test_agent_http_clients_are_not_shared_across_task_lifetimes(self):
        first=agent_engine.chat_model(self.config)
        second=agent_engine.chat_model(self.config)
        try:
            self.assertIsNot(first.http_async_client,second.http_async_client)
            self.assertIsNot(first.http_client,second.http_client)
            asyncio.run(first.root_async_client.close());first.root_client.close()
            self.assertFalse(second.http_async_client.is_closed)
            self.assertFalse(second.http_client.is_closed)
        finally:
            if not first.http_async_client.is_closed:asyncio.run(first.root_async_client.close())
            first.root_client.close()
            asyncio.run(second.root_async_client.close());second.root_client.close()

    def test_background_preparation_failure_keeps_identity_and_failure_stage(self):
        parent=control.Task('alice','A','DOCUMENT','upload')
        seen=[]
        def prepare():
            child=control.current();seen.append(child)
            child.set_phase('prepare_file')
            raise ValueError('synthetic preparation failure')
        with control.bind(parent):job=control.background(prepare)
        parent.cancel()
        with self.assertRaises(ValueError):job()
        child=seen[0]
        self.assertNotEqual(child.id,parent.id)
        self.assertFalse(child.cancelled.is_set())
        self.assertEqual((self.row(child)['actor'],self.row(child)['project']),('alice','A'))
        self.assertEqual((self.row(child)['status'],self.row(child)['failed_phase']),('failed','prepare_file'))
