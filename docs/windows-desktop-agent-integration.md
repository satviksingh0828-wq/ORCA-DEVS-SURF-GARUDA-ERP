# Windows Desktop Tray Agent Integration (Protocol v1)

This document is the implementation contract between the Garuda ERP web app and the Windows companion executable. The web app change is designed for a **separate user-session tray agent**. It does not replace or change the app-only screen-share mode.

The buildable Python companion source is included in [`system-share-agent/`](../system-share-agent/); follow its README and `BUILD_WINDOWS.bat` to build the Windows tray app. It shows a click-through red pointer locally while a remote controller moves the mouse, then hides it at disconnect. The web app continues to render its own red pointer in the shared view.

## What to build

Build a Windows 10/11 x64 per-user tray application and installer, provisionally named:

- Installer: `GarudaDesktopAgentSetup-x64.exe`
- Executable: `GarudaDesktopAgent.exe`
- Default local endpoint: `ws://127.0.0.1:17654/v1`
- Protocol version: `1`

The agent should run in the signed-in interactive user session, bind **only** to IPv4 loopback (not `0.0.0.0`, LAN, or a public interface), show a tray icon, and provide an obvious active-sharing indicator and Stop command. It should not silently enable remote access at startup. Per-user startup may be offered as an explicit opt-in. Include the agent source and build instructions with the installer.

Prefer a signed installer and signed executable. The installer should be per-user (no administrator rights for ordinary install/update), support uninstall, and disclose the install location, startup behavior, local port, and screen/input permissions.

## User/session flow

1. The signed-in user opens the web app. The app probes the loopback endpoint and displays whether the agent is ready.
2. A user requests **System** sharing from another online participant. The existing backend creates the same pending screen-control session; the existing **App** action is unchanged.
3. The Windows screen owner sees the request in the web app and clicks Accept. If the companion is absent, the app says the agent is required and offers the configured installer link (or tells the user to obtain it from their administrator if no link is configured).
4. The browser opens its native screen picker. The Windows user selects **Entire Screen**; the web app then connects to the tray agent and sends `capture.request` with `mediaSource: "browser"`. The agent presents a separate native Windows confirmation identifying the requester and asks permission for remote input. Browser selection alone is not sufficient consent.
5. The browser adds its native display-capture track directly to the existing screen-control WebRTC connection, the same host-to-controller media path used by App sharing. The tray agent does not send video in this mode; it validates and applies approved remote input over its local WebSocket.
6. Remote pointer/keyboard events arrive through the existing WebRTC data channel and are forwarded over the local WebSocket. The agent validates the active session, applies input only while approved, and displays a red, click-through pointer on the controlled Windows desktop while the remote user moves the mouse.
7. End/Stop, tray Stop, user sign-out, agent exit, browser disconnect, or session end stops capture and input. The app closes the local peer/socket; the agent must also stop on socket loss and on its own timeout.

The browser-to-browser WebRTC peer uses Google and Cloudflare **STUN only** for direct ICE address discovery; no TURN/relay server is configured. If a firewall or NAT prevents a direct peer-to-peer path, that network pair cannot connect under this direct-only policy. The app reports the ICE failure rather than claiming the remote desktop is connected.

System and App video now use the same single browser-to-browser WebRTC media path. The Python agent remains a loopback-only input/consent service; it does not relay video, and the web app does not receive a blanket filesystem or process-execution API from the agent.

## Local WebSocket handshake

The web app opens `ws://127.0.0.1:17654/v1` and immediately sends:

```json
{ "type": "client.hello", "protocol": 1 }
```

The agent responds:

```json
{
  "type": "agent.hello",
  "protocol": 1,
  "version": "1.1.0",
  "capabilities": ["desktop-capture", "input", "input-only"]
}
```

A missing endpoint, invalid handshake, unsupported protocol, or missing capability is treated as **agent unavailable**. The optional installer URL is configured at web build time with `VITE_WINDOWS_DESKTOP_AGENT_INSTALLER_URL`. The optional WebSocket URL can be overridden with `VITE_WINDOWS_AGENT_WS_URL`; production default remains loopback above.

### Capture approval

After the handshake, the browser sends:

