"""Finite socket workers and local burst limits; streaming connections retain a slot."""
from collections import deque
import threading
import time
from functools import wraps

LOCK = threading.Lock()
REQUESTS = deque()
EXPENSIVE = deque()
UPSTREAM = threading.BoundedSemaphore(12)


def limited(call):
    if not UPSTREAM.acquire(blocking=False):
        raise ValueError('上游并发请求达到限制，请稍后重试')
    try:
        return call()
    finally:
        UPSTREAM.release()


def bounded(function):
    @wraps(function)
    def invoke(*args,**kwargs):
        return limited(lambda:function(*args,**kwargs))
    return invoke


def allow(path, method):
    now = time.monotonic()
    with LOCK:
        for entries in (REQUESTS, EXPENSIVE):
            while entries and entries[0] < now - 60:
                entries.popleft()
        if len(REQUESTS) >= 1200:
            return False
        REQUESTS.append(now)
        if method == 'POST' and (path.endswith(('/chat', '/review', '/tts', '/stt', '/models', '/test', '/discover', '/refresh', '/install', '/import'))):
            if len(EXPENSIVE) >= 60:
                return False
            EXPENSIVE.append(now)
        return True
