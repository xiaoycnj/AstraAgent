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
from urllib.parse import urlsplit
import runtime_paths
import ui_locale
import native_frame
from desktop_tray import DesktopTray

ROOT = Path(__file__).resolve().parent
runtime_paths.configure_environment(ROOT)
ICON = ROOT / 'web/assets/icons/brand/astra.ico'
LOADING_URL = (ROOT / 'web/assets/startup/workspace-loading.html').as_uri()
sys.path.insert(0, str(ROOT / 'vendor_desktop'))


def workspace_origin(value):
    """Accept only the canonical backend origin written by the watchdog."""
    if not isinstance(value, str):
        raise ValueError('工作区地址无效')
    port = urlsplit(value).port
    if not port or value != f'http://127.0.0.1:{port}':
        raise ValueError('工作区地址无效')
    return value


def trusted_desktop_page(value, origin=None, allow_loading=False):
    if allow_loading and value == LOADING_URL:
        return True
    if not origin:
        return False
    return value.split('#', 1)[0].split('?', 1)[0] == origin + '/'


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


def smoke_window_input(window, other):
    """Exercise real pointer delivery to the native frame and WebView2."""
    from ctypes import wintypes
    from System import Action
    from System.Drawing import Rectangle
    from System.Windows.Forms import Screen

    form = window.native
    user = native_frame.api()
    user.GetCursorPos.argtypes = [ctypes.POINTER(native_frame.Point)]
    user.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
    user.WindowFromPoint.argtypes = [native_frame.Point]
    user.WindowFromPoint.restype = wintypes.HWND
    user.GetForegroundWindow.restype = wintypes.HWND
    user.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t]
    saved = native_frame.Point()
    user.GetCursorPos(ctypes.byref(saved))
    handle = int(form.Handle.ToInt64())

    def arrange():
        area = Screen.FromControl(form).WorkingArea
        form.Bounds = Rectangle(area.Left+10, area.Top+30, min(area.Width-75, 950), min(area.Height-70, 650))
        form.TopMost = True
        other.native.Bounds = Rectangle(area.Left+24, area.Top+145, 530, min(area.Height-175, 500))
        form.Activate()

    form.Invoke(Action(arrange))
    before = native_frame.metrics(window)
    left, top, right, bottom = before['bounds']
    border = native_frame.Point(right-2, (top+bottom)//2)
    edge_targets_frame = user.WindowFromPoint(border) == handle

    def move(x, y):
        user.SetCursorPos(x, y)
        time.sleep(.12)

    try:
        move(border.x, border.y)
        user.mouse_event(0x0002, 0, 0, 0, 0)
        try:
            time.sleep(.15)
            for dx in (12, 24, 42):
                move(border.x+dx, border.y)
        finally:
            user.mouse_event(0x0004, 0, 0, 0, 0)
        time.sleep(.18)
        after = native_frame.metrics(window)
        center = window.evaluate_js("(()=>{const r=document.querySelector('#window-close').getBoundingClientRect();return [(r.right-4)*devicePixelRatio,(r.top+7)*devicePixelRatio]})()")
        x = after['client_bounds'][0] + round(center[0])
        y = after['client_bounds'][1] + round(center[1])
        def activate_other():
            other.native.TopMost = True
            other.native.Activate()
        other.native.Invoke(Action(activate_other))
        time.sleep(.15)
        inactive = user.GetForegroundWindow() != handle
        target = user.WindowFromPoint(native_frame.Point(x,y))
        user.IsChild.argtypes = [wintypes.HWND,wintypes.HWND]
        delivered_to_window = target == handle or bool(user.IsChild(handle,target))
        if delivered_to_window:
            move(x,y)
            user.mouse_event(0x0002,0,0,0,0)
            time.sleep(.08)
            user.mouse_event(0x0004,0,0,0,0)
        deadline = time.monotonic()+1.5
        while form.Visible and time.monotonic()<deadline:
            time.sleep(.05)
        return {'native_edge': edge_targets_frame, 'width_change': after['bounds'][2]-right,
                'close_was_inactive': inactive, 'close_target_reached': delivered_to_window,
                'first_click_hides': not form.Visible}
    finally:
        user.SetCursorPos(saved.x,saved.y)
        def reset_z_order():
            form.TopMost = False
            other.native.TopMost = False
        form.Invoke(Action(reset_z_order))


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
            ctypes.windll.user32.MessageBoxW(0, ui_locale.translator(ROOT,data)('AstraAgent 已在运行。请从系统托盘打开主窗口。'), 'AstraAgent', 0)
            return
        shell = ctypes.WinDLL('shell32')
        shell.SetCurrentProcessExplicitAppUserModelID.argtypes = [ctypes.c_wchar_p]
        shell.SetCurrentProcessExplicitAppUserModelID('cnxiaoy.AstraAgent.Desktop')

    import updater
    cleanup_timer=threading.Timer(20,lambda:updater.cleanup(ROOT));cleanup_timer.daemon=True;cleanup_timer.start()
    import webview
    webview.settings['DRAG_REGION_DIRECT_TARGET_ONLY'] = True
    webview.settings['ALLOW_FILE_URLS'] = False
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
    shutdown_lock = threading.Lock()
    transitioning = threading.Event()
    connecting = threading.Lock()
    main_window = None
    tray = None
    loading_metrics = {}
    workspace_url = None

    def shutdown():
        with shutdown_lock:
            if closing.is_set():
                return
            closing.set()
        if tray:
            try:
                tray.dispose()
            except Exception as error:
                print(f'Tray cleanup failed: {error}', file=sys.stderr)
        stop_file.write_text('stop', encoding='utf-8')
        for window in list(webview.windows):
            window.destroy()

    def set_status(phase, text):
        if transitioning.is_set() or closing.is_set():
            return
        try:
            args = json.dumps([phase, translate(text)])
            main_window.evaluate_js(f'window.setWorkspaceLoading?.(...{args})')
        except Exception:
            pass

    def workspace_loaded():
        nonlocal tray
        if closing.is_set() or transitioning.is_set():
            return
        if not trusted_desktop_page(main_window.get_current_url() or '', workspace_url):
            return
        native_frame.install(main_window)
        controls = main_window.evaluate_js("document.querySelectorAll('.policy-option').length")
        if closing.is_set():
            return
        if os.name == 'nt':
            try:
                tray = DesktopTray(main_window, ICON, ui_locale.translator(ROOT, data), shutdown, closing.is_set)
            except Exception as error:
                print(f'Tray unavailable: {error}', file=sys.stderr)
        transitioning.set()
        main_window.evaluate_js("window.reportWindowChrome?.()")
        if args.smoke:
            url = workspace_url
            extra = webview.create_window('AstraAgent · second window', url=url, width=900, height=650)

            def second_loaded():
                workspace_page = main_window.get_current_url()
                main_window.run_js("setTimeout(() => location.assign('/api/health'), 0)")
                time.sleep(.25)
                restricted_navigation = (main_window.get_current_url() == workspace_page and
                                         main_window.evaluate_js("!!document.querySelector('#app')"))
                before_maximize = native_details(main_window)
                bridge.window_control('maximize')
                maximized_details = native_details(main_window)
                work_area_details = native_frame.metrics(main_window)
                bridge.window_control('maximize')
                bridge.window_control('minimize')
                main_window.restore()
                main_window.evaluate_js("window.reportWindowChrome?.()")
                time.sleep(.2)
                tray_metrics = {}
                if tray:
                    from System.Windows.Forms import Cursor
                    tray_metrics['registered'] = tray.notify.Visible and tray.notify.ContextMenuStrip == tray.menu
                    original = main_window.get_current_url()
                    # Exercise the OS close path, not just the WebView's custom button.
                    tray._invoke(tray.form.Close)
                    tray_metrics['native_close_hides'] = not tray.form.Visible and main_window in webview.windows
                    tray_metrics['backend_kept_alive'] = watchdog.poll() is None and not stop_file.exists()
                    tray._invoke(lambda: tray.menu.Show(Cursor.Position))
                    tray_metrics['context_menu_visible'] = tray.menu.Visible and len(tray.menu.Items) == 4
                    tray_metrics['hide_disabled_while_hidden'] = not tray.hide_item.Enabled
                    tray._invoke(tray.menu.Close)
                    tray._invoke(tray.open_item.PerformClick)
                    tray_metrics['menu_restores_workspace'] = tray.form.Visible and main_window.get_current_url() == original
                    tray._invoke(lambda: tray.menu.Show(Cursor.Position))
                    tray_metrics['hide_enabled_while_open'] = tray.hide_item.Enabled
                    tray._invoke(tray.hide_item.PerformClick)
                    tray._invoke(tray.menu.Close)
                    tray_metrics['menu_hides'] = not tray.form.Visible
                    tray._invoke(tray.open_item.PerformClick)
                    bridge.window_control('close')
                    tray_metrics['bridge_close_hides'] = not tray.form.Visible and extra.native.Visible
                    tray._invoke(tray.open_item.PerformClick)
                pointer_metrics = smoke_window_input(main_window, extra) if tray else {}
                if tray:
                    tray.restore()
                (data / 'desktop-smoke.json').write_text(json.dumps({
                    'loaded': True, 'url': url, 'policy_controls': controls,
                    'tray': tray_metrics,
                    'pointer': pointer_metrics,
                    'native_windows': len(webview.windows), 'loading': loading_metrics,
                    'single_window_start': loading_metrics.get('handle') == int(main_window.native.Handle.ToInt64()) and loading_metrics.get('windows') == 1,
                    'workspace_loaded': main_window.evaluate_js("!!document.querySelector('#app')"),
                    'restricted_navigation': restricted_navigation,
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
                def finish_smoke():
                    if tray:
                        tray._invoke(tray.quit_item.PerformClick)
                    else:
                        shutdown()
                threading.Timer(2, finish_smoke).start()

            extra.events.loaded += second_loaded

    def connect():
        nonlocal workspace_url
        if not connecting.acquire(blocking=False):
            return
        try:
            set_status('waiting', '正在唤醒工作空间')
            for _ in range(120):
                if closing.is_set():
                    return
                try:
                    value = json.loads(state_file.read_text(encoding='utf-8'))
                    if value['status'] == 'ready':
                        origin = workspace_origin(value['url'])
                        target = security_core.launch_url(origin + '/?desktop-loading=1', data)
                        set_status('loading', '正在载入你的工作空间')
                        workspace_url = origin
                        main_window.load_url(target)
                        return
                except (OSError, ValueError, KeyError):
                    pass
                time.sleep(.5)
        finally:
            connecting.release()
        set_status('failed', '连接尚未就绪，请重新连接')

    class Bridge:
        def __init__(self, origin=None, allow_loading=False):
            self._window = None
            self._maximized = False
            self._origin = origin
            self._allow_loading = allow_loading

        def _allows_page(self, url):
            return trusted_desktop_page(url, self._origin or workspace_url, self._allow_loading)

        def window_chrome(self, body):
            import math
            rect=body.get('maximize') if isinstance(body,dict) else None
            if not isinstance(rect,list) or len(rect)!=4 or any(type(n) not in (int,float) or not math.isfinite(n) or not 0<=n<=20000 for n in rect):raise ValueError('窗口区域无效')
            hook=getattr(self._window,'_native_frame',None)
            drag=body.get('drag',[])
            if not isinstance(drag,list) or len(drag)>16 or any(not isinstance(r,list) or len(r)!=4 or any(type(n) not in (int,float) or not math.isfinite(n) or not 0<=n<=20000 for n in r) for r in drag):raise ValueError('拖动区域无效')
            if hook:hook.maximize_rect=rect;hook.drag_rects=drag
            return {'ready':bool(hook), 'close_to_tray': bool(tray and self._window is main_window)}

        def window_drag(self):
            return native_frame.begin_drag(self._window)

        def window_control(self, action):
            if action not in ('minimize','maximize','close'):raise ValueError('窗口操作无效')
            owner = self._window
            if owner is None:return {'ready':False}
            if action == 'minimize':owner.minimize()
            elif action == 'close':
                if tray and owner is main_window:
                    tray.hide()
                else:
                    owner.destroy()
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

        def choose_project(self):
            owner = self._window or main_window
            selected = owner.create_file_dialog(webview.FileDialog.FOLDER)
            return selected[0] if selected else None

        def save_attachment(self, attachment_id):
            import attachments
            from System import Action
            owner = self._window
            if owner is None or not trusted_desktop_page(str(owner.get_current_url() or ''), self._origin or workspace_url):
                raise ValueError('只能从工作区保存附件')

            def choose_destination(name):
                selected = None

                def choose():
                    nonlocal selected
                    selected = owner.create_file_dialog(webview.FileDialog.SAVE, save_filename=name)

                # WebView bridge calls run on a worker; WinForms dialogs need the STA UI thread.
                if owner.native.InvokeRequired:
                    owner.native.Invoke(Action(choose))
                else:
                    choose()
                return selected

            return attachments.save_copy(data, attachment_id, choose_destination)

        def new_window(self, session=''):
            from urllib.parse import quote
            if not workspace_url:
                return False
            child_bridge = Bridge(workspace_url)
            child_bridge._window = webview.create_window(
                'AstraAgent', url=security_core.launch_url(workspace_url + '/?session=' + quote(str(session)),data),
                js_api=child_bridge, width=1180, height=820, min_size=(480, 480),
                frameless=True, easy_drag=False,
            )
            def child_loaded():
                native_frame.install(child_bridge._window)
                child_bridge._window.evaluate_js('window.reportWindowChrome?.()')
            child_bridge._window.events.loaded += child_loaded
            return True

    bridge = Bridge(allow_loading=True)
    main_window = webview.create_window(
        'AstraAgent', url=LOADING_URL, js_api=bridge,
        width=1320, height=900, min_size=(480, 480),
        background_color='#141416', frameless=True, easy_drag=False,
    )
    bridge._window = main_window

    def page_loaded():
        if closing.is_set() or transitioning.is_set():
            return
        if workspace_url:
            workspace_loaded()
            return
        native_frame.install(main_window)
        if args.smoke:
            loading_metrics.update(handle=int(main_window.native.Handle.ToInt64()),
                                   windows=len(webview.windows), visible=main_window.native.Visible)
        labels = {key: translate(text) for key, text in {
            'status': '正在唤醒工作空间', 'close': '关闭窗口', 'retry': '重新连接',
            'minimize': '最小化', 'maximize': '最大化或还原',
        }.items()}
        main_window.evaluate_js(f'window.configureWorkspaceLoading?.({json.dumps(labels)})')
        connect()

    main_window.events.loaded += page_loaded
    main_window.events.closed += shutdown
    try:
        webview.start(gui='edgechromium', icon=str(ICON), private_mode=False, storage_path=str(data / 'webview'))
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
