# ORCA DEVS SURF — SYSTEM SCREEN SHARE SERVICE FOR ORCA DEVS SURF APPS

Python source package for the Windows tray companion that connects to the ORCA DEVS SURF web app using local protocol v1.

> This ZIP contains source code and a Windows build script, not a prebuilt executable. Build the EXE on a Windows 10/11 x64 PC using the steps below. A Linux machine cannot produce the supported Windows PyInstaller build with this script.

The Python source passed syntax/import and protocol/input smoke tests in the Sandbox. The actual Windows `.exe`, tray behavior, screen capture, and end-to-end WebRTC session still require a Windows build and test; this package is not code-signed. If a windowed build fails during startup, it now writes the traceback to `startup-error.log` and attempts to show an error dialog.

## What's new in this UI revision

- Modern PySide6 (Qt) interface: glass / dark-navy ORCA look with a subtle ocean glow.
- **Automatic light/dark theme** that follows Windows (Settings → Personalization → Colors → app mode) and switches live without restarting.
- Pure **system-tray service**: no taskbar button, no main window. Left-click the tray icon for the status card, right-click for the menu.
- **Allow / Deny consent card** pops up near the tray (fade-in, 2:00 auto-decline countdown; Esc = Deny) instead of a plain Windows dialog.
- Logo fix: the tray/EXE icon is now the ORCA mark on a navy badge with a solid-filled silhouette for 16–64 px (the dot-matrix logo went grey at small sizes). A red dot marks an active share in the tray icon and status UI; amber marks a pending approval.
- Starts automatically at sign-in (HKCU Run key, unchanged).
- Session teardown now closes the local WebRTC peer, capture track and WebSocket, releases held mouse/keyboard input, cancels pending receive tasks, and clears the active session even if one cleanup step fails. Diagnostic logs are retained; only live session resources/state are cleared.

## Branding

- UI title: **SYSTEM SCREEN SHARE SERVICE — FOR ORCA DEVS SURF APPS** (internal app/config name stays **ORCA DEVS SURF (SYSTEM SHARE)** so existing config, logs and startup entries keep working)
- Output file: `ORCA DEVS SURF (SYSTEM SHARE).exe`
- Tray/EXE icon: bundled ORCA logo reused from the ORCA DEVS SURF repository (`apps/orca-devs-surf-mobile/assets/orca-logo.png`), rendered on a dark background for visibility.

## Build the EXE

1. Install **64-bit Python 3.11** on Windows. During Python setup, enable the Python Launcher (`py`).
2. Extract this ZIP to a normal user-writable folder.
3. Double-click `BUILD_WINDOWS.bat`.
4. The script creates a local `.venv`, installs the pinned packages, and runs PyInstaller.
5. When it completes, the executable is:

   ```text
   dist\ORCA DEVS SURF (SYSTEM SHARE).exe
   ```

If the windowed build still exits without a useful error, run `BUILD_WINDOWS.bat console` from Command Prompt to build a console-visible diagnostic copy.

Do not run the EXE as administrator. The agent is intended to run in the signed-in user's normal interactive desktop session.

## Configure the web-app origin

The agent binds only to `127.0.0.1:17654`. By default, it allows HTTPS pages under `*.orca.devs.surf`, including `privatecopy.orca.devs.surf` and `garudalogistics.orca.devs.surf`, plus the apex `orca.devs.surf`. Other subdomains of that exact domain suffix are also accepted. It does not accept lookalike domains such as `orca.devs.surf.attacker.example`.

On first launch it creates or migrates:

```text
%APPDATA%\ORCA DEVS SURF (SYSTEM SHARE)\config.json
```

1. Start the EXE once; look for its ORCA tray icon (including the hidden-icons overflow).
2. The generated config already includes the ORCA wildcard. If needed, right-click the tray icon and choose **Open config file** to add exact custom HTTPS origins.
3. A custom configuration may look like:

   ```json
   {
     "allowed_origins": [
       "https://*.orca.devs.surf",
       "https://orca.devs.surf",
       "https://YOUR-OTHER-EXACT-APP-HOST"
     ],
     "start_with_windows": true
   }
   ```

   Only `https://*.orca.devs.surf` is accepted as a wildcard. Other entries must be exact origins without a path. Local `http://localhost`/`http://127.0.0.1` origins are accepted for development. Production must use HTTPS.
4. Save the JSON, then right-click the tray icon and choose **Restart agent**.

