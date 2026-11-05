"""Request identity, cancellation and admission shared by existing model entry points.

LangChain still executes agents; this module owns application task lifetimes only.
"""
import asyncio
import contextvars
import os
import re
import threading
import time
from contextlib import contextmanager, nullcontext
from uuid import uuid4
from fastapi import HTTPException


class ExecutionError(Exception):
    pass


class ModelPrompt(ExecutionError):
    """Expected input or workflow guidance displayed in the conversation."""


class ExecutionCancelled(ExecutionError):
    pass


_current = contextvars.ContextVar('model_task', default=None)
_db = None
_active = {}
_lock = threading.RLock()
_slots = threading.BoundedSemaphore(max(1, min(40, int(os.getenv('PRESALES_AGENT_CONCURRENCY', '20')))))


def current():
    return _current.get()


def checkpoint():
    if current():
        current().check()


def cancellation_message(reason):
    return {'deadline':'任务超过执行时限，已停止','agent_deadline':'本次生成超过3分钟，已停止。','stream_deadline':'本次处理超过5分钟，已停止。','tool_timeout':'读取资料或计算超过30秒，已停止本次任务。','connection_closed':'连接已断开，本次生成已停止。','conversation_ended':'已打开新对话，旧对话已结束。','idle_timeout':'连接超过100秒没有返回消息，已停止本次生成。','browser_deadline':'本次处理超过5分30秒，已停止。'}.get(reason,'本次任务已停止')


def live_tasks(connection):
    """Reconcile dead workers at startup and before admitting another request."""
    rows=connection.execute("SELECT id,actor,project,stage,conversation,owner FROM model_tasks WHERE status IN ('running','cancelling')").fetchall()
    live=[]
    for row in rows:
        try:
            if row['owner']==os.getpid() and row['id'] not in _active:
                raise ProcessLookupError
            os.kill(row['owner'],0)
        except ProcessLookupError:
            connection.execute("UPDATE model_tasks SET status='interrupted',error='服务进程已结束',failed_phase=phase,admitted=0,updated_at=? WHERE id=?",(time.time(),row['id']))
            connection.execute("UPDATE model_task_attempts SET status='interrupted',finished_at=?,failed_phase=(SELECT phase FROM model_tasks WHERE id=?),error='服务进程已结束' WHERE task_id=? AND finished_at IS NULL",(time.time(),row['id'],row['id']))
        else:live.append(row)
    return live


