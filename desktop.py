"""Native WebView2 host with a compact, ready-gated startup window."""
import security_core
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import runtime_paths
import ui_locale
import native_frame

ROOT = Path(__file__).resolve().parent
runtime_paths.configure_environment(ROOT)
ICON = ROOT / 'web/assets/icons/brand/astra.ico'
sys.path.insert(0, str(ROOT / 'vendor_desktop'))


def native_details(window, rounded=False):
    if os.name != 'nt':
        return {}
    from ctypes import wintypes
    handle = int(window.native.Handle.ToInt64())
    user = ctypes.WinDLL('user32', use_last_error=True)
    gdi = ctypes.WinDLL('gdi32', use_last_error=True)
    user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user.SendMessageW.restype = ctypes.c_void_p
    user.SetWindowRgn.argtypes = [wintypes.HWND, ctypes.c_void_p, wintypes.BOOL]
    gdi.CreateRoundRectRgn.argtypes = [ctypes.c_int] * 6
    gdi.CreateRoundRectRgn.restype = ctypes.c_void_p
    gdi.CreateRectRgn.restype = ctypes.c_void_p
    gdi.DeleteObject.argtypes = [ctypes.c_void_p]
    bounds = wintypes.RECT()
    user.GetWindowRect(handle, ctypes.byref(bounds))
    width = bounds.right - bounds.left
    height = bounds.bottom - bounds.top
    if rounded:
        user.GetDpiForWindow.argtypes = [wintypes.HWND]
        radius = round(28 * user.GetDpiForWindow(handle) / 96)
        region = gdi.CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2)
        if not user.SetWindowRgn(handle, region, True):
            gdi.DeleteObject(region)
    region = gdi.CreateRectRgn(0, 0, 0, 0)
    user.GetWindowRgn.argtypes = [wintypes.HWND, ctypes.c_void_p]
    region_type = user.GetWindowRgn(handle, region)
    gdi.DeleteObject(region)
    return {
        'width': width,
        'height': height,
        'frameless': not bool(user.GetWindowLongW(handle, -16) & 0x00C00000) or bool(getattr(window,'_native_frame',None)),
        'rounded_region': region_type,
        'icon_loaded': bool(user.SendMessageW(handle, 0x007F, 1, 0)),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default=str(ROOT / 'data'))
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    data = Path(args.data_dir).resolve()
    data.mkdir(parents=True, exist_ok=True)
    mutex = None
    if os.name == 'nt':
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateMutexW.restype = ctypes.c_void_p
        identity = hashlib.sha256(str(data).encode()).hexdigest()[:16]
        mutex = kernel.CreateMutexW(None, False, 'Local\\AstraAgent-' + identity)
        if ctypes.get_last_error() == 183:
            ctypes.windll.user32.MessageBoxW(0, ui_locale.translator(ROOT,data)('AstraAgent 已在运行。请使用应用内的新窗口。'), 'AstraAgent', 0)
            return
        shell = ctypes.WinDLL('shell32')
        shell.SetCurrentProcessExplicitAppUserModelID.argtypes = [ctypes.c_wchar_p]
        shell.SetCurrentProcessExplicitAppUserModelID('cnxiaoy.AstraAgent.Desktop')

    import updater
    cleanup_timer=threading.Timer(20,lambda:updater.cleanup(ROOT));cleanup_timer.daemon=True;cleanup_timer.start()
    import webview
    webview.settings['DRAG_REGION_DIRECT_TARGET_ONLY'] = True
    bundled_webview = runtime_paths.prepare_webview_runtime(ROOT,data)
    if bundled_webview:
        webview.settings['WEBVIEW2_RUNTIME_PATH'] = str(bundled_webview)
    translate = ui_locale.translator(ROOT, data)
    stop_file = data / 'desktop-stop'
    state_file = data / 'desktop-state.json'
    state_file.unlink(missing_ok=True)
    watchdog = subprocess.Popen(
        [sys.executable, str(ROOT / 'watchdog.py'), '--data-dir', str(data), '--port', str(args.port), '--parent', str(os.getpid())],
        cwd=ROOT,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    closing = threading.Event()
    transitioning = threading.Event()
    connecting = threading.Lock()
    main_window = None
    splash_metrics = {}
    shown_at = time.monotonic()

    def shutdown():
        if closing.is_set():
            return
        closing.set()
        stop_file.write_text('stop', encoding='utf-8')
        for window in list(webview.windows):
            window.destroy()

    def set_status(text, failed=False):
        if transitioning.is_set() or closing.is_set():
            return
        try:
            splash.evaluate_js("document.getElementById('status').textContent=" + json.dumps(translate(text)) + ";document.body.classList.toggle('failed'," + str(failed).lower() + ');')
        except Exception:
            pass

    def workspace_loaded():
        if closing.is_set() or transitioning.is_set():
            return
        if not (main_window.get_current_url() or '').startswith('http://127.0.0.1:'):
            return
        native_frame.install(main_window)
        controls = main_window.evaluate_js("document.querySelectorAll('.policy-option').length")
        while time.monotonic() - shown_at < 1.2 and not closing.is_set():
            time.sleep(.05)
        if closing.is_set():
            return
        transitioning.set()
        main_window.show()
        main_window.evaluate_js("window.reportWindowChrome?.()")
        splash.destroy()
        if args.smoke:
            url = main_window.get_current_url()
            extra = webview.create_window('AstraAgent · second window', url=url, width=900, height=650)

            def second_loaded():
                before_maximize = native_details(main_window)
                bridge.window_control('maximize')
                maximized_details = native_details(main_window)
                work_area_details = native_frame.metrics(main_window)
                bridge.window_control('maximize')
                bridge.window_control('minimize')
                main_window.restore()
                main_window.evaluate_js("window.reportWindowChrome?.()")
                time.sleep(.2)
                (data / 'desktop-smoke.json').write_text(json.dumps({
                    'loaded': True, 'url': url, 'policy_controls': controls,
                    'native_windows': len(webview.windows), 'splash': splash_metrics,
                    'project_picker': main_window.evaluate_js("typeof window.pywebview?.api?.choose_project === 'function'"),
                    'glass_surfaces': main_window.evaluate_js("document.querySelectorAll('.glass-surface').length"),
                    'glass_variants': main_window.evaluate_js("document.querySelectorAll('button[data-glass-variant]').length"),
                    'python_executable': sys.executable,
                    'console_window': bool(ctypes.windll.kernel32.GetConsoleWindow()) if os.name=='nt' else None,
                    'webview_runtime': str(bundled_webview) if bundled_webview else 'system',
                    'language_control': main_window.evaluate_js("!!document.getElementById('ui-language')"),
                    'audio_capture_api': main_window.evaluate_js("typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder === 'function'"),
                    'main_icon_loaded': native_details(main_window)['icon_loaded'],
                    'main_frameless': before_maximize['frameless'],
                    'window_controls': main_window.evaluate_js("document.querySelectorAll('.window-controls:not([hidden]) button').length"),
                    'maximize_expanded': maximized_details['width'] > before_maximize['width'],
                    'native_frame': work_area_details,
                    'maximize_hit_test': native_frame.maximize_hit_test(main_window),
                    'compact_composer_height': main_window.evaluate_js("document.getElementById('chat-form').getBoundingClientRect().height"),
                    'icon': str(ICON),
                }), encoding='utf-8')
                threading.Timer(2, main_window.destroy).start()

            extra.events.loaded += second_loaded

    def connect():
        nonlocal main_window
        if not connecting.acquire(blocking=False):
            return
        try:
            for _ in range(120):
                if closing.is_set():
                    return
                try:
                    value = json.loads(state_file.read_text(encoding='utf-8'))
                    if value['status'] == 'ready' and value['url'].startswith('http://127.0.0.1:'):
                        set_status('正在载入你的工作空间')
                        if main_window is None:
                            main_window = webview.create_window(
                                'AstraAgent', url=security_core.launch_url(value['url'],data), js_api=bridge,
                                width=1320, height=900, min_size=(480, 480), hidden=True,
                                background_color='#14171e', frameless=True, easy_drag=False,
                            )
                            bridge._window = main_window
                            main_window.events.loaded += workspace_loaded
                            main_window.events.closed += shutdown
                        else:
                            main_window.load_url(security_core.launch_url(value['url'],data))
                        return
                except (OSError, ValueError, KeyError):
                    pass
                time.sleep(.5)
            set_status('连接尚未就绪，请重新连接', failed=True)
        finally:
            connecting.release()

    class Bridge:
        def __init__(self):
            self._window = None
            self._maximized = False

        def window_chrome(self, body):
            import math
            rect=body.get('maximize') if isinstance(body,dict) else None
            if not isinstance(rect,list) or len(rect)!=4 or any(type(n) not in (int,float) or not math.isfinite(n) or not 0<=n<=20000 for n in rect):raise ValueError('窗口区域无效')
            hook=getattr(self._window,'_native_frame',None)
            drag=body.get('drag',[])
            if not isinstance(drag,list) or len(drag)>16 or any(not isinstance(r,list) or len(r)!=4 or any(type(n) not in (int,float) or not math.isfinite(n) or not 0<=n<=20000 for n in r) for r in drag):raise ValueError('拖动区域无效')
            if hook:hook.maximize_rect=rect;hook.drag_rects=drag
            return {'ready':bool(hook)}

        def window_drag(self):
            return native_frame.begin_drag(self._window)

        def window_control(self, action):
            if action not in ('minimize','maximize','close'):raise ValueError('窗口操作无效')
            owner = self._window
            if owner is None:return {'ready':False}
            if action == 'minimize':owner.minimize()
            elif action == 'close':owner.destroy()
            else:
                if os.name == 'nt':
                    user=ctypes.WinDLL('user32')
                    user.IsZoomed.argtypes=[ctypes.c_void_p]
                    self._maximized=bool(user.IsZoomed(int(owner.native.Handle.ToInt64())))
                self._maximized = not self._maximized
                if self._maximized:owner.maximize()
                else:owner.restore()
            return {'ready':True,'maximized':self._maximized}

        def check_update(self):
            import updater
            return updater.latest(ROOT)

        def install_update(self):
            import updater
            if (ROOT/'.git').exists():raise ValueError('源码工作区请通过 Git 更新')
            updater.launch(data,os.getpid())
            shutdown()
            return True

        def retry(self):
            threading.Thread(target=connect, daemon=True).start()
            return True

        def cancel_startup(self):
            if not transitioning.is_set():
                shutdown()
            return True

        def choose_project(self):
            owner = self._window or main_window or splash
            selected = owner.create_file_dialog(webview.FileDialog.FOLDER)
            return selected[0] if selected else None

        def new_window(self, session=''):
            from urllib.parse import quote
            value = json.loads(state_file.read_text(encoding='utf-8'))
            child_bridge = Bridge()
            child_bridge._window = webview.create_window(
                'AstraAgent', url=security_core.launch_url(value['url'] + '/?session=' + quote(str(session)),data),
                js_api=child_bridge, width=1180, height=820, min_size=(480, 480),
                frameless=True, easy_drag=False,
            )
            def child_loaded():
                native_frame.install(child_bridge._window)
                child_bridge._window.evaluate_js('window.reportWindowChrome?.()')
            child_bridge._window.events.loaded += child_loaded
            return True

    bridge = Bridge()
    splash = webview.create_window(
        'AstraAgent · Starting', url=str(ROOT / 'web/assets/startup/splash.html'),
        js_api=bridge, width=560, height=350, min_size=(560, 350),
        frameless=True, resizable=False, easy_drag=True, shadow=True,
        on_top=True, background_color='#fcfcfd',
    )

    def splash_shown():
        nonlocal shown_at
        native_frame.center(splash)
        shown_at = time.monotonic()
        splash_metrics.update(native_details(splash, rounded=True))

    def splash_loaded():
        if transitioning.is_set() or closing.is_set():
            return
        set_status('正在唤醒工作空间')
        try:
            labels = {'cancel': translate('取消启动'), 'retry': translate('重新连接')}
            splash.evaluate_js("(()=>{const labels=" + json.dumps(labels) + ";const close=document.querySelector('.close');close.title=labels.cancel;close.setAttribute('aria-label',labels.cancel);document.querySelector('.retry').textContent=labels.retry;})()")
            splash_metrics['cancel_label'] = splash.evaluate_js("document.querySelector('.close').getAttribute('aria-label')")
        except Exception:
            pass

    def splash_closed():
        if not transitioning.is_set():
            shutdown()

    splash.events.shown += splash_shown
    splash.events.loaded += splash_loaded
    splash.events.closed += splash_closed
    try:
        webview.start(connect, gui='edgechromium', icon=str(ICON), private_mode=False, storage_path=str(data / 'webview'))
    finally:
        shutdown()
        try:
            watchdog.wait(timeout=12)
        except subprocess.TimeoutExpired:
            watchdog.terminate()
        if mutex:
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel.CloseHandle(mutex)


if __name__ == '__main__':
    main()
