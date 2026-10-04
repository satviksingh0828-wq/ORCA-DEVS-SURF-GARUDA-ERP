"""Qt user interface for the ORCA DEVS SURF system screen share service.

Pure presentation: no protocol, capture, or input logic lives here.
"""
from __future__ import annotations

import html
import ctypes
import sys
import time
from dataclasses import dataclass
from typing import Callable

from PySide6.QtCore import (
    QEasingCurve,
    QParallelAnimationGroup,
    QPoint,
    QPropertyAnimation,
    QRect,
    QRectF,
    Qt,
    QTimer,
    QVariantAnimation,
    Signal,
    QObject,
)
from PySide6.QtGui import (
    QColor,
    QFont,
    QGuiApplication,
    QLinearGradient,
    QPainter,
    QPainterPath,
    QPen,
    QPixmap,
    QRadialGradient,
)
from PySide6.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from settings import (
    DISPLAY_NAME,
    HOST,
    PORT,
    PROTOCOL_VERSION,
    SERVICE_SUBTITLE,
    SERVICE_TITLE,
    resource_path,
)

FONT_FAMILIES = ["Segoe UI Variable Text", "Segoe UI", "Inter", "Arial"]


# --------------------------------------------------------------------------- #
# Theme (automatic light / dark that follows Windows)
# --------------------------------------------------------------------------- #
def _c(hex_: str, alpha: float = 1.0) -> QColor:
    color = QColor(hex_)
    color.setAlphaF(max(0.0, min(1.0, alpha)))
    return color


def _rgba(hex_: str, alpha: float) -> str:
    color = QColor(hex_)
    return f"rgba({color.red()},{color.green()},{color.blue()},{int(alpha * 255)})"


@dataclass(frozen=True)
class Theme:
    name: str
    dark: bool
    bg_top: str
    bg_bottom: str
    panel_alpha: float
    border: str
    border_a: float
    text: str
    sub: str
    surface: str
    surface_a: float
    hover_a: float
    accent: str
    accent_hi: str
    on_accent: str
    ok: str
    warn: str
    danger: str
    glow: str
    glow_a: float
    shadow_a: float
    menu_bg: str


DARK = Theme(
    name="dark", dark=True,
    bg_top="#0F2547", bg_bottom="#050D1E", panel_alpha=0.97,
    border="#FFFFFF", border_a=0.11,
    text="#EAF2FF", sub="#8EA5C8",
    surface="#FFFFFF", surface_a=0.06, hover_a=0.12,
    accent="#38BDF8", accent_hi="#22D3EE", on_accent="#04101F",
    ok="#34D399", warn="#FBBF24", danger="#FB7185",
    glow="#38BDF8", glow_a=0.18, shadow_a=0.55,
    menu_bg="#0B1A33",
)

LIGHT = Theme(
    name="light", dark=False,
    bg_top="#FFFFFF", bg_bottom="#E3ECF9", panel_alpha=0.98,
    border="#0B2A5B", border_a=0.13,
    text="#0B1A33", sub="#51668C",
    surface="#0B2A5B", surface_a=0.05, hover_a=0.10,
    accent="#0284C7", accent_hi="#0EA5E9", on_accent="#FFFFFF",
    ok="#059669", warn="#B45309", danger="#E11D48",
    glow="#0EA5E9", glow_a=0.16, shadow_a=0.28,
    menu_bg="#FFFFFF",
)


class ThemeManager(QObject):
    """Follows the Windows 'app mode' (light/dark) setting and re-themes live."""

    changed = Signal(object)

    def __init__(self) -> None:
        super().__init__()
        self.theme = DARK if self._system_is_dark() else LIGHT
        hints = QGuiApplication.styleHints()
        try:
            hints.colorSchemeChanged.connect(lambda _scheme: self.refresh())
        except Exception:
            pass
        # Safety net for Qt builds / Windows versions that don't emit the signal.
        self._timer = QTimer(self)
        self._timer.setInterval(4000)
        self._timer.timeout.connect(self.refresh)
        self._timer.start()

    @staticmethod
    def _system_is_dark() -> bool:
        try:
            scheme = QGuiApplication.styleHints().colorScheme()
            if scheme == Qt.ColorScheme.Dark:
                return True
            if scheme == Qt.ColorScheme.Light:
                return False
        except Exception:
            pass
        if sys.platform == "win32":
            try:
                import winreg

                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                ) as key:
                    return winreg.QueryValueEx(key, "AppsUseLightTheme")[0] == 0
            except Exception:
                pass
        return True

    def refresh(self) -> None:
        wanted = DARK if self._system_is_dark() else LIGHT
        if wanted.name != self.theme.name:
            self.theme = wanted
            self.changed.emit(wanted)