class Task:
    def __init__(self, actor='', project='', stage='', conversation='', identifier=None, entry=''):
        self.id = identifier or uuid4().hex
        self.actor, self.project, self.stage = str(actor), project, stage
        self.conversation, self.entry = conversation, entry
        self.cancelled = threading.Event()
        self.reason = ''
        self.phase, self.failed_phase, self.error = 'prepare', '', ''
        self.started = False
        self.finished = False
        self.started_at = time.time()
        self.callbacks, self.children = set(), set()
        self.lock = threading.RLock()
        self.depth = 0
        self.last_poll = 0

    def start(self):
        if self.started:
            self.check()
            return
        with _lock:
            if self.id in _active:
                raise HTTPException(409, '此任务尚未结束，请稍后重试')
            if _db:
                with _db() as c:
                    c.execute('BEGIN IMMEDIATE')
                    for r in live_tasks(c):
                        if r['actor'] == self.actor and r['project'] == self.project and r['stage'] == self.stage and (r['id'] == self.id or self.conversation and r['conversation'] == self.conversation):
                            raise HTTPException(409, '此对话的上一任务尚未结束，请停止或等待后再试')
                    c.execute('INSERT INTO model_tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,phase=excluded.phase,failed_phase=\'\',error=\'\',cancel_requested=0,admitted=0,owner=excluded.owner,updated_at=excluded.updated_at',
                              (self.id, self.actor, self.project, self.stage, self.conversation, self.entry, 'running', self.phase, '', '', 0, 0, os.getpid(), time.time(), time.time(), 0.0))
                    c.execute('INSERT INTO model_task_attempts VALUES (?,?,?,?,?,?,?)',(self.id,self.started_at,None,'running','','',self.entry))
            _active[self.id] = self
            self.started = True
        self.check()

    def set_phase(self, phase):
        if self.phase == phase:
            return
        self.phase = phase
        if self.started and _db:
            with _db() as c:
                c.execute('UPDATE model_tasks SET phase=?,updated_at=? WHERE id=?', (phase, time.time(), self.id))

    def cancel_message(self):
        return cancellation_message(self.reason)

    def cancel(self, reason='cancelled'):
        with self.lock:
            if self.finished or self.cancelled.is_set():
                return
            if not self.cancelled.is_set():
                self.reason = reason
                self.failed_phase = self.phase
            if not self.error:self.error=self.cancel_message()
            self.cancelled.set()
            callbacks = list(self.callbacks)
        # Notify the actual work even if saving the cancellation fails.
        try:
            if self.started and _db:
                with _db() as c:
                    c.execute("UPDATE model_tasks SET status='cancelling',cancel_requested=1,failed_phase=?,error=?,updated_at=? WHERE id=?", (self.failed_phase, self.error, time.time(), self.id))
        finally:
            for callback in callbacks:
                try:
                    callback()
                except RuntimeError:
                    pass  # The async loop may have completed concurrently.

    def check(self):
        if self.cancelled.is_set():
            raise ExecutionCancelled(self.error or self.cancel_message())
        if self.started and _db and time.monotonic() - self.last_poll > .1:
            self.last_poll = time.monotonic()
            with _db() as c:
                r = c.execute('SELECT cancel_requested,error FROM model_tasks WHERE id=?', (self.id,)).fetchone()
            if r and r[0] and not self.cancelled.is_set():
                self.error=r['error'] or self.error
                self.cancel()
        if self.cancelled.is_set():
            raise ExecutionCancelled(self.error or self.cancel_message())

    @contextmanager
    def on_cancel(self, callback):
        with self.lock:
            self.callbacks.add(callback)
            cancelled = self.cancelled.is_set()
        if cancelled:
            callback()
        try:
            yield
        finally:
            with self.lock:
                self.callbacks.discard(callback)

    def fail(self, error):
        if self.cancelled.is_set() and self.error:
            return
        if not self.failed_phase:
            self.failed_phase = self.phase
        # Only application-authored errors are persisted; never raw provider bodies.
        self.error = str(error)[:500] if isinstance(error, ExecutionError) else type(error).__name__

    def drain(self):
        while True:
            with self.lock:
                children = list(self.children)
            if not children:
                return
            for child in children:
                try:
                    child.result()
                except BaseException:
                    pass

    def finish(self):
        self.drain()
        if not self.started:
            return
        self.finished = True
        status = 'cancelled' if self.cancelled.is_set() else 'failed' if self.error else 'completed'
        try:
            if _db:
                with _db() as c:
                    c.execute('UPDATE model_tasks SET status=?,failed_phase=?,error=?,admitted=0,updated_at=? WHERE id=?', (status, self.failed_phase, self.error or ('本次任务已停止' if status == 'cancelled' else ''), time.time(), self.id))
                    c.execute('UPDATE model_task_attempts SET finished_at=?,status=?,failed_phase=?,error=? WHERE task_id=? AND started_at=?',(time.time(),status,self.failed_phase,self.error,self.id,self.started_at))
        finally:
            # The worker has exited. A later start can reconcile an unfinished
            # database row when persistence was temporarily unavailable.
            with _lock:
                _active.pop(self.id, None)


@contextmanager
def bind(task):
    token = _current.set(task)
    try:
        yield task
    finally:
        _current.reset(token)


@contextmanager
def model_slot():
    task = current()
    if task:
        task.start()
        if task.depth:
            yield
            return
        task.set_phase('queue')
    started = time.monotonic()
    acquired = False
    try:
        while not acquired:
            checkpoint()
            if time.monotonic() - started > 30:
                raise ExecutionError('排队超过30秒，请稍后重试；未重复执行任务')
            if task and _db:
                with _db() as c:
                    c.execute('BEGIN IMMEDIATE')
                    count = c.execute('SELECT count(*) FROM model_tasks WHERE admitted=1').fetchone()[0]
                    if count < max(1, min(40, int(os.getenv('PRESALES_AGENT_CONCURRENCY', '20')))):
                        c.execute('UPDATE model_tasks SET admitted=1,queue_seconds=? WHERE id=?', (time.monotonic()-started, task.id))
                        acquired = True
                if not acquired:
                    task.cancelled.wait(.05)
            else:
                acquired = _slots.acquire(timeout=.05)
        if task:
            task.depth += 1
            task.set_phase('model_wait')
        yield
    except BaseException as error:
        if task:
            task.fail(error)
        raise
    finally:
        if acquired:
            # A cancelled async agent may still own a synchronous tool thread.
            # Keep its admission and conversation lease until that work exits.
            if task:
                task.drain()
                task.depth -= 1
            if task and _db:
                with _db() as c:
                    c.execute('UPDATE model_tasks SET admitted=0 WHERE id=?', (task.id,))
            else:
                _slots.release()


