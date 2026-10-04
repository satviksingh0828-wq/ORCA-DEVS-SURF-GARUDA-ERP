from __future__ import annotations

import json
import ctypes
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from PySide6.QtCore import QObject, QTimer, Qt, Signal
from PySide6.QtGui import QAction, QColor, QGuiApplication, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import QApplication, QMenu, QMessageBox, QSystemTrayIcon, QWidgetAction

from agent import AgentServer
from settings import (
    APP_NAME,
    CONFIG_PATH,
    DEFAULT_ALLOWED_ORIGINS,
    FULL_TAGLINE,
    LOG_PATH,
    PROTOCOL_VERSION,
    resource_path,
)
from ui import (
    ConsentCard,
    MenuHeader,
    RemoteCursorOverlay,
    StatusWindow,
    ThemeManager,
    level_color,
    level_for_state,
    place_in_corner,
)


def build_tray_icon(level: str, theme_colors: dict[str, str]) -> QIcon:
    """ORCA badge icon; a coloured dot is added while waiting / sharing / error."""
    base = QPixmap(resource_path("assets/orca-tray.png"))
    icon = QIcon()
    for size in (16, 20, 24, 32, 48, 64):
        pm = base.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        if level in ("sharing", "waiting", "error"):
            p = QPainter(pm)
            p.setRenderHint(QPainter.RenderHint.Antialiasing)
            d = max(6, int(size * 0.42))
            p.setPen(QColor("#FFFFFF"))
            p.setBrush(QColor(theme_colors[level]))
            p.drawEllipse(size - d - 0, size - d - 0, d - 1, d - 1)
            p.end()
        icon.addPixmap(pm)
    return icon


