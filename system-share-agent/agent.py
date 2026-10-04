from __future__ import annotations

import asyncio
import json
import logging
import math
import threading
import time
import uuid
from fractions import Fraction
from typing import Any, Callable
from urllib.parse import urlsplit

import mss
import numpy as np
import pyautogui
from av import VideoFrame
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.sdp import candidate_from_sdp
from PIL import Image
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from settings import APP_NAME, HOST, MAX_MESSAGE_BYTES, PORT, PROTOCOL_VERSION

LOGGER = logging.getLogger(APP_NAME)


class DesktopVideoTrack(VideoStreamTrack):
    """Primary-monitor video at 15 fps. Protected Windows desktops aren't bypassed."""

    kind = "video"

    def __init__(self) -> None:
        super().__init__()
        self._capture = mss.mss()
        self._monitor = dict(self._capture.monitors[1])
        self.width = int(self._monitor["width"])
        self.height = int(self._monitor["height"])
        self.left = int(self._monitor["left"])
        self.top = int(self._monitor["top"])
        self._frame_number = 0
        self._next_frame_at = 0.0
        self._closed = False

    async def recv(self) -> VideoFrame:
        if self._closed:
            raise RuntimeError("The desktop capture track has stopped.")
        now = asyncio.get_running_loop().time()
        if self._next_frame_at == 0:
            self._next_frame_at = now
        self._next_frame_at += 1 / 15
        await asyncio.sleep(max(0, self._next_frame_at - now))
        pixels = np.asarray(self._capture.grab(self._monitor), dtype=np.uint8)
        # mss returns BGRA; aiortc expects packed RGB here.
        rgb = np.ascontiguousarray(pixels[:, :, 2::-1])
        if rgb.shape[1] > 1920 or rgb.shape[0] > 1080:
            image = Image.fromarray(rgb)
            image.thumbnail((1920, 1080), Image.Resampling.BILINEAR)
            rgb = np.asarray(image, dtype=np.uint8)
        frame = VideoFrame.from_ndarray(rgb, format="rgb24")
        frame.pts = self._frame_number * 6000  # 90 kHz / 15 fps
        frame.time_base = Fraction(1, 90_000)
        self._frame_number += 1
        return frame

    def stop(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                self._capture.close()
            finally:
                super().stop()


class WindowsInput:
    """Narrow mouse/keyboard adapter. Never invokes shells or opens files."""

    def __init__(self, cursor_callback: Callable[[int, int], None] | None = None) -> None:
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0
        self._cursor_callback = cursor_callback
        self._held_modifiers: set[str] = set()
        self._last_event_at = 0.0
        self._events_in_window = 0

    @staticmethod
    def _key_name(key: str, code: str) -> str | None:
        code_map = {
            "Enter": "enter", "Escape": "esc", "Tab": "tab", "Space": "space",
            "Backspace": "backspace", "Delete": "delete", "Insert": "insert",
            "Home": "home", "End": "end", "PageUp": "pageup", "PageDown": "pagedown",
            "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
            "CapsLock": "capslock", "PrintScreen": "printscreen", "Pause": "pause",
            "NumpadEnter": "enter", "NumpadAdd": "+", "NumpadSubtract": "-",
            "NumpadMultiply": "*", "NumpadDivide": "/", "NumpadDecimal": ".",
        }
        if code in code_map:
            return code_map[code]
        if code.startswith("Key") and len(code) == 4:
            return code[-1].lower()
        if code.startswith("Digit") and len(code) == 6:
            return code[-1]
        if code.startswith("Numpad") and code[-1:].isdigit():
            return code[-1]
        if len(code) >= 2 and code[0] == "F" and code[1:].isdigit():
            return code.lower()
        if len(key) == 1 and key.isascii() and key.isprintable():
            return key.lower()
        return None

    def _rate_limit(self) -> None:
        now = time.monotonic()
        if now - self._last_event_at >= 1:
            self._last_event_at = now
            self._events_in_window = 0
        self._events_in_window += 1
        if self._events_in_window > 180:
            raise ValueError("Input rate limit exceeded.")

    @staticmethod
    def _mouse_button(button: Any) -> str:
        if button is None:
            button = 0
        if isinstance(button, bool) or not isinstance(button, int) or button not in {0, 1, 2}:
            raise ValueError("Invalid mouse button.")
        return {0: "left", 1: "middle", 2: "right"}[button]

    def apply(self, payload: Any, monitor: dict[str, int]) -> None:
        if not isinstance(payload, dict) or len(json.dumps(payload)) > 8_192:
            raise ValueError("Invalid input payload.")
        kind = payload.get("type")
        if kind not in {"move", "pointerdown", "pointerup", "click", "contextmenu", "wheel", "key", "text", "edit"}:
            raise ValueError("Unsupported input type.")
        self._rate_limit()

        if kind in {"move", "pointerdown", "pointerup", "click", "contextmenu", "wheel"}:
            x = payload.get("x")
            y = payload.get("y")
            if (
                isinstance(x, bool) or isinstance(y, bool)
                or not isinstance(x, (int, float)) or not isinstance(y, (int, float))
            ):
                raise ValueError("Pointer coordinates are required.")
            if not math.isfinite(float(x)) or not math.isfinite(float(y)) or not 0 <= x <= 1 or not 0 <= y <= 1:
                raise ValueError("Pointer coordinates are out of range.")
            px = monitor["left"] + min(monitor["width"] - 1, max(0, round(x * monitor["width"])))
            py = monitor["top"] + min(monitor["height"] - 1, max(0, round(y * monitor["height"])))
            if self._cursor_callback:
                self._cursor_callback(px, py)
            if kind == "move":
                pyautogui.moveTo(px, py, duration=0)
            elif kind == "pointerdown":
                pyautogui.moveTo(px, py, duration=0)
                pyautogui.mouseDown(button=self._mouse_button(payload.get("button")))
            elif kind == "pointerup":
                pyautogui.moveTo(px, py, duration=0)
                pyautogui.mouseUp(button=self._mouse_button(payload.get("button")))
            elif kind == "contextmenu":
                pyautogui.click(px, py, button="right")
            elif kind == "wheel":
                delta = payload.get("deltaY", 0)
                if isinstance(delta, bool) or not isinstance(delta, (int, float)) or not math.isfinite(float(delta)):
                    raise ValueError("Invalid wheel delta.")
                pyautogui.moveTo(px, py, duration=0)
                amount = max(-10, min(10, round(-float(delta) / 100)))
                if amount:
                    pyautogui.scroll(amount)
            # The web client emits pointerdown/up plus click; don't double-click.
            return

        if kind == "key":
            key = str(payload.get("key", ""))[:40]
            code = str(payload.get("code", ""))[:40]
            down = payload.get("down") is True
            ctrl = payload.get("ctrl") is True
            alt = payload.get("alt") is True
            shift = payload.get("shift") is True
            meta = payload.get("meta") is True
            lower = key.lower()
            # Keep system-level destructive/locking shortcuts local.
            if (alt and key == "F4") or (meta and lower == "l") or (ctrl and alt and key == "Delete"):
                return
            modifier_by_code = {
                "ControlLeft": "ctrl", "ControlRight": "ctrl",
                "ShiftLeft": "shift", "ShiftRight": "shift",
                "AltLeft": "alt", "AltRight": "alt",
                "MetaLeft": "win", "MetaRight": "win",
            }
            modifier = modifier_by_code.get(code)
            if modifier:
                if down and modifier not in self._held_modifiers:
                    pyautogui.keyDown(modifier)
                    self._held_modifiers.add(modifier)
                elif not down and modifier in self._held_modifiers:
                    pyautogui.keyUp(modifier)
                    self._held_modifiers.discard(modifier)
                return
            if not down:
                return
            # Text and edit events are sent separately by the web app. Printable
            # keystrokes are only forwarded here for shortcuts with modifiers.
            if len(key) == 1 and key.isprintable():
                if ctrl or alt or meta:
                    mapped = self._key_name(key, code)
                    if mapped:
                        pyautogui.press(mapped)
                return
            if key in {"Backspace", "Delete"}:
                return
            mapped = self._key_name(key, code)
            if mapped:
                pyautogui.press(mapped)
            return

        if kind == "text":
            text = payload.get("text")
            if isinstance(text, str) and len(text) <= 256 and text.isprintable():
                pyautogui.write(text, interval=0)
            return

        if kind == "edit":
            key = payload.get("key")
            if key in {"Backspace", "Delete"}:
                pyautogui.press("backspace" if key == "Backspace" else "delete")

    def release_all(self) -> None:
        for modifier in tuple(self._held_modifiers):
            try:
                pyautogui.keyUp(modifier)
            except Exception:
                LOGGER.debug("Could not release modifier %s", modifier, exc_info=True)
        self._held_modifiers.clear()
        for button in ("left", "middle", "right"):
            try:
                pyautogui.mouseUp(button=button)
            except Exception:
                pass


class AgentServer:
    def __init__(
        self,
        allowed_origins: list[str],
        status_callback: Callable[[str], None],
        approval_callback: Callable[[str, str, asyncio.AbstractEventLoop], Any],
        cursor_callback: Callable[[int, int, bool], None] | None = None,
    ) -> None:
        self.allowed_origins = allowed_origins
        self.status_callback = status_callback
        self.approval_callback = approval_callback
        self.cursor_callback = cursor_callback
        self.loop: asyncio.AbstractEventLoop | None = None
        self.shutdown_event: asyncio.Event | None = None
        self.active_stop_event: asyncio.Event | None = None
        self.active_session_id: str | None = None
        self._input = WindowsInput(self._show_remote_cursor)

    def _show_remote_cursor(self, x: int, y: int) -> None:
        if not self.cursor_callback:
            return
        try:
            self.cursor_callback(x, y, True)
        except Exception:
            LOGGER.debug("Could not show the remote mouse pointer", exc_info=True)

    def _hide_remote_cursor(self) -> None:
        if not self.cursor_callback:
            return
        try:
            self.cursor_callback(0, 0, False)
        except Exception:
            LOGGER.debug("Could not hide the remote mouse pointer", exc_info=True)

    def stop_active_from_tray(self) -> None:
        loop = self.loop
        stop_event = self.active_stop_event
        if loop and stop_event:
            loop.call_soon_threadsafe(stop_event.set)

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.shutdown_event = asyncio.Event()
        if not self.allowed_origins:
            self.status_callback("Setup required — allowed origins are not configured")
            return
        try:
            async with serve(
                self.handle_connection,
                HOST,
                PORT,
                max_size=MAX_MESSAGE_BYTES,
                max_queue=16,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=2,
            ):
                self.status_callback(f"Ready — listening on {HOST}:{PORT}")
                await self.shutdown_event.wait()
        except OSError as exc:
            LOGGER.exception("Could not start the local agent listener")
            self.status_callback(f"Could not listen on {HOST}:{PORT}: {exc}")
        finally:
            self.stop_active_from_tray()
            self.loop = None

    async def shutdown(self) -> None:
        if self.shutdown_event:
            self.shutdown_event.set()
        self.stop_active_from_tray()

    async def handle_connection(self, websocket: ServerConnection) -> None:
        request = websocket.request
        if request.path != "/v1":
            await websocket.close(code=1008, reason="Unsupported endpoint")
            return
        origin = request.headers.get("Origin", "")
        if not self._origin_is_allowed(origin, self.allowed_origins):
            await websocket.close(code=1008, reason="Origin not allowed")
            return
        try:
            first = await asyncio.wait_for(websocket.recv(), timeout=5)
            hello = self._decode_json(first)
            if hello.get("type") != "client.hello" or hello.get("protocol") != PROTOCOL_VERSION:
                await websocket.close(code=1002, reason="Protocol mismatch")
                return
            await websocket.send(self._json({
                "type": "agent.hello",
                "protocol": PROTOCOL_VERSION,
                "version": "1.1.0",
                "capabilities": ["desktop-capture", "input", "input-only"],
            }))
            async for raw in websocket:
                message = self._decode_json(raw)
                if message.get("type") != "capture.request":
                    continue
                if message.get("protocol") != PROTOCOL_VERSION:
                    await websocket.close(code=1002, reason="Protocol mismatch")
                    return
                app_origin = message.get("appOrigin")
                if not isinstance(app_origin, str) or app_origin != origin:
                    await websocket.close(code=1008, reason="Origin not allowed")
                    return
                session_id = self._valid_session_id(message.get("sessionId"))
                requester = self._safe_name(message.get("requesterName"))
                media_source = message.get("mediaSource", "agent")
                if not session_id or not requester or media_source not in {"agent", "browser"}:
                    await websocket.close(code=1008, reason="Invalid capture request")
                    return
                if self.active_session_id:
                    await websocket.send(self._json({
                        "type": "capture.error", "protocol": PROTOCOL_VERSION,
                        "sessionId": session_id, "message": "Another desktop-sharing session is already active.",
                    }))
                    continue
                await self._run_capture(
                    websocket,
                    session_id,
                    requester,
                    capture_media=media_source == "agent",
                )
        except asyncio.TimeoutError:
            await websocket.close(code=1008, reason="Handshake timed out")
        except (ConnectionClosed, asyncio.CancelledError):
            return
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            LOGGER.warning("Rejected malformed local message: %s", exc)
            try:
                await websocket.close(code=1008, reason="Invalid message")
            except Exception:
                pass
        except Exception:
            LOGGER.exception("Unhandled connection error")
            try:
                await websocket.close(code=1011, reason="Agent error")
            except Exception:
                pass

    async def _run_capture(
        self,
        websocket: ServerConnection,
        session_id: str,
        requester: str,
        capture_media: bool = True,
    ) -> None:
        stop_event = asyncio.Event()
        self.active_stop_event = stop_event
        self.active_session_id = session_id
        pc: RTCPeerConnection | None = None
        track: DesktopVideoTrack | None = None
        approved = False
        failed = False
        try:
            self.status_callback(f"Waiting for Windows approval — {requester}")
            loop = asyncio.get_running_loop()
            approved = await asyncio.wait_for(
                self.approval_callback(requester, session_id, loop), timeout=120
            )
            if not approved:
                await websocket.send(self._json({
                    "type": "capture.denied", "protocol": PROTOCOL_VERSION, "sessionId": session_id,
                }))
                self.status_callback("Ready — request declined")
                return

            if capture_media:
                track = DesktopVideoTrack()
                monitor = {
                    "left": track.left,
                    "top": track.top,
                    "width": track.width,
                    "height": track.height,
                }
                pc = RTCPeerConnection()
                pc.addTrack(track)
            else:
                capture = mss.mss()
                try:
                    primary = dict(capture.monitors[1])
                finally:
                    capture.close()
                monitor = {
                    "left": int(primary["left"]),
                    "top": int(primary["top"]),
                    "width": int(primary["width"]),
                    "height": int(primary["height"]),
                }

            self.status_callback(
                f"Sharing desktop with {requester} — Stop in tray to end"
                if capture_media
                else f"Remote control active with {requester} — Stop in tray to end"
            )
            self._hide_remote_cursor()
            await websocket.send(self._json({
                "type": "capture.approved", "protocol": PROTOCOL_VERSION, "sessionId": session_id,
            }))
            if capture_media:
                assert pc is not None
                offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                local = pc.localDescription
                if not local:
                    raise RuntimeError("The local WebRTC offer could not be created.")
                await websocket.send(self._json({
                    "type": "rtc.offer", "protocol": PROTOCOL_VERSION, "sessionId": session_id,
                    "description": {"type": local.type, "sdp": local.sdp},
                }))
            await self._capture_message_loop(websocket, pc, stop_event, session_id, monitor)
            try:
                await websocket.send(self._json({
                    "type": "capture.stopped", "protocol": PROTOCOL_VERSION, "sessionId": session_id,
                }))
            except ConnectionClosed:
                pass
        except asyncio.TimeoutError:
            LOGGER.info("Local approval timed out for %s", session_id)
            try:
                await websocket.send(self._json({
                    "type": "capture.denied", "protocol": PROTOCOL_VERSION, "sessionId": session_id,
                }))
            except ConnectionClosed:
                pass
            self.status_callback("Ready — approval timed out")
        except (ConnectionClosed, asyncio.CancelledError):
            LOGGER.info("Local browser connection ended for %s", session_id)
        except Exception as exc:
            failed = True
            LOGGER.exception("Capture session failed")
            try:
                await websocket.send(self._json({
                    "type": "capture.error", "protocol": PROTOCOL_VERSION,
                    "sessionId": session_id, "message": "Could not start desktop capture. Check the agent log.",
                }))
            except Exception:
                pass
            self.status_callback(f"Capture error: {exc}")
        finally:
            try:
                self._input.release_all()
            except Exception:
                LOGGER.warning("Could not release every held input during session cleanup", exc_info=True)
            if pc:
                try:
                    await pc.close()
                except Exception:
                    LOGGER.debug("Could not close peer connection", exc_info=True)
            if track:
                try:
                    track.stop()
                except Exception:
                    LOGGER.warning("Could not close desktop capture during session cleanup", exc_info=True)
            # Clear only this session's state; stale cleanup must never erase a newer session.
            if self.active_session_id == session_id:
                self.active_session_id = None
            if self.active_stop_event is stop_event:
                self.active_stop_event = None
            self._hide_remote_cursor()
            if approved and not failed:
                self.status_callback("Ready — no active share")

    async def _capture_message_loop(
        self,
        websocket: ServerConnection,
        pc: RTCPeerConnection | None,
        stop_event: asyncio.Event,
        session_id: str,
        monitor: dict[str, int],
    ) -> None:
        while not stop_event.is_set():
            receive_task = asyncio.create_task(websocket.recv())
            stop_task = asyncio.create_task(stop_event.wait())
            tasks = {receive_task, stop_task}
            try:
                done, _pending = await asyncio.wait(
                    tasks, return_when=asyncio.FIRST_COMPLETED
                )
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
            if stop_task in done and stop_event.is_set():
                return
            raw = receive_task.result()
            message = self._decode_json(raw)
            if message.get("protocol") != PROTOCOL_VERSION or message.get("sessionId") != session_id:
                continue
            kind = message.get("type")
            if kind == "capture.stop":
                return
            if kind == "rtc.answer" and pc is not None:
                description = message.get("description")
                if not isinstance(description, dict) or description.get("type") != "answer":
                    continue
                sdp = description.get("sdp")
                if not isinstance(sdp, str) or len(sdp) > 32_000:
                    continue
                await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))
            elif kind == "rtc.ice" and pc is not None:
                await self._add_ice_candidate(pc, message.get("candidate"))
            elif kind == "control.input":
                payload = message.get("input")
                try:
                    await asyncio.to_thread(
                        self._input.apply,
                        payload,
                        monitor,
                    )
                except Exception as exc:
                    LOGGER.debug("Ignored remote input: %s", exc)

    @staticmethod
    async def _add_ice_candidate(pc: RTCPeerConnection, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        raw = payload.get("candidate")
        if not isinstance(raw, str) or not raw.startswith("candidate:") or len(raw) > 2_000:
            return
        try:
            candidate = candidate_from_sdp(raw[len("candidate:"):])
            candidate.sdpMid = payload.get("sdpMid")
            candidate.sdpMLineIndex = payload.get("sdpMLineIndex")
            await pc.addIceCandidate(candidate)
        except Exception:
            LOGGER.debug("Ignored invalid ICE candidate", exc_info=True)

    @staticmethod
    def _decode_json(raw: Any) -> dict[str, Any]:
        if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_MESSAGE_BYTES:
            raise ValueError("Message is not valid JSON text or is too large.")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("Message must be a JSON object.")
        return value

    @staticmethod
    def _json(value: dict[str, Any]) -> str:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)

    @staticmethod
    def _valid_session_id(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        try:
            return str(uuid.UUID(value))
        except (ValueError, AttributeError, TypeError):
            return None

    @staticmethod
    def _safe_name(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        result = " ".join(value.split())[:100]
        return result or None

    @staticmethod
    def _origin_is_allowed(origin: str, allowlist: list[str]) -> bool:
        if not isinstance(origin, str) or not origin:
            return False
        if origin in allowlist:
            return True
        if "https://*.orca.devs.surf" not in allowlist:
            return False
        try:
            parsed = urlsplit(origin)
            hostname = parsed.hostname or ""
            port = parsed.port
        except ValueError:
            return False
        suffix = ".orca.devs.surf"
        if (
            parsed.scheme != "https"
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or port not in {None, 443}
            or not hostname.endswith(suffix)
        ):
            return False
        subdomain = hostname[: -len(suffix)]
        return bool(subdomain) and all(label for label in subdomain.split("."))