def sync_stream(iterator):
    """One async task owns the entire stream, including SDK/agent cleanup."""
    control = current()
    with asyncio.Runner() as runner:
        loop = runner.get_loop()
        isolated = contextvars.Context()
        isolated.run(_current.set, control)
        items = asyncio.Queue(maxsize=8)

        async def produce():
            failure = None
            try:
                async for item in iterator:
                    await items.put(('value', item))
            except BaseException as error:
                failure = error
            finally:
                try:
                    await iterator.aclose()
                except BaseException as error:
                    failure = failure or error
            if failure is not None:
                # Once cancelled, queued, undisplayed text must not delay exit.
                if isinstance(failure, asyncio.CancelledError):
                    while not items.empty():
                        items.get_nowait()
                    if control and control.cancelled.is_set():
                        failure = ExecutionCancelled('任务超过执行时限，已停止' if control.reason == 'deadline' else '本次任务已停止')
                await items.put(('error', failure))
            else:
                await items.put(('end', None))

        work = loop.create_task(produce(), context=isolated)
        async def watch():
            while not work.done():
                await asyncio.sleep(.05)
                try:
                    checkpoint()
                except ExecutionCancelled:
                    return
        monitor = loop.create_task(watch(), context=isolated) if control else None
        async def read():
            return await items.get()
        async def settle():
            await asyncio.gather(work, return_exceptions=True)
            if monitor:
                monitor.cancel()
                await asyncio.gather(monitor, return_exceptions=True)
        def cancel_work():
            if not work.done() and not work.cancelling():
                work.cancel()
        def cancel():
            loop.call_soon_threadsafe(cancel_work)
        with control.on_cancel(cancel) if control else nullcontext():
            try:
                while True:
                    checkpoint()
                    kind, value = runner.run(read(), context=isolated)
                    if kind == 'end':
                        break
                    if kind == 'error':
                        raise value
                    yield value
            finally:
                cancel_work()
                runner.run(settle(), context=isolated)


class TaskMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        import anyio
        incoming_send, incoming_receive = anyio.create_memory_object_stream(1)
        response_ended = False
        async def watch_connection():
            async with incoming_send:
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        task = scope.get('state', {}).get('model_task')
                        if task and not response_ended:
                            task.cancel('connection_closed')
                        await incoming_send.send(message)
                        return
                    await incoming_send.send(message)
        async def outgoing(message):
            nonlocal response_ended
            if message['type'] == 'http.response.start':
                task = scope.get('state', {}).get('model_task')
                if task:
                    message['headers'] = [*message.get('headers', []), (b'x-model-task-id', task.id.encode())]
                    if message['status'] >= 400 and not task.error:
                        task.fail(ExecutionError('请求失败（HTTP '+str(message['status'])+'）'))
            if message['type'] == 'http.response.body' and not message.get('more_body', False):
                response_ended = True
            await send(message)
        async with anyio.create_task_group() as group:
            group.start_soon(watch_connection)
            try:
                await self.app(scope, incoming_receive.receive, outgoing)
            finally:
                group.cancel_scope.cancel()
                with anyio.CancelScope(shield=True):
                    await incoming_receive.aclose()
                task = scope.get('state', {}).get('model_task')
                # The SSE producer owns its lifetime, even after HTTP closes.
                if task and not getattr(task, 'streaming', False):
                    with anyio.CancelScope(shield=True):
                        await anyio.to_thread.run_sync(task.finish)


async def bind_request(request, account):
    if request.method != 'POST' or request.url.path.startswith('/api/model-tasks'):
        return
    data = {}
    if 'application/json' in request.headers.get('content-type', ''):
        try:
            data = await request.json()
        except ValueError:
            pass
    if not isinstance(data, dict):
        data = {}
    match = re.match(r'/api/projects/([^/]+)(?:/workspaces/([^/]+))?', request.url.path)
    project = match[1] if match else str(data.get('project_id', ''))
    stage = match[2] if match and match[2] else 'F5' if '/software' in request.url.path else 'DOCUMENT' if request.url.path.startswith('/api/documents/') else 'ASSISTANT'
    if request.url.path.startswith('/api/documents/') and _db:
        with _db() as c:
            row = c.execute('SELECT project_id FROM documents WHERE id=?', (request.url.path.split('/')[3],)).fetchone()
        if row:
            project = row[0]
    identifier = str(data.get('turn_id') or request.headers.get('x-model-task-id') or uuid4().hex)
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', identifier):
        raise HTTPException(422, '任务编号无效')
    # Actor/project are part of the physical key; caller IDs cannot collide across tenants.
    import hashlib
    identifier = hashlib.sha256((str(account)+'\0'+project+'\0'+stage+'\0'+identifier).encode()).hexdigest()
    task = Task(account, project, stage, str(data.get('conversation_id') or request.headers.get('x-conversation-id') or identifier), identifier, request.url.path)
    request.state.model_task = task
    _current.set(task)
    if re.search(r'/(ask-stream|compare-stream|learn-stream|sdk-trial-stream|skill|extract-live|ask-live|trials|runs|analysis/retry|suggest-type)$',request.url.path) or request.url.path in {'/api/project-assistant','/api/model/test'}:
        import anyio
        await anyio.to_thread.run_sync(task.start)


