"""Windows custom chrome with native frame styles, monitor work area and Snap hit testing."""
import ctypes
from ctypes import wintypes
import os

def center(window):
    """Center in the cursor monitor's working area using native physical coordinates."""
    if os.name!='nt':return
    from System import Action
    from System.Drawing import Point as DrawingPoint
    from System.Windows.Forms import Cursor, Screen
    form=window.native
    def apply():
        area=Screen.FromPoint(Cursor.Position).WorkingArea
        form.Location=DrawingPoint(area.Left+max(0,(area.Width-form.Width)//2),area.Top+max(0,(area.Height-form.Height)//2))
    form.Invoke(Action(apply))

class Point(ctypes.Structure):
    _fields_=[('x',wintypes.LONG),('y',wintypes.LONG)]
class MinMax(ctypes.Structure):
    _fields_=[('reserved',Point),('maximum',Point),('position',Point),('minimum_track',Point),('maximum_track',Point)]
class Monitor(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('monitor',wintypes.RECT),('work',wintypes.RECT),('flags',wintypes.DWORD)]

def api():
    user=ctypes.WinDLL('user32',use_last_error=True)
    user.MonitorFromWindow.argtypes=[wintypes.HWND,wintypes.DWORD];user.MonitorFromWindow.restype=wintypes.HMONITOR
    user.GetMonitorInfoW.argtypes=[wintypes.HMONITOR,ctypes.POINTER(Monitor)]
    user.GetWindowLongW.argtypes=[wintypes.HWND,ctypes.c_int]
    user.SetWindowLongW.argtypes=[wintypes.HWND,ctypes.c_int,ctypes.c_long]
    user.SetWindowPos.argtypes=[wintypes.HWND,wintypes.HWND,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,wintypes.UINT]
    user.GetWindowRect.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.RECT)]
    user.GetClientRect.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.RECT)]
    user.ClientToScreen.argtypes=[wintypes.HWND,ctypes.POINTER(Point)]
    user.ScreenToClient.argtypes=[wintypes.HWND,ctypes.POINTER(Point)]
    user.IsZoomed.argtypes=[wintypes.HWND]
    user.GetDpiForWindow.argtypes=[wintypes.HWND]
    return user

def monitor_info(user,handle):
    info=Monitor();info.size=ctypes.sizeof(info)
    if not user.GetMonitorInfoW(user.MonitorFromWindow(handle,2),ctypes.byref(info)):raise ctypes.WinError(ctypes.get_last_error())
    return info

def metrics(window):
    if os.name!='nt':return {}
    user=api();handle=int(window.native.Handle.ToInt64());info=monitor_info(user,handle);bounds=wintypes.RECT()
    user.GetWindowRect(handle,ctypes.byref(bounds));work=info.work;style=user.GetWindowLongW(handle,-16)
    client=wintypes.RECT();origin=Point(0,0);user.GetClientRect(handle,ctypes.byref(client));user.ClientToScreen(handle,ctypes.byref(origin))
    return {'bounds':[bounds.left,bounds.top,bounds.right,bounds.bottom],'work_area':[work.left,work.top,work.right,work.bottom],
            'client_bounds':[origin.x,origin.y,origin.x+client.right,origin.y+client.bottom],
            'fits_work_area':origin.x>=work.left and origin.y>=work.top and origin.x+client.right<=work.right and origin.y+client.bottom<=work.bottom,
            'native_resize':bool(style&0x40000),'native_minimize':bool(style&0x20000),'native_maximize':bool(style&0x10000),
            'custom_frame':bool(getattr(window,'_native_frame',None)),
            'nonclient_calculations':getattr(getattr(window,'_native_frame',None),'calculations',0)}

def maximize_hit_test(window):
    hook=getattr(window,'_native_frame',None)
    if not hook or not hook.maximize_rect:return None
    user=api();handle=int(window.native.Handle.ToInt64());rect=hook.maximize_rect
    point=Point(round((rect[0]+rect[2])/2),round((rect[1]+rect[3])/2));user.ClientToScreen(handle,ctypes.byref(point))
    user.SendMessageW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM];user.SendMessageW.restype=ctypes.c_ssize_t
    return int(user.SendMessageW(handle,0x84,0,((point.y&0xffff)<<16)|(point.x&0xffff)))

def begin_drag(window):
    if os.name!='nt' or not getattr(window,'_native_frame',None):return False
    from System import Action
    user=api();form=window.native;handle=int(form.Handle.ToInt64())
    user.GetCursorPos.argtypes=[ctypes.POINTER(Point)]
    user.DefWindowProcW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM];user.DefWindowProcW.restype=ctypes.c_ssize_t
    def drag():
        # WebView bridge calls run on workers; capture belongs to the UI thread.
        point=Point()
        if not user.GetCursorPos(ctypes.byref(point)):return
        user.ReleaseCapture()
        # WinForms suppresses SC_MOVE for FormBorderStyle.None; use the OS handler.
        user.DefWindowProcW(handle,0x112,0xF012,((point.y&0xffff)<<16)|(point.x&0xffff))
    form.Invoke(Action(drag))
    return True