The app checks the browser's actual WebSocket `Origin` before sending its protocol handshake. The wildcard matches one or more subdomain labels only when the hostname ends exactly in `.orca.devs.surf`.

## Start with Windows

On first launch, the app registers itself for the current Windows user at sign-in using the `HKCU` Run key. This requires no administrator permission and does not enable unattended sharing: each remote share still needs approval in the web app and the Windows consent prompt. The tray menu has a checked **Start with Windows** toggle to turn this off or back on. Keep the EXE at a stable path; if you move it, launch the new copy and toggle the setting to refresh the startup path.

## Connection and sharing flow

- Endpoint: `ws://127.0.0.1:17654/v1`
- Protocol: `1`
- Initial handshake: browser sends `client.hello`; agent replies `agent.hello` with `desktop-capture` and `input` capabilities.
- Session: web app sends `capture.request`; the agent shows a Windows consent dialog naming the requester.
- On approval: agent sends `capture.approved`, captures the **primary monitor**, and publishes video through a local WebRTC peer connection to the browser. The browser relays it to the remote participant over the app's existing WebRTC connection.
- Input: validated pointer and keyboard messages are applied only while the approved session is active. A red, click-through pointer follows the connected controller's mouse on the local Windows desktop and disappears when the session ends.
- Stop: tray menu's **Stop current share**, web-app Stop/Disconnect, WebRTC failure, websocket loss, or app exit tears down the capture, local peer and socket, cancels pending receive tasks, releases held input, and clears the active session so the next share can connect.

The logo and app name are set in the source. The app has an always-visible red tray indicator while a session is running. The controller's red pointer overlay is excluded from desktop capture on supported Windows builds (the web app draws its own pointer in the shared view). Diagnostic logs are intentionally not erased on disconnect so troubleshooting information remains available.

## Security notes

- The listener binds to IPv4 loopback only, checks the actual `Origin` header against the exact configured origins plus only the requested `*.orca.devs.surf` wildcard, accepts one active system-share session, and limits WebSocket message sizes.
- The app does not expose filesystem browsing, a command shell, arbitrary process execution, or unattended access.
- The user must accept each share in the app and again in the Windows consent dialog.
- It does not attempt to bypass UAC, secure desktop, lock screen, or Windows privilege boundaries.
- The first version captures the primary monitor only. Audio capture, file browser, upload/rename/delete, and multi-monitor selection are not included.
- Test the loopback WebSocket from the production Chrome/Edge versions. Browser local-network controls may require user permission. Do not disable browser protections or bind the agent to the LAN.

## Troubleshooting

- Logs: `%LOCALAPPDATA%\ORCA DEVS SURF (SYSTEM SHARE)\agent.log`; startup crashes: `%LOCALAPPDATA%\ORCA DEVS SURF (SYSTEM SHARE)\startup-error.log`.
- Tray icon not visible: click the `^` hidden-icons arrow. To pin it on Windows 11, open **Settings → Personalization → Taskbar → Other system tray icons** and enable **ORCA DEVS SURF (SYSTEM SHARE)**. The app also explicitly sets the icon visible and opens a fallback status/control window if tray registration throws an error; tray-registration details are in `agent.log`.
- Web app says agent missing: confirm the tray icon is present, the page origin is one of the allowed ORCA subdomains, and port `17654` is not already occupied.
- Startup registration: the tray menu's checked **Start with Windows** item controls automatic sign-in startup; disable it there if you want manual launch only.
- Build failures: check that Python Launcher reports Python 3.11 x64; rerun `BUILD_WINDOWS.bat` and inspect the terminal output.
- Vercel's installer URL is a separate web-app setting: set `VITE_WINDOWS_DESKTOP_AGENT_INSTALLER_URL` to the URL where this built EXE/installer is published, then redeploy the web app.

## Package files

- `main.py` — tray service wiring, config, startup registration, shutdown handling
- `ui.py` — theme manager (auto light/dark), glass status window, consent card, tray menu header
- `launcher.py` — startup crash logging and error dialog for windowed builds
- `agent.py` — WebSocket protocol v1, local WebRTC, primary-screen capture and input validation
- `settings.py` — constants and user-data paths
- `requirements.txt` — pinned package versions
- `BUILD_WINDOWS.bat` — build script
- `assets/` — ORCA logo, solid logo, tray icon, multi-size `.ico`