class TrayApplication(QObject):
    stateChanged = Signal(str)
    approvalRequested = Signal(str, str, object, object)
    remoteCursorChanged = Signal(int, int, bool)

    def __init__(self, app: QApplication) -> None:
        super().__init__()
        self.app = app
        self.config = self._load_config()
        self.allowed_origins = self._validate_origins(self.config.get("allowed_origins", []))
        self.state = "Starting"
        self.autostart = self.config.get("start_with_windows", True) is True
        self._quitting = False
        self.icon: QSystemTrayIcon | None = None
        self.server = None
        self.server_thread: threading.Thread | None = None
        self._consent: ConsentCard | None = None

        self.themes = ThemeManager()
        self.window = StatusWindow(self.themes.theme)
        self.remote_cursor = RemoteCursorOverlay()
        self.window.stop_clicked.connect(self._stop_share)
        self.window.restart_clicked.connect(self._restart)
        self.window.quit_clicked.connect(self._quit)
        self.window.config_clicked.connect(self._open_config)
        self.window.log_clicked.connect(self._open_log)
        self.window.autostart_toggled.connect(self._toggle_autostart)
        self.window.switch.set_checked_silently(self.autostart)
        self.themes.changed.connect(self._on_theme)
        self.stateChanged.connect(self._apply_state)
        self.approvalRequested.connect(self._show_consent)
        self.remoteCursorChanged.connect(self._update_remote_cursor)

        try:
            self._set_windows_startup(self.autostart)
        except Exception:
            logging.exception("Could not update the Windows startup registration")
        self._start_server()
        QTimer.singleShot(100, self._start_tray_icon)

    def _load_config(self) -> dict[str, Any]:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            value = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}
            if not isinstance(value, dict):
                value = {}
        except Exception:
            logging.exception("Could not read config file %s", CONFIG_PATH)
            value = {}
        origins = self._validate_origins(value.get("allowed_origins", []))
        for origin in DEFAULT_ALLOWED_ORIGINS:
            if origin not in origins:
                origins.append(origin)
        value["allowed_origins"] = origins
        value["start_with_windows"] = value.get("start_with_windows") is not False
        try:
            temporary = CONFIG_PATH.with_suffix(".tmp")
            temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
            temporary.replace(CONFIG_PATH)
        except Exception:
            logging.exception("Could not save default config to %s", CONFIG_PATH)
        return value

    @staticmethod
    def _validate_origins(origins: Any) -> list[str]:
        if not isinstance(origins, list):
            return []
        valid: list[str] = []
        for item in origins:
            if not isinstance(item, str):
                continue
            origin = item.strip().rstrip("/")
            if not origin:
                continue
            try:
                parsed = urlsplit(origin)
                if origin == "https://*.orca.devs.surf":
                    if (
                        parsed.scheme == "https"
                        and parsed.hostname == "*.orca.devs.surf"
                        and parsed.port is None
                        and not parsed.path
                        and not parsed.query
                        and not parsed.fragment
                        and not parsed.username
                        and not parsed.password
                    ):
                        valid.append(origin)
                    continue
                if "*" in origin:
                    continue
                local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
                secure_web = parsed.scheme == "https" and bool(parsed.hostname)
                if (
                    (local_http or secure_web)
                    and not parsed.username
                    and not parsed.password
                    and not parsed.path
                    and not parsed.query
                    and not parsed.fragment
                ):
                    valid.append(origin)
            except ValueError:
                continue
        return sorted(set(valid))

    def _set_windows_startup(self, enabled: bool) -> None:
        if sys.platform != "win32":
            return
        import winreg

        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
        try:
            if enabled:
                command = f'"{Path(sys.executable).resolve()}"'
                winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, command)
            else:
                try:
                    winreg.DeleteValue(key, APP_NAME)
                except FileNotFoundError:
                    pass
        finally:
            winreg.CloseKey(key)

    def _save_config(self) -> None:
        self.config["allowed_origins"] = self.allowed_origins
        self.config["start_with_windows"] = self.autostart
        temporary = CONFIG_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.config, indent=2), encoding="utf-8")
        temporary.replace(CONFIG_PATH)

    def _start_server(self) -> None:
        self.server = AgentServer(
            allowed_origins=self.allowed_origins,
            status_callback=self._set_state,
            approval_callback=self._ask_for_approval,
            cursor_callback=self.remoteCursorChanged.emit,
        )

        def server_runner() -> None:
            import asyncio

            assert self.server is not None
            try:
                asyncio.run(self.server.run())
            except Exception:
                logging.exception("Agent server stopped unexpectedly")
                self._set_state("Agent server stopped — see agent.log")

        self.server_thread = threading.Thread(
            target=server_runner,
            name="orca-system-share-websocket",
            daemon=True,
        )
        self.server_thread.start()

    # ------------------------------------------------------------------ tray
    def _start_tray_icon(self) -> None:
        try:
            if not QSystemTrayIcon.isSystemTrayAvailable():
                raise RuntimeError("The Windows system tray is not available.")
            self.menu = QMenu()
            self.menu.setWindowFlags(
                self.menu.windowFlags() | Qt.WindowType.FramelessWindowHint | Qt.WindowType.NoDropShadowWindowHint
            )
            self.menu.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
            self.menu_header = MenuHeader()
            header_action = QWidgetAction(self.menu)
            header_action.setDefaultWidget(self.menu_header)
            self.menu.addAction(header_action)
            self.menu.addSeparator()
            self.act_open = self.menu.addAction("Open status window", self._show_control_window)
            self.act_stop = self.menu.addAction("Stop current share", self._stop_share)
            self.act_autostart = self.menu.addAction("Start with Windows")
            self.act_autostart.setCheckable(True)
            self.act_autostart.setChecked(self.autostart)
            self.act_autostart.triggered.connect(lambda checked: self._toggle_autostart(checked))
            self.act_config = self.menu.addAction("Open config file", self._open_config)
            self.act_log = self.menu.addAction("Open agent log", self._open_log)
            self.act_restart = self.menu.addAction("Restart agent", self._restart)
            self.menu.addSeparator()
            self.menu.addAction("Quit", self._quit)
            self.menu.aboutToShow.connect(self._refresh_tray)

            self.icon = QSystemTrayIcon(self._icon_for(self.state), self.app)
            self.icon.setContextMenu(self.menu)
            self.icon.activated.connect(self._on_tray_activated)
            self.icon.show()
            self._on_theme(self.themes.theme)
            QTimer.singleShot(1200, self._ensure_tray_visible)
            self._refresh_tray()
        except Exception as exc:
            logging.exception("Could not create the Windows tray icon")
            self._set_state("Tray icon failed — see agent.log")
            self._show_control_window(error=str(exc))

    def _ensure_tray_visible(self) -> None:
        if not self.icon:
            self._show_control_window(error="Windows did not create the tray icon.")
            return
        try:
            if not self.icon.isVisible():
                self.icon.show()
            self._refresh_tray()
        except Exception as exc:
            logging.exception("Could not make the tray icon visible")
            self._set_state("Tray icon failed — see agent.log")
            self._show_control_window(error=str(exc))

    def _on_tray_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            if self.window.isVisible():
                self.window.hide()
            else:
                self._show_control_window()

    def _icon_for(self, state: str) -> QIcon:
        t = self.themes.theme
        colors = {lvl: level_color(t, lvl) for lvl in ("sharing", "waiting", "error")}
        return build_tray_icon(level_for_state(state), colors)

    def _on_theme(self, theme: Any) -> None:
        self.window.set_theme(theme)
        if self._consent is not None:
            self._consent.set_theme(theme)
        if self.icon:
            from ui import build_qss

            self.menu.setStyleSheet(build_qss(theme))
            self.icon.setIcon(self._icon_for(self.state))
        self._refresh_tray()

    # ------------------------------------------------------------------ state
    def _set_state(self, state: str) -> None:
        # Safe to call from the asyncio thread: the queued signal runs on the GUI thread.
        self.stateChanged.emit(state)

    def _update_remote_cursor(self, x: int, y: int, visible: bool) -> None:
        if visible:
            self.remote_cursor.show_at(x, y)
        else:
            self.remote_cursor.hide_cursor()

    def _apply_state(self, state: str) -> None:
        self.state = state
        self._refresh_tray()

    def _refresh_tray(self) -> None:
        sharing = self._is_sharing()
        self.window.set_state(self.state, sharing)
        if not self.icon:
            return
        self.icon.setToolTip(f"{FULL_TAGLINE} — {self.state}"[:127])
        self.icon.setIcon(self._icon_for(self.state))
        self.menu_header.apply(self.themes.theme, self.state)
        self.act_stop.setEnabled(sharing)
        self.act_autostart.setChecked(self.autostart)

    def _is_sharing(self) -> bool:
        return bool(self.server and self.server.active_session_id)

    # ------------------------------------------------------------------ windows
    def _show_control_window(self, *_args: Any, error: str | None = None) -> None:
        self.window.set_error(error)
        self._refresh_tray()
        anchor = self.icon.geometry() if self.icon else None
        place_in_corner(self.window, anchor)
        self.window.show()
        self.window.raise_()
        self.window.activateWindow()

    def _error_box(self, text: str) -> None:
        box = QMessageBox(QMessageBox.Icon.Warning, APP_NAME, text)
        box.setWindowIcon(QIcon(resource_path("assets/orca-system-share.png")))
        box.exec()

    def _toggle_autostart(self, enabled: bool | None = None) -> None:
        if enabled is None:
            enabled = not self.autostart
        try:
            self._set_windows_startup(enabled)
            self.autostart = enabled
            self._save_config()
        except Exception as exc:
            logging.exception("Could not change the Windows startup setting")
            self._error_box(f"Could not update Start with Windows:\n{exc}")
        self.window.switch.set_checked_silently(self.autostart)
        self._refresh_tray()

    # ------------------------------------------------------------------ consent
    def _ask_for_approval(self, requester: str, session_id: str, loop: Any) -> Any:
        future = loop.create_future()
        self.approvalRequested.emit(requester, session_id, loop, future)
        return future

    def _show_consent(self, requester: str, session_id: str, loop: Any, future: Any) -> None:
        if self._quitting:
            loop.call_soon_threadsafe(self._complete_future, future, False)
            return

        def decide(accepted: bool) -> None:
            loop.call_soon_threadsafe(self._complete_future, future, accepted)
            self._consent = None

        card = ConsentCard(
            self.themes.theme,
            requester,
            decide=decide,
            is_stale=lambda: bool(future.done()),
            anchor=self.icon.geometry() if self.icon else None,
        )
        self._consent = card
        card.present()

    @staticmethod
    def _complete_future(future: Any, value: bool) -> None:
        if not future.done():
            future.set_result(value)

    def _stop_share(self, *_args: Any) -> None:
        if self.server:
            self.server.stop_active_from_tray()

    def _open_config(self, _icon: Any = None, _item: Any = None) -> None:
        try:
            if os.name == "nt":
                os.startfile(str(CONFIG_PATH))  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", str(CONFIG_PATH)])
        except Exception as exc:
            self._error_box(f"Could not open config file:\n{exc}")

    def _open_log(self, _icon: Any = None, _item: Any = None) -> None:
        try:
            LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            LOG_PATH.touch(exist_ok=True)
            if os.name == "nt":
                os.startfile(str(LOG_PATH))  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", str(LOG_PATH)])
        except Exception as exc:
            self._error_box(f"Could not open agent log:\n{exc}")

    def _restart(self, *_args: Any) -> None:
        self._quit(restart=True)

    def _quit(self, *_args: Any, restart: bool = False) -> None:
        if self._quitting:
            return
        self._quitting = True
        if self._consent is not None:
            self._consent.force_deny()
        if self.server:
            try:
                future = asyncio_run_coroutine_threadsafe(self.server.shutdown(), self.server.loop)
                if future:
                    future.result(timeout=2)
            except Exception:
                logging.debug("Could not stop server gracefully", exc_info=True)
        if self.icon:
            try:
                self.icon.hide()
            except Exception:
                pass
        self.remote_cursor.hide_cursor()
        if self.server_thread and self.server_thread.is_alive():
            self.server_thread.join(timeout=3)
        self.window.close()
        self.app.quit()
        if restart:
            try:
                args = [sys.executable, *sys.argv] if not getattr(sys, "frozen", False) else [sys.executable]
                subprocess.Popen(args, close_fds=True)
            except Exception:
                logging.exception("Could not restart the tray agent")

    def run(self) -> int:
        return self.app.exec()