def build_qss(t: Theme) -> str:
    return f"""
    QWidget {{ color:{t.text}; font-family:'Segoe UI Variable Text','Segoe UI','Inter',sans-serif; }}
    QLabel {{ background:transparent; }}
    QLabel#title {{ color:{t.text}; }}
    QLabel#subtitle {{ color:{t.accent}; }}
    QLabel#caption {{ color:{t.sub}; }}
    QLabel#error {{ color:{t.danger}; }}
    QFrame#card {{ background:{_rgba(t.surface, t.surface_a)}; border:1px solid {_rgba(t.border, t.border_a)}; border-radius:16px; }}
    QFrame#card QLabel {{ background:transparent; border:none; }}
    QPushButton {{ border-radius:12px; padding:10px 16px; font-weight:600; border:1px solid transparent; }}
    QPushButton#primary {{
        color:{t.on_accent}; border:none;
        background:qlineargradient(x1:0,y1:0,x2:1,y2:1, stop:0 {t.accent}, stop:1 {t.accent_hi});
    }}
    QPushButton#primary:hover {{ background:qlineargradient(x1:0,y1:0,x2:1,y2:1, stop:0 {t.accent_hi}, stop:1 {t.accent}); }}
    QPushButton#ghost {{ color:{t.text}; background:{_rgba(t.surface, t.surface_a)}; border:1px solid {_rgba(t.border, t.border_a)}; }}
    QPushButton#ghost:hover {{ background:{_rgba(t.surface, t.hover_a)}; }}
    QPushButton#danger {{ color:{t.danger}; background:{_rgba(t.danger, 0.13)}; border:1px solid {_rgba(t.danger, 0.40)}; }}
    QPushButton#danger:hover {{ background:{_rgba(t.danger, 0.22)}; }}
    QPushButton#danger:disabled {{ color:{t.sub}; background:{_rgba(t.surface, t.surface_a)}; border:1px solid {_rgba(t.border, t.border_a)}; }}
    QPushButton#link {{ color:{t.sub}; background:transparent; border:none; padding:6px 10px; font-weight:500; }}
    QPushButton#link:hover {{ color:{t.text}; background:{_rgba(t.surface, t.surface_a)}; }}
    QPushButton#close {{ color:{t.sub}; background:transparent; border:none; padding:0px; border-radius:14px; font-size:15px; }}
    QPushButton#close:hover {{ color:{t.text}; background:{_rgba(t.surface, t.hover_a)}; }}
    QProgressBar#countdown {{ background:{_rgba(t.surface, t.hover_a)}; border:none; border-radius:3px; max-height:6px; min-height:6px; }}
    QProgressBar#countdown::chunk {{ background:{t.accent}; border-radius:3px; }}
    QMenu {{ background:{t.menu_bg}; border:1px solid {_rgba(t.border, t.border_a + 0.04)}; border-radius:14px; padding:6px; }}
    QMenu::item {{ padding:8px 18px 8px 12px; border-radius:8px; margin:1px 2px; color:{t.text}; }}
    QMenu::item:selected {{ background:{_rgba(t.surface, t.hover_a)}; }}
    QMenu::item:disabled {{ color:{t.sub}; }}
    QMenu::separator {{ height:1px; background:{_rgba(t.border, t.border_a)}; margin:6px 8px; }}
    QMenu::indicator {{ width:14px; height:14px; margin-left:6px; border-radius:4px; }}
    QMenu::indicator:unchecked {{ border:1px solid {t.sub}; }}
    QMenu::indicator:checked {{ background:{t.accent}; border:1px solid {t.accent}; }}
    """


def _font(size_px: int, weight: QFont.Weight = QFont.Weight.Normal, spacing: float = 0.0) -> QFont:
    font = QFont()
    font.setFamilies(FONT_FAMILIES)
    font.setPixelSize(size_px)
    font.setWeight(weight)
    if spacing:
        font.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, spacing)
    return font


