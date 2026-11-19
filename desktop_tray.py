"""Native Windows notification icon for the primary desktop window."""
import threading


class DesktopTray:
    def __init__(self, window, icon_path, translate, shutdown, is_closing):
        from System import Action
        from System.Drawing import Icon
        from System.Windows.Forms import (
            CloseReason, ContextMenuStrip, FormWindowState, MouseButtons,
            NotifyIcon, ToolStripMenuItem, ToolStripSeparator,
        )

        self.form = form = window.native
        self.notify = self.menu = self.icon = None

        def install():
            try:
                self.icon = Icon(str(icon_path))
                self.menu = ContextMenuStrip()
                self.menu.ShowImageMargin = False
                self.menu.ShowCheckMargin = False
                self.open_item = ToolStripMenuItem(translate('打开主窗口'))
                self.hide_item = ToolStripMenuItem(translate('隐藏到托盘'))
                self.quit_item = ToolStripMenuItem(translate('退出 AstraAgent'))
                self.open_item.Click += lambda *_: self.restore()
                self.hide_item.Click += lambda *_: self.hide()
                # pywebview destroys its windows from a worker, not from the menu handler.
                self.quit_item.Click += lambda *_: threading.Thread(target=shutdown, daemon=True).start()
                for item in (self.open_item, self.hide_item, ToolStripSeparator(), self.quit_item):
                    self.menu.Items.Add(item)
                self.menu.Opening += self._menu_opening
                self.notify = NotifyIcon()
                self.notify.Icon = self.icon
                self.notify.Text = 'AstraAgent'
                self.notify.ContextMenuStrip = self.menu
                self.notify.MouseDoubleClick += self._double_click
                self.notify.Visible = True
                form.FormClosing += self._closing
                form.Disposed += lambda *_: self._dispose()
            except Exception:
                self._dispose()
                raise

        self._invoke = lambda work: form.Invoke(Action(work)) if form.InvokeRequired else work()
        self._minimized = FormWindowState.Minimized
        self._normal = FormWindowState.Normal
        self._user_closing = CloseReason.UserClosing
        self._left_button = MouseButtons.Left
        self._is_closing = is_closing
        self._invoke(install)

    def _menu_opening(self, *_):
        self.hide_item.Enabled = self.form.Visible

    def _double_click(self, _sender, event):
        if event.Button == self._left_button:
            self.restore()

    def _closing(self, _sender, event):
        # Alt+F4 uses UserClosing; Windows logoff and shutdown still close normally.
        if not event.Cancel and event.CloseReason == self._user_closing and not self._is_closing():
            self.hide()
            event.Cancel = True

    def hide(self):
        def action():
            if not self._is_closing():
                self.form.Hide()
        self._invoke(action)

    def restore(self):
        def action():
            if self._is_closing():
                return
            self.form.Show()
            if self.form.WindowState == self._minimized:
                self.form.WindowState = self._normal
            self.form.Activate()
        self._invoke(action)

    def _dispose(self):
        if self.notify is not None:
            self.notify.Visible = False
            self.notify.Dispose()
            self.notify = None
        if self.menu is not None:
            self.menu.Dispose()
            self.menu = None
        if self.icon is not None:
            self.icon.Dispose()
            self.icon = None

    def dispose(self):
        if not self.form.IsDisposed:
            self._invoke(self._dispose)