def install(window):
    if os.name!='nt' or getattr(window,'_native_frame',None):return
    from System import Action
    user=api();form=window.native;handle=int(form.Handle.ToInt64())
    common=ctypes.WinDLL('comctl32',use_last_error=True)
    Result=ctypes.c_ssize_t;UIntPtr=ctypes.c_size_t
    Callback=ctypes.WINFUNCTYPE(Result,wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM,UIntPtr,UIntPtr)
    common.SetWindowSubclass.argtypes=[wintypes.HWND,Callback,UIntPtr,UIntPtr];common.SetWindowSubclass.restype=wintypes.BOOL
    common.DefSubclassProc.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM];common.DefSubclassProc.restype=Result
    common.RemoveWindowSubclass.argtypes=[wintypes.HWND,Callback,UIntPtr]
    user.PostMessageW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM]
    class Frame:
        def __init__(self):
            self.maximize_rect=None;self.drag_rects=[];self.calculations=0
            self.callback=Callback(self.dispatch);self.identifier=id(self)
        def dispatch(self,hwnd,code,wparam,lparam,identifier,reference):
            try:
                if code==0x83 and wparam:
                    self.calculations+=1
                    if user.IsZoomed(handle):
                        work=monitor_info(user,handle).work
                        rect=wintypes.RECT.from_address(lparam)
                        rect.left=work.left;rect.top=work.top;rect.right=work.right;rect.bottom=work.bottom
                    return 0
                if code==0x24:
                    result=common.DefSubclassProc(hwnd,code,wparam,lparam)
                    info=monitor_info(user,handle);value=MinMax.from_address(lparam)
                    value.position=Point(info.work.left-info.monitor.left,info.work.top-info.monitor.top)
                    value.maximum=Point(info.work.right-info.work.left,info.work.bottom-info.work.top)
                    return result
                if code==0x84:
                    point=Point(ctypes.c_short(lparam&0xffff).value,ctypes.c_short((lparam>>16)&0xffff).value)
                    user.ScreenToClient(handle,ctypes.byref(point));x,y=point.x,point.y
                    bounds=wintypes.RECT();user.GetWindowRect(handle,ctypes.byref(bounds));width=bounds.right-bounds.left;height=bounds.bottom-bounds.top
                    edge=max(5,round(6*user.GetDpiForWindow(handle)/96))
                    if not user.IsZoomed(handle):
                        left,right,top,bottom=x<edge,x>=width-edge,y<edge,y>=height-edge
                        hit=13 if top and left else 14 if top and right else 16 if bottom and left else 17 if bottom and right else 10 if left else 11 if right else 12 if top else 15 if bottom else 0
                        if hit:return hit
                    rect=self.maximize_rect
                    if rect and rect[0]<=x<rect[2] and rect[1]<=y<rect[3]:return 9
                    if any(r[0]<=x<r[2] and r[1]<=y<r[3] for r in self.drag_rects):return 2
                    return 1
                if code==0xA1 and wparam==9:return 0
                if code==0xA2 and wparam==9:
                    user.PostMessageW(handle,0x112,0xF120 if user.IsZoomed(handle) else 0xF030,0);return 0
                if code==0x82:common.RemoveWindowSubclass(handle,self.callback,self.identifier)
            except Exception:
                # Callback exceptions must never unwind through the native message loop.
                pass
            return common.DefSubclassProc(hwnd,code,wparam,lparam)
    def attach():
        hook=Frame()
        if not common.SetWindowSubclass(handle,hook.callback,hook.identifier,0):raise ctypes.WinError(ctypes.get_last_error())
        window._native_frame=hook;form.MaximizeBox=True;form.MinimizeBox=True
        style=user.GetWindowLongW(handle,-16)|0x00C00000|0x40000|0x80000|0x20000|0x10000
        user.SetWindowLongW(handle,-16,style);user.SetWindowPos(handle,None,0,0,0,0,0x37)
        dwm=ctypes.WinDLL('dwmapi');dwm.DwmSetWindowAttribute.argtypes=[wintypes.HWND,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD]
        for attribute,value in [(3,0),(33,2),(2,2)]:
            setting=ctypes.c_int(value);dwm.DwmSetWindowAttribute(handle,attribute,ctypes.byref(setting),ctypes.sizeof(setting))
    form.Invoke(Action(attach))