```json
{
  "type": "capture.request",
  "protocol": 1,
  "sessionId": "<existing app session UUID>",
  "requesterName": "<display name shown in the app>",
  "appOrigin": "https://<approved-app-host>",
  "mediaSource": "browser"
}
```

The WebSocket `Origin` header is authoritative; `appOrigin` is informational only and must never be trusted as the origin check. The agent must enforce a configured allowlist of exact production/staging web-app origins. For untrusted origins, malformed messages, stale/unknown sessions, or unsupported protocol versions, close the connection. Do not expose a general-purpose command shell, arbitrary file access, or unattended-control endpoint.

After the local user approves, the agent sends:

```json
{ "type": "capture.approved", "protocol": 1, "sessionId": "..." }
```

On decline it sends `capture.denied`; on a safe, user-readable failure it may send `capture.error` with a short `message`. Approval should time out after 120 seconds. The app keeps the existing server session pending until it has a usable capture stream and can then accept the request.

## Browser media capture

The browser's native `getDisplayMedia` picker captures the selected entire monitor. The web app adds that track to the existing host-side screen-control `RTCPeerConnection` and sends it to the controller using the current authenticated SDP/ICE signaling flow. System and App sharing therefore have one identical remote video hop. No local agent WebRTC peer is created for the current System flow, and the agent's `input-only` capability identifies builds that support this mode. Audio is not requested.

## Input and stop messages

Remote input is sent only after local approval and only for that approved session:

```json
{
  "type": "control.input",
  "protocol": 1,
  "sessionId": "...",
  "input": { "type": "move", "x": 0.5, "y": 0.5, "buttons": 0 }
}
```

Input `type` values and fields match the web app's `RemoteInput` union: `move`, `pointerdown`, `pointerup`, `click`, `contextmenu`, `wheel`, `key`, `text`, and `edit`. Pointer coordinates are normalized to 0..1 against the desktop stream; the agent maps them to the primary Windows monitor. Select the primary monitor in the browser picker for correct control. Validate bounds, event fields, key codes, payload size and rate; discard all commands unless the session remains approved and active. Do not try to bypass Windows secure desktop/UAC, lock screen, login screen, or integrity boundaries. Report unsupported/elevated surfaces clearly.

The browser sends:

```json
{ "type": "capture.stop", "protocol": 1, "sessionId": "..." }
```

The agent responds optionally with `capture.stopped`, then stops its capture source, closes peer connections, releases input hooks, and clears session state. Socket closure is also a stop signal. The tray Stop control must stop the same session immediately, regardless of web-app state.

## Security and browser compatibility

- Bind only to loopback; reject remote network clients.
- Check WebSocket `Origin` against exact allowlisted web-app origins. Do not use wildcard origin matching or rely on CORS alone.
- Require an interactive local approval for each full-desktop session; keep an always-visible tray/desktop indicator and local Stop control.
- Allow only one active session per Windows user initially; fail closed for overlapping sessions.
- Apply strict message-size, schema, session-ID, rate, protocol-version, and state-machine validation.
- Do not persist session tokens, screen frames, or remote input. Do not record the stream.
- Browser local-network/WebSocket policy differs by browser/version and deployment origin. Test the production HTTPS site on supported Chrome/Edge builds. If browser local-network permission is shown, explain why it is needed; do not disable browser security.
- The loopback bridge currently assumes the browser can reach the agent's HTTP WebSocket endpoint. If a target browser blocks it, we should add a signed browser extension/native-messaging route rather than weakening origin checks or binding the agent to the LAN.

## Deliverables needed from the Windows build

Please provide:

1. `GarudaDesktopAgentSetup-x64.exe` plus SHA-256 checksum and release version.
2. Agent source code, build toolchain/dependency versions, and reproducible build steps.
3. Any signing certificate/public publisher identity and signing status.
4. Supported Windows versions and known limitations for multiple monitors, secure desktop/UAC, scaling, elevated windows, and keyboard layouts.
5. The final published installer URL. Configure it in the web build as `VITE_WINDOWS_DESKTOP_AGENT_INSTALLER_URL`.
6. The exact allowed production and staging app origins that the agent should accept.

The browser integration is now written against this v1 protocol, but an actual working full-desktop session requires the agent to implement these messages and receive its own end-to-end test on Windows.