def asyncio_run_coroutine_threadsafe(coro: Any, loop: Any) -> Any:
    import asyncio

    if loop is None or loop.is_closed():
        coro.close()
        return None
    return asyncio.run_coroutine_threadsafe(coro, loop)


def configure_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_PATH,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        encoding="utf-8",
    )


def enable_dpi_awareness() -> None:
    """Use physical display pixels so mss capture and mouse coordinates agree."""
    try:
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return
    except Exception:
        pass
    try:
        if ctypes.windll.shcore.SetProcessDpiAwareness(2) == 0:
            return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        logging.debug("Could not enable Windows DPI awareness", exc_info=True)


def configure_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_PATH,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        encoding="utf-8",
    )


def enable_dpi_awareness() -> None:
    """Use physical display pixels so mss capture and mouse coordinates agree."""
    try:
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return
    except Exception:
        pass
    try:
        if ctypes.windll.shcore.SetProcessDpiAwareness(2) == 0:
            return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        logging.debug("Could not enable Windows DPI awareness", exc_info=True)


def main() -> None:
    if sys.platform != "win32":
        print(f"{APP_NAME} is a Windows-only tray application.")
        raise SystemExit(2)
    enable_dpi_awareness()
    configure_logging()
    logging.info("Starting %s, protocol v%s", APP_NAME, PROTOCOL_VERSION)
    try:  # group the tray app under its own identity (icon/notifications)
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("OrcaDevsSurf.SystemShare")
    except Exception:
        pass
    os.environ.setdefault("QT_LOGGING_RULES", "qt.qpa.window=false")
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setStyle("Fusion")
    app.setQuitOnLastWindowClosed(False)  # tray service: never exits when a window closes
    app.setWindowIcon(QIcon(resource_path("assets/orca-system-share.png")))
    tray_app = TrayApplication(app)
    raise SystemExit(tray_app.run())


if __name__ == "__main__":
    main()
