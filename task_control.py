"""Cooperative task cancellation with resource cleanup hooks."""
from contextlib import contextmanager
import os
import socket
import subprocess
import threading
import queue

LOCK = threading.RLock()
TOKENS = {}


class Cancelled(RuntimeError):
    pass


class Token:
    def __init__(self):
        self.event = threading.Event()
        self.lock = threading.Lock()
        self.callbacks = set()

    def check(self):
        if self.event.is_set():
            raise Cancelled('任务已取消，已发生的文件变更可在项目差异中检查和回退')

    def cancel(self):
        self.event.set()
        with self.lock:
            callbacks = list(self.callbacks)
        for callback in callbacks:
            threading.Thread(target=self.clean, args=(callback,), daemon=True).start()

    @staticmethod
    def clean(callback):
        try:
            callback()
        except Exception:
            pass

    @contextmanager
    def resource(self, callback):
        with self.lock:
            self.callbacks.add(callback)
            cancelled = self.event.is_set()
        if cancelled:
            self.clean(callback)
        try:
            self.check()
            yield
            self.check()
        finally:
            with self.lock:
                self.callbacks.discard(callback)


def create(key):
    token = Token()
    with LOCK:
        TOKENS[key] = token
    return token


def remove(key):
    with LOCK:
        TOKENS.pop(key, None)


def cancel(key):
    with LOCK:
        token = TOKENS.get(key)
    if not token:
        return False
    token.cancel()
    return True


def check(config):
    token = config.get('_cancel_token')
    if token:
        token.check()


def io_call(token, operation):
    """Keep a blocking network read from holding the task cancellation boundary."""
    if not token:
        return operation()
    token.check()
    result = queue.Queue(maxsize=1)
    def work():
        try:
            result.put((True, operation()))
        except Exception as error:
            result.put((False, error))
    threading.Thread(target=work, daemon=True, name='astra-network').start()
    while True:
        token.check()
        try:
            success, value = result.get(timeout=.1)
        except queue.Empty:
            continue
        token.check()
        if not success:
            raise value
        return value


def close_response(response):
    raw = getattr(getattr(response, 'fp', None), 'raw', None)
    connection = getattr(raw, '_sock', None)
    if connection:
        try:
            connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
    response.close()


def kill_process(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    else:
        process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
