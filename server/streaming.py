"""Bounded SSE heartbeat bridge; model work never runs on the HTTP event loop."""
import contextvars
import json
import logging
import os
import queue
import threading
import time
from model_gateway import ModelError
from execution_control import current, checkpoint

# Connections include waiting users; model admission remains independently bounded.
_producers = threading.BoundedSemaphore(max(1, min(200, int(os.getenv('PRESALES_STREAM_CONNECTIONS', '100')))))

def event(kind, **data):
    return "data: " + json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n\n"

def heartbeat_stream(source, interval=10, deadline=300, on_stop=None):
    control=current()
    if control:control.streaming=True
    if not _producers.acquire(blocking=False):
        if control:
            control.fail(ModelError('当前请求较多，请稍后再试'))
            control.finish()
        yield event("error", message="当前请求较多，请稍后再试")
        return
    items = queue.Queue(maxsize=32)
    stopped = threading.Event()
    def put(value):
        while not stopped.is_set():
            try:
                items.put(value, timeout=0.1)
                return
            except queue.Full:
                pass
    context=contextvars.copy_context()
    def produce():
        iterator = iter(source)
        failure = None
        try:
            for piece in iterator:
                if stopped.is_set():
                    break
                checkpoint()
                if control:
                    try:
                        item=json.loads(piece.removeprefix('data: ').strip())
                        if item.get('type')=='error':
                            control.fail(ModelError(item.get('message','请求失败')))
                    except (ValueError,AttributeError):
                        pass
                put(('data',piece))
        except Exception as error:
            logging.getLogger(__name__).warning('Stream producer failed: %s',type(error).__name__)
            failure = str(error) if isinstance(error,ModelError) else '请求处理失败，请重试'
            if control:
                control.fail(error)
        finally:
            try:
                close=getattr(iterator,'close',None)
                if close:
                    close()
                if control:
                    control.finish()
                    control.stream_finished=True
            except Exception as error:
                logging.getLogger(__name__).warning('Task cleanup failed: %s',type(error).__name__)
                failure='任务收尾失败，请稍后查看执行状态'
            finally:
                _producers.release()
        # HTTP completion must not precede task persistence/resource release.
        put(('error',failure) if failure else ('end',None))
    threading.Thread(target=lambda:context.run(produce), name="workbench-stream", daemon=True).start()
    started = time.monotonic()
    try:
        while True:
            elapsed = time.monotonic() - started
            if elapsed >= deadline:
                if control:control.cancel('stream_deadline')
                yield event("error", message="本次处理超过"+("5分钟" if deadline==300 else str(deadline)+"秒")+"，已停止。已生成内容保留，可重试。")
                break
            try:
                kind, value = items.get(timeout=min(interval, deadline-elapsed))
            except queue.Empty:
                yield event("heartbeat", elapsed_seconds=round(time.monotonic()-started),
                            message="请求仍在处理中，可以停止本次生成")
                continue
            if kind == "end":
                if control:control.stream_finished=True
                break
            if kind == "error":
                yield event("error", message=value)
                break
            yield value
    finally:
        stopped.set()
        if control and not control.cancelled.is_set() and not getattr(control,'stream_finished',False):control.cancel('connection_closed')
        if on_stop: on_stop()