# --------------------------------------------------------------------------- #
# Status levels
# --------------------------------------------------------------------------- #
def level_for_state(state: str) -> str:
    """Map the agent's status text to a colour level (display only)."""
    low = state.lower()
    if low.startswith("sharing"):
        return "sharing"
    if low.startswith("waiting"):
        return "waiting"
    if any(word in low for word in ("failed", "error", "could not", "setup required", "stopped")):
        return "error"
    if low.startswith("ready"):
        return "ready"
    return "idle"


def level_color(t: Theme, level: str) -> str:
    return {
        "ready": t.ok,
        "sharing": "#EF4444",
        "waiting": t.warn,
        "error": t.danger,
    }.get(level, t.sub)


# --------------------------------------------------------------------------- #
# Small custom widgets
# --------------------------------------------------------------------------- #
class LogoBadge(QWidget):
    """The ORCA logo on a navy badge — identical in light and dark mode."""

    _logo: QPixmap | None = None

    def __init__(self, size: int = 56) -> None:
        super().__init__()
        self.setFixedSize(size, size)
        if LogoBadge._logo is None:
            LogoBadge._logo = QPixmap(resource_path("assets/orca-logo-solid.png"))

    def paintEvent(self, _event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHints(QPainter.RenderHint.Antialiasing | QPainter.RenderHint.SmoothPixmapTransform)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        radius = rect.width() * 0.26
        grad = QLinearGradient(rect.topLeft(), rect.bottomRight())
        grad.setColorAt(0, QColor("#14305C"))
        grad.setColorAt(1, QColor("#060E22"))
        p.setPen(QPen(_c("#38BDF8", 0.45), 1))
        p.setBrush(grad)
        p.drawRoundedRect(rect, radius, radius)
        if LogoBadge._logo and not LogoBadge._logo.isNull():
            pad = rect.width() * 0.13
            target = rect.adjusted(pad, pad, -pad, -pad)
            p.drawPixmap(target.toRect(), LogoBadge._logo)


class StatusDot(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setFixedSize(22, 22)
        self.color = QColor("#8EA5C8")
        self.pulse = False
        self._phase = 0.0

    def set_color(self, color: str, pulse: bool) -> None:
        self.color = QColor(color)
        self.pulse = pulse
        self.update()

    def tick(self) -> None:
        self._phase = (self._phase + 0.06) % 1.0
        if self.pulse:
            self.update()

    def paintEvent(self, _event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        center = QRectF(self.rect()).center()
        import math

        k = (math.sin(self._phase * 2 * math.pi) + 1) / 2 if self.pulse else 0.35
        glow = QRadialGradient(center, 11)
        c1 = QColor(self.color); c1.setAlphaF(0.20 + 0.45 * k)
        c0 = QColor(self.color); c0.setAlphaF(0.0)
        glow.setColorAt(0.35, c1)
        glow.setColorAt(1.0, c0)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(glow)
        p.drawEllipse(center, 11, 11)
        p.setBrush(self.color)
        p.drawEllipse(center, 5, 5)


class Switch(QCheckBox):
    def __init__(self) -> None:
        super().__init__()
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedSize(46, 26)
        self._pos = 0.0
        self._on = QColor("#38BDF8")
        self._off = QColor("#8EA5C8")
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(140)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._set_pos)
        self.toggled.connect(self._animate)

    def set_colors(self, on: str, off: str) -> None:
        self._on, self._off = QColor(on), QColor(off)
        self.update()

    def set_checked_silently(self, value: bool) -> None:
        self.blockSignals(True)
        self.setChecked(value)
        self.blockSignals(False)
        self._pos = 1.0 if value else 0.0
        self.update()

    def _set_pos(self, value) -> None:
        self._pos = float(value)
        self.update()

    def _animate(self, checked: bool) -> None:
        self._anim.stop()
        self._anim.setStartValue(self._pos)
        self._anim.setEndValue(1.0 if checked else 0.0)
        self._anim.start()

    def hitButton(self, _pos) -> bool:  # noqa: N802
        return True

    def paintEvent(self, _event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        track = QColor(self._off)
        track.setAlphaF(0.35)
        on = QColor(self._on)
        mix = QColor(
            int(track.red() + (on.red() - track.red()) * self._pos),
            int(track.green() + (on.green() - track.green()) * self._pos),
            int(track.blue() + (on.blue() - track.blue()) * self._pos),
            int(track.alpha() + (255 - track.alpha()) * self._pos),
        )
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(mix)
        p.drawRoundedRect(r, r.height() / 2, r.height() / 2)
        d = r.height() - 6
        x = r.left() + 3 + (r.width() - d - 6) * self._pos
        p.setBrush(QColor("#FFFFFF"))
        p.drawEllipse(QRectF(x, r.top() + 3, d, d))


# --------------------------------------------------------------------------- #
# Glass panel base (frameless, translucent, soft shadow, ocean glow)
# --------------------------------------------------------------------------- #
class GlassPanel(QWidget):
    RADIUS = 22
    MARGIN = 22  # transparent margin that hosts the drop shadow

    def __init__(self, theme: Theme, always_on_top: bool = True) -> None:
        flags = Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint
        if always_on_top:
            flags |= Qt.WindowType.WindowStaysOnTopHint
        super().__init__(None, flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.theme = theme
        self.drag_height = 0
        outer = QVBoxLayout(self)
        outer.setContentsMargins(self.MARGIN, self.MARGIN, self.MARGIN, self.MARGIN)
        self.body = QWidget()
        outer.addWidget(self.body)
        self.set_theme(theme)

    def set_theme(self, theme: Theme) -> None:
        self.theme = theme
        self.setStyleSheet(build_qss(theme))
        self.on_theme(theme)
        self.update()

    def on_theme(self, theme: Theme) -> None:  # hook
        pass

    def paintEvent(self, _event) -> None:  # noqa: N802
        t = self.theme
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        m = self.MARGIN
        r = QRectF(self.rect()).adjusted(m, m, -m, -m)
        p.setBrush(Qt.BrushStyle.NoBrush)
        for i in range(m):
            falloff = (1 - i / m) ** 2.4
            p.setPen(QPen(_c("#000000", t.shadow_a * 0.16 * falloff), 1.4))
            p.drawRoundedRect(r.adjusted(-i, -i + 4, i, i + 4), self.RADIUS + i, self.RADIUS + i)
        path = QPainterPath()
        path.addRoundedRect(r, self.RADIUS, self.RADIUS)
        grad = QLinearGradient(r.topLeft(), r.bottomLeft())
        grad.setColorAt(0, _c(t.bg_top, t.panel_alpha))
        grad.setColorAt(1, _c(t.bg_bottom, t.panel_alpha))
        p.fillPath(path, grad)
        p.save()
        p.setClipPath(path)
        glow = QRadialGradient(r.topRight() + QPoint(-30, 10), r.width() * 0.75)
        glow.setColorAt(0, _c(t.glow, t.glow_a))
        glow.setColorAt(1, _c(t.glow, 0.0))
        p.fillRect(r, glow)
        # faint wave lines along the bottom edge: a subtle ocean cue
        wave = QPainterPath()
        base = r.bottom() - 9
        wave.moveTo(r.left(), base)
        for step in range(0, int(r.width()) + 40, 40):
            x = r.left() + step
            wave.quadTo(x + 10, base - 9, x + 20, base)
            wave.quadTo(x + 30, base + 9, x + 40, base)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(_c(t.glow, 0.10 if t.dark else 0.12), 1.2))
        p.drawPath(wave)
        p.translate(0, 9)
        p.setPen(QPen(_c(t.glow, 0.06 if t.dark else 0.07), 1.2))
        p.drawPath(wave)
        p.restore()
        p.setPen(QPen(_c(t.border, t.border_a + 0.04), 1))
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPath(path)

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if (
            event.button() == Qt.MouseButton.LeftButton
            and event.position().y() < self.MARGIN + self.drag_height
            and self.windowHandle()
        ):
            self.windowHandle().startSystemMove()
        super().mousePressEvent(event)


def place_in_corner(panel: QWidget, anchor: QRect | None = None, margin: int = 12) -> None:
    """Dock a panel by the system tray (or bottom-right) inside the work area."""
    screen = None
    if anchor is not None and not anchor.isEmpty():
        screen = QGuiApplication.screenAt(anchor.center())
    screen = screen or QGuiApplication.primaryScreen()
    avail = screen.availableGeometry()
    panel.adjustSize()
    w, h = panel.width(), panel.height()
    m = GlassPanel.MARGIN
    right = True
    bottom = True
    if anchor is not None and not anchor.isEmpty():
        right = anchor.center().x() >= avail.center().x()
        bottom = anchor.center().y() >= avail.center().y()
    x = avail.right() - w + m - margin if right else avail.left() - m + margin
    y = avail.bottom() - h + m - margin if bottom else avail.top() - m + margin
    panel.move(x, y)


class RemoteCursorOverlay(QWidget):
    """A click-through red pointer shown locally while a remote user controls the desktop."""

    def __init__(self) -> None:
        flags = (
            Qt.WindowType.Tool
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.WindowDoesNotAcceptFocus
            | Qt.WindowType.WindowTransparentForInput
        )
        super().__init__(None, flags)
        self.setFixedSize(28, 34)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self._capture_exclusion_attempted = False
        self.hide()

    def show_at(self, x: int, y: int) -> None:
        self.move(x, y)
        if not self.isVisible():
            self.show()
        self.raise_()

    def hide_cursor(self) -> None:
        self.hide()

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        if self._capture_exclusion_attempted or sys.platform != "win32":
            return
        self._capture_exclusion_attempted = True
        try:
            user32 = ctypes.windll.user32
            user32.SetWindowDisplayAffinity.argtypes = [ctypes.c_void_p, ctypes.c_uint]
            user32.SetWindowDisplayAffinity.restype = ctypes.c_bool
            user32.SetWindowDisplayAffinity(ctypes.c_void_p(int(self.winId())), 0x00000011)
        except Exception:
            # On older Windows builds the pointer remains visible; the web UI also
            # draws the remote cursor over the shared desktop stream.
            pass

    def paintEvent(self, _event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        cursor = QPainterPath()
        cursor.moveTo(1, 1)
        cursor.lineTo(1, 25)
        cursor.lineTo(7, 19)
        cursor.lineTo(11.5, 29)
        cursor.lineTo(15, 27.5)
        cursor.lineTo(10.5, 18)
        cursor.lineTo(20.5, 18)
        cursor.closeSubpath()

        shadow = QPainterPath(cursor)
        shadow.translate(1, 1)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.setPen(QPen(QColor(0, 0, 0, 185), 3, Qt.PenStyle.SolidLine,
                            Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
        painter.drawPath(shadow)
        painter.setBrush(QColor("#DC2626"))
        painter.setPen(QPen(QColor("#FFFFFF"), 1.5, Qt.PenStyle.SolidLine,
                            Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
        painter.drawPath(cursor)
        painter.end()


# --------------------------------------------------------------------------- #
# Main status window (opened from the tray)
# --------------------------------------------------------------------------- #
class StatusWindow(GlassPanel):
    stop_clicked = Signal()
    restart_clicked = Signal()
    quit_clicked = Signal()
    config_clicked = Signal()
    log_clicked = Signal()
    autostart_toggled = Signal(bool)

    def __init__(self, theme: Theme) -> None:
        super().__init__(theme)
        self.setWindowTitle(f"{DISPLAY_NAME} — {SERVICE_TITLE}")
        self.setFixedWidth(470)
        self.drag_height = 96

        lay = QVBoxLayout(self.body)
        lay.setContentsMargins(24, 20, 24, 18)
        lay.setSpacing(14)

        # header
        head = QHBoxLayout()
        head.setSpacing(14)
        head.addWidget(LogoBadge(60), 0, Qt.AlignmentFlag.AlignTop)
        titles = QVBoxLayout()
        titles.setSpacing(2)
        self.brand = QLabel(DISPLAY_NAME)
        self.brand.setObjectName("subtitle")
        self.brand.setFont(_font(11, QFont.Weight.DemiBold, 2.2))
        self.title = QLabel(SERVICE_TITLE)
        self.title.setObjectName("title")
        self.title.setFont(_font(17, QFont.Weight.Bold, 0.4))
        self.title.setWordWrap(True)
        self.subtitle = QLabel(SERVICE_SUBTITLE)
        self.subtitle.setObjectName("caption")
        self.subtitle.setFont(_font(11, QFont.Weight.DemiBold, 1.6))
        titles.addWidget(self.brand)
        titles.addWidget(self.title)
        titles.addWidget(self.subtitle)
        head.addLayout(titles, 1)
        close = QPushButton("✕")
        close.setObjectName("close")
        close.setFixedSize(28, 28)
        close.setCursor(Qt.CursorShape.PointingHandCursor)
        close.clicked.connect(self.hide)
        head.addWidget(close, 0, Qt.AlignmentFlag.AlignTop)
        lay.addLayout(head)

        # status card
        self.status_card = QFrame()
        self.status_card.setObjectName("card")
        sc = QHBoxLayout(self.status_card)
        sc.setContentsMargins(14, 14, 16, 14)
        sc.setSpacing(10)
        self.dot = StatusDot()
        sc.addWidget(self.dot, 0, Qt.AlignmentFlag.AlignTop)
        col = QVBoxLayout()
        col.setSpacing(3)
        cap = QLabel("STATUS")
        cap.setObjectName("caption")
        cap.setFont(_font(10, QFont.Weight.DemiBold, 1.8))
        self.status_text = QLabel("Starting")
        self.status_text.setFont(_font(14, QFont.Weight.DemiBold))
        self.status_text.setWordWrap(True)
        self.status_text.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        col.addWidget(cap)
        col.addWidget(self.status_text)
        sc.addLayout(col, 1)
        lay.addWidget(self.status_card)

        self.error_label = QLabel("")
        self.error_label.setObjectName("error")
        self.error_label.setFont(_font(12))
        self.error_label.setWordWrap(True)
        self.error_label.hide()
        lay.addWidget(self.error_label)

        # actions
        actions = QHBoxLayout()
        actions.setSpacing(10)
        self.stop_btn = QPushButton("Stop sharing")
        self.stop_btn.setObjectName("danger")
        self.stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.stop_btn.clicked.connect(self.stop_clicked)
        self.restart_btn = QPushButton("Restart agent")
        self.restart_btn.setObjectName("ghost")
        self.restart_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.restart_btn.clicked.connect(self.restart_clicked)
        actions.addWidget(self.stop_btn, 1)
        actions.addWidget(self.restart_btn, 1)
        lay.addLayout(actions)

        # settings card
        self.settings_card = QFrame()
        self.settings_card.setObjectName("card")
        st = QVBoxLayout(self.settings_card)
        st.setContentsMargins(16, 12, 12, 10)
        st.setSpacing(6)
        row = QHBoxLayout()
        labels = QVBoxLayout()
        labels.setSpacing(1)
        lab = QLabel("Start with Windows")
        lab.setFont(_font(13, QFont.Weight.DemiBold))
        hint = QLabel("Launch quietly in the system tray at sign-in")
        hint.setObjectName("caption")
        hint.setFont(_font(11))
        labels.addWidget(lab)
        labels.addWidget(hint)
        row.addLayout(labels, 1)
        self.switch = Switch()
        self.switch.toggled.connect(self.autostart_toggled)
        row.addWidget(self.switch, 0, Qt.AlignmentFlag.AlignVCenter)
        st.addLayout(row)
        links = QHBoxLayout()
        links.setSpacing(4)
        cfg = QPushButton("Config file")
        cfg.setObjectName("link")
        cfg.setCursor(Qt.CursorShape.PointingHandCursor)
        cfg.clicked.connect(self.config_clicked)
        log = QPushButton("Agent log")
        log.setObjectName("link")
        log.setCursor(Qt.CursorShape.PointingHandCursor)
        log.clicked.connect(self.log_clicked)
        links.addWidget(cfg)
        links.addWidget(log)
        links.addStretch(1)
        st.addLayout(links)
        lay.addWidget(self.settings_card)

        # footer
        foot = QHBoxLayout()
        self.footer = QLabel(f"Local only · {HOST}:{PORT} · protocol v{PROTOCOL_VERSION}")
        self.footer.setObjectName("caption")
        self.footer.setFont(_font(11))
        quit_btn = QPushButton("Quit")
        quit_btn.setObjectName("link")
        quit_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        quit_btn.clicked.connect(self.quit_clicked)
        foot.addWidget(self.footer, 1)
        foot.addWidget(quit_btn)
        lay.addLayout(foot)

        self._level = "idle"
        self._pulse = QTimer(self)
        self._pulse.setInterval(33)
        self._pulse.timeout.connect(self.dot.tick)
        self.on_theme(theme)

    def on_theme(self, theme: Theme) -> None:
        if hasattr(self, "switch"):
            self.switch.set_colors(theme.accent, theme.sub)
            self.set_level(self._level)

    def set_level(self, level: str) -> None:
        self._level = level
        pulsing = level in ("sharing", "waiting")
        self.dot.set_color(level_color(self.theme, level), pulsing)
        if pulsing:
            self._pulse.start()
        else:
            self._pulse.stop()

    def set_state(self, state: str, sharing_active: bool) -> None:
        self.status_text.setText(state)
        # reserve enough height for wrapped status text so it never clips
        metrics = self.status_text.fontMetrics()
        wrapped = metrics.boundingRect(QRect(0, 0, 300, 10000), int(Qt.TextFlag.TextWordWrap), state)
        self.status_text.setMinimumHeight(wrapped.height() + 2)
        self.set_level(level_for_state(state))
        if self.isVisible():
            self.adjustSize()
        self.stop_btn.setEnabled(sharing_active)

    def set_error(self, text: str | None) -> None:
        if text:
            self.error_label.setText(f"Tray icon problem: {text}\nSee the agent log for details.")
            self.error_label.show()
        else:
            self.error_label.hide()

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Escape:
            self.hide()
        else:
            super().keyPressEvent(event)


# --------------------------------------------------------------------------- #
# Consent card popup (Allow / Deny) shown near the tray
# --------------------------------------------------------------------------- #
class ConsentCard(GlassPanel):
    TIMEOUT_SECONDS = 120  # matches the agent's approval timeout (display only)

    def __init__(
        self,
        theme: Theme,
        requester: str,
        decide: Callable[[bool], None],
        is_stale: Callable[[], bool],
        anchor: QRect | None = None,
    ) -> None:
        super().__init__(theme)
        self._decide = decide
        self._is_stale = is_stale
        self._anchor = anchor
        self._finished = False
        self.setWindowTitle(f"{DISPLAY_NAME} — Screen share request")
        self.setFixedWidth(430)
        self.drag_height = 70

        lay = QVBoxLayout(self.body)
        lay.setContentsMargins(24, 22, 24, 20)
        lay.setSpacing(14)

        head = QHBoxLayout()
        head.setSpacing(12)
        head.addWidget(LogoBadge(46))
        col = QVBoxLayout()
        col.setSpacing(1)
        brand = QLabel(DISPLAY_NAME)
        brand.setObjectName("subtitle")
        brand.setFont(_font(10, QFont.Weight.DemiBold, 2.0))
        title = QLabel("Screen share request")
        title.setObjectName("title")
        title.setFont(_font(18, QFont.Weight.Bold))
        col.addWidget(brand)
        col.addWidget(title)
        head.addLayout(col, 1)
        lay.addLayout(head)

        who = QLabel(
            f"<b>{html.escape(requester)}</b> is requesting access to this Windows desktop."
        )
        who.setFont(_font(14))
        who.setWordWrap(True)
        who.setTextFormat(Qt.TextFormat.RichText)
        lay.addWidget(who)

        card = QFrame()
        card.setObjectName("card")
        cl = QVBoxLayout(card)
        cl.setContentsMargins(16, 12, 16, 12)
        cl.setSpacing(7)
        for text in (
            "View your primary screen",
            "Send mouse and keyboard input",
            "Tray indicator stays on · stop any time",
        ):
            line = QLabel(f"●  {text}")
            line.setFont(_font(12))
            line.setWordWrap(True)
            cl.addWidget(line)
        lay.addWidget(card)

        self.countdown_label = QLabel("")
        self.countdown_label.setObjectName("caption")
        self.countdown_label.setFont(_font(11))
        self.bar = QProgressBar()
        self.bar.setObjectName("countdown")
        self.bar.setTextVisible(False)
        self.bar.setRange(0, 1000)
        self.bar.setValue(1000)
        lay.addWidget(self.countdown_label)
        lay.addWidget(self.bar)

        buttons = QHBoxLayout()
        buttons.setSpacing(10)
        self.deny_btn = QPushButton("Deny")
        self.deny_btn.setObjectName("ghost")
        self.deny_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.deny_btn.clicked.connect(lambda: self._finish(False))
        self.allow_btn = QPushButton("Allow this session")
        self.allow_btn.setObjectName("primary")
        self.allow_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.allow_btn.clicked.connect(lambda: self._finish(True))
        buttons.addWidget(self.deny_btn, 1)
        buttons.addWidget(self.allow_btn, 2)
        lay.addLayout(buttons)

        self._started = time.monotonic()
        self._timer = QTimer(self)
        self._timer.setInterval(250)
        self._timer.timeout.connect(self._tick)
        self._timer.start()
        self._tick()

    def present(self) -> None:
        place_in_corner(self, self._anchor)
        end = self.pos()
        self.move(end.x(), end.y() + 26)
        self.setWindowOpacity(0.0)
        self.show()
        self.raise_()
        self.activateWindow()
        slide = QPropertyAnimation(self, b"pos", self)
        slide.setDuration(260)
        slide.setStartValue(self.pos())
        slide.setEndValue(end)
        slide.setEasingCurve(QEasingCurve.Type.OutCubic)
        fade = QPropertyAnimation(self, b"windowOpacity", self)
        fade.setDuration(220)
        fade.setStartValue(0.0)
        fade.setEndValue(1.0)
        self._intro = QParallelAnimationGroup(self)
        self._intro.addAnimation(slide)
        self._intro.addAnimation(fade)
        self._intro.start()

    def _tick(self) -> None:
        if self._finished:
            return
        if self._is_stale():  # the agent already gave up waiting
            self._finish(False, notify=False)
            return
        remaining = max(0.0, self.TIMEOUT_SECONDS - (time.monotonic() - self._started))
        self.bar.setValue(int(remaining / self.TIMEOUT_SECONDS * 1000))
        self.countdown_label.setText(
            f"Auto-declines in {int(remaining) // 60}:{int(remaining) % 60:02d}"
        )
        if remaining <= 0:
            self._finish(False)

    def _finish(self, accepted: bool, notify: bool = True) -> None:
        if self._finished:
            return
        self._finished = True
        self._timer.stop()
        if notify:
            self._decide(accepted)
        fade = QPropertyAnimation(self, b"windowOpacity", self)
        fade.setDuration(160)
        fade.setStartValue(self.windowOpacity())
        fade.setEndValue(0.0)
        fade.finished.connect(self.close)
        fade.start()
        self._outro = fade

    def force_deny(self) -> None:
        self._finish(False)

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Escape:
            self._finish(False)
        else:
            super().keyPressEvent(event)

    def closeEvent(self, event) -> None:  # noqa: N802
        if not self._finished:  # closed by Alt+F4 etc. counts as a denial
            self._finished = True
            self._timer.stop()
            self._decide(False)
        super().closeEvent(event)


# --------------------------------------------------------------------------- #
# Header widget embedded at the top of the tray right-click menu
# --------------------------------------------------------------------------- #
class MenuHeader(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setMinimumWidth(300)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(10, 8, 12, 8)
        lay.setSpacing(12)
        lay.addWidget(LogoBadge(42))
        col = QVBoxLayout()
        col.setSpacing(1)
        self.title = QLabel(DISPLAY_NAME)
        self.title.setFont(_font(14, QFont.Weight.Bold, 0.5))
        self.sub = QLabel(SERVICE_TITLE)
        self.sub.setObjectName("subtitle")
        self.sub.setFont(_font(9, QFont.Weight.DemiBold, 1.4))
        self.sub2 = QLabel(SERVICE_SUBTITLE)
        self.sub2.setObjectName("caption")
        self.sub2.setFont(_font(9, QFont.Weight.DemiBold, 1.4))
        self.status = QLabel("Starting")
        self.status.setObjectName("caption")
        self.status.setFont(_font(11))
        col.addWidget(self.title)
        col.addWidget(self.sub)
        col.addWidget(self.sub2)
        col.addSpacing(3)
        col.addWidget(self.status)
        lay.addLayout(col, 1)
        self.dot = QLabel("●")
        self.dot.setFont(_font(12))
        lay.addWidget(self.dot, 0, Qt.AlignmentFlag.AlignTop)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet("background:transparent;")

    def apply(self, theme: Theme, state: str) -> None:
        self.status.setText(state if len(state) < 48 else state[:45] + "…")
        color = level_color(theme, level_for_state(state))
        self.dot.setStyleSheet(f"color:{color}; background:transparent;")
        self.title.setStyleSheet(f"color:{theme.text}; background:transparent;")
        self.sub.setStyleSheet(f"color:{theme.accent}; background:transparent;")
        self.sub2.setStyleSheet(f"color:{theme.sub}; background:transparent;")
        self.status.setStyleSheet(f"color:{theme.sub}; background:transparent;")
