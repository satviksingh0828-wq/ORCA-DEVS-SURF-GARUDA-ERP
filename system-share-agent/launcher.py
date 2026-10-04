from __future__ import annotations

import ctypes
import logging
import os
import sys
import traceback
from pathlib import Path

APP_NAME = "ORCA DEVS SURF (SYSTEM SHARE)"
LOG_PATH = (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    / APP_NAME
    / "startup-error.log"
)


def enable_dpi_awareness() -> None:
    if sys.platform != "win32":
        return
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
        pass


def main() -> int:
    try:
        enable_dpi_awareness()
        from main import main as run_agent

        run_agent()
        return 0
    except SystemExit as exc:
        return int(exc.code or 0) if isinstance(exc.code, int) else 1
    except BaseException as exc:
        detail = traceback.format_exc()
        try:
            LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with LOG_PATH.open("a", encoding="utf-8") as handle:
                handle.write("\n" + "=" * 70 + "\n")
                handle.write(detail)
        except Exception:
            pass
        try:
            ctypes.windll.user32.MessageBoxW(
                None,
                "The tray agent could not start.\n\n"
                f"Error: {exc}\n\n"
                f"Details were written to:\n{LOG_PATH}",
                APP_NAME,
                0x10,  # MB_ICONERROR
            )
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
