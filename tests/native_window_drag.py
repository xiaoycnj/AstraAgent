"""Opt-in Windows desktop test: temporarily moves only its own topmost test window."""
import ctypes
import json
import os
from pathlib import Path
import sys
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def main():
    if os.name!='nt':raise SystemExit('Windows desktop required')
    import runtime_paths
    runtime_paths.configure_environment(ROOT)
    sys.path.insert(0,str(ROOT/'vendor_desktop'))
    import webview,native_frame
    ready=threading.Event()
    results={}
    class Bridge:
        def window_drag(self):return native_frame.begin_drag(window)
    window=webview.create_window('AstraAgent drag regression',html='''<body style="margin:0"><div id="bar" style="height:50px;background:#bbc">Drag regression</div><button>Control</button><script>document.getElementById('bar').addEventListener('mousedown',e=>{e.preventDefault();window.pywebview.api.window_drag()})</script>''',width=650,height=420,on_top=True,frameless=True,easy_drag=False,js_api=Bridge())
    def loaded():
        native_frame.install(window)
        native_frame.center(window)
        window._native_frame.drag_rects=[[6,6,540,50]]
        window._native_frame.maximize_rect=[540,6,590,50]
        ready.set()
    window.events.loaded+=loaded
    def test():
        user=native_frame.api()
        user.GetCursorPos.argtypes=[ctypes.POINTER(native_frame.Point)]
        user.SetCursorPos.argtypes=[ctypes.c_int,ctypes.c_int]
        original=native_frame.Point();user.GetCursorPos(ctypes.byref(original))
        try:
            assert ready.wait(15),'native frame ready'
            time.sleep(.3)
            before=native_frame.metrics(window)['bounds']
            handle=int(window.native.Handle.ToInt64())
            user.SendMessageW.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_ssize_t]
            user.SendMessageW.restype=ctypes.c_ssize_t
            def hit(x,y):
                p=native_frame.Point(x,y);user.ClientToScreen(handle,ctypes.byref(p))
                return user.SendMessageW(handle,0x84,0,((p.y&0xffff)<<16)|(p.x&0xffff))
            results['hits']={'caption':hit(220,26),'control':hit(40,75),'maximize':hit(560,26),'edge':hit(1,100)}
            assert results['hits']=={'caption':2,'control':1,'maximize':9,'edge':10},results
            x,y=before[0]+220,before[1]+26
            assert user.SetCursorPos(x,y)
            user.mouse_event(2,0,0,0,0);time.sleep(.3)
            for n in range(1,11):
                user.SetCursorPos(x+10*n,y+4*n);time.sleep(.04)
            user.mouse_event(4,0,0,0,0);time.sleep(.3)
            after=native_frame.metrics(window)['bounds']
            results['delta']=[after[0]-before[0],after[1]-before[1]]
            assert all(abs(a-b)<=2 for a,b in zip(results['delta'],[100,40])),results
        except Exception as error:results['error']=str(error)
        finally:
            user.mouse_event(4,0,0,0,0);user.SetCursorPos(original.x,original.y);window.destroy()
    webview.start(test,gui='edgechromium',storage_path=str(ROOT/'work/drag-regression-profile'))
    print(json.dumps(results))
    assert 'error' not in results,results

if __name__=='__main__':main()