def background(function, *args, project=None, actor=None, identifier=None):
    parent = current()
    owner = actor if actor is not None else parent.actor if parent else ''
    project_id = project if project is not None else parent.project if parent else ''
    stage = parent.stage if parent else ''
    conversation = str(args[0]) if args and isinstance(args[0],str) else parent.conversation if parent else ''
    entry = 'background:'+function.__module__+'.'+function.__name__
    task = Task(owner,project_id,stage,conversation,identifier,entry)
    def run():
        with bind(task):
            try:
                task.start()
                return function(*args)
            except BaseException as error:
                task.fail(error)
                raise
            finally:
                task.finish()
    return run


def install(app, db, actor):
    global _db
    _db = db
    with db() as c:
        c.execute('CREATE TABLE IF NOT EXISTS model_task_attempts(task_id TEXT NOT NULL,started_at REAL NOT NULL,finished_at REAL,status TEXT NOT NULL,failed_phase TEXT NOT NULL,error TEXT NOT NULL,entry TEXT NOT NULL,PRIMARY KEY(task_id,started_at))')
        c.execute('CREATE TABLE IF NOT EXISTS model_tasks(id TEXT PRIMARY KEY,actor TEXT NOT NULL,project TEXT NOT NULL,stage TEXT NOT NULL,conversation TEXT NOT NULL,entry TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL,failed_phase TEXT NOT NULL,error TEXT NOT NULL,cancel_requested INTEGER NOT NULL,admitted INTEGER NOT NULL,owner INTEGER NOT NULL,created_at REAL NOT NULL,updated_at REAL NOT NULL,queue_seconds REAL NOT NULL)')
    # Reconcile records left by earlier versions without changing live work.
    with _lock, db() as c:
        live_tasks(c)
        c.execute("UPDATE model_task_attempts SET finished_at=(SELECT updated_at FROM model_tasks WHERE id=task_id),status=(SELECT status FROM model_tasks WHERE id=task_id),failed_phase=(SELECT failed_phase FROM model_tasks WHERE id=task_id),error=(SELECT error FROM model_tasks WHERE id=task_id) WHERE finished_at IS NULL AND EXISTS (SELECT 1 FROM model_tasks WHERE id=task_id AND status NOT IN ('running','cancelling'))")
    app.add_middleware(TaskMiddleware)

    from fastapi import Depends
    @app.get('/api/model-tasks/{identifier}')
    def state(identifier: str, user=Depends(actor)):
        with db() as c:
            row = c.execute('SELECT * FROM model_tasks WHERE id=? AND actor=?', (identifier, str(user))).fetchone()
        if not row:
            raise HTTPException(404, '任务不存在')
        return {k: row[k] for k in ('id', 'project', 'stage', 'conversation', 'entry', 'status', 'phase', 'failed_phase', 'error', 'queue_seconds')}

    @app.post('/api/model-tasks/{identifier}/cancel')
    def cancel(identifier: str, payload:dict|None=None, user=Depends(actor)):
        with db() as c:
            row = c.execute('SELECT status FROM model_tasks WHERE id=? AND actor=?', (identifier, str(user))).fetchone()
            if not row:
                raise HTTPException(404, '任务不存在')
            if row['status'] not in {'running', 'cancelling'}:
                return {'status': row['status']}
            reason=(payload or {}).get('reason')
            reason=reason if reason in {'conversation_ended','idle_timeout','browser_deadline'} else 'cancelled'
            message=cancellation_message(reason)
            c.execute("UPDATE model_tasks SET cancel_requested=1,status='cancelling',error=CASE WHEN error='' THEN ? ELSE error END WHERE id=?", (message,identifier))
        with _lock:
            task = _active.get(identifier)
        if task:
            reason=(payload or {}).get('reason')
            task.cancel(reason if reason in {'conversation_ended','idle_timeout','browser_deadline'} else 'cancelled')
        return {'status': 'cancelling'}
