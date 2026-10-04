from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "ORCA DEVS SURF (SYSTEM SHARE)"
APP_SLUG = "ORCA DEVS SURF (SYSTEM SHARE)"
PROTOCOL_VERSION = 1
HOST = "127.0.0.1"
PORT = 17654
MAX_MESSAGE_BYTES = 65_536
DEFAULT_ALLOWED_ORIGINS = ["https://*.orca.devs.surf", "https://orca.devs.surf"]

APPDATA = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
CONFIG_DIR = APPDATA / APP_SLUG
CONFIG_PATH = CONFIG_DIR / "config.json"
LOG_DIR = LOCALAPPDATA / APP_SLUG
LOG_PATH = LOG_DIR / "agent.log"
STARTUP_LOG_PATH = LOG_DIR / "startup-error.log"


def resource_path(relative: str) -> str:
    """Find bundled data both in source mode and a PyInstaller one-file build."""
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        return str(Path(bundle_root) / relative)
    return str(Path(__file__).resolve().parent / relative)


# ---- Display branding (UI only; APP_NAME above stays unchanged so the config
# folder, log folder and the Windows startup registration keep working) ----
DISPLAY_NAME = "ORCA DEVS SURF"
SERVICE_TITLE = "SYSTEM SCREEN SHARE SERVICE"
SERVICE_SUBTITLE = "FOR ORCA DEVS SURF APPS"
FULL_TAGLINE = "SYSTEM SCREEN SHARE SERVICE FOR ORCA DEVS SURF APPS"
