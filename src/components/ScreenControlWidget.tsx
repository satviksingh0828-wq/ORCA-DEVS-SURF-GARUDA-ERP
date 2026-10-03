import { useRouterState } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorUp,
  MousePointer2,
  RefreshCw,
  ScreenShare,
  ShieldAlert,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSession } from "@/lib/session";
import {
  createScreenControlRequest,
  endScreenControlSession,
  getScreenControlState,
  receiveScreenControlSignals,
  respondToScreenControlRequest,
  sendScreenControlSignal,
  type ScreenControlSession,
  type ScreenControlState,
  type ScreenSignal,
} from "@/lib/screen-control";

type RemoteInput =
  | {
      type: "move" | "pointerdown" | "pointerup" | "click" | "contextmenu";
      x: number;
      y: number;
      button?: number;
      buttons?: number;
    }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | {
      type: "key";
      key: string;
      code: string;
      down: boolean;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    }
  | { type: "text"; text: string }
  | { type: "edit"; key: "Backspace" | "Delete" };

type RemotePointerPosition = { x: number; y: number };

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
  bundlePolicy: "max-bundle",
  iceCandidatePoolSize: 10,
};

function isTextControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !["password", "file", "hidden", "button", "submit", "reset", "checkbox", "radio"].includes(
    element.type.toLowerCase(),
  );
}

function editTextControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  key?: "Backspace" | "Delete",
) {
  if (element instanceof HTMLInputElement && element.type.toLowerCase() === "password") return;
  const value = element.value;
  const start = element.selectionStart ?? value.length;
  const end = element.selectionEnd ?? start;
  let nextValue = value;
  let nextCursor = start;
  if (key === "Backspace") {
    if (start === end && start > 0) {
      nextValue = `${value.slice(0, start - 1)}${value.slice(end)}`;
      nextCursor = start - 1;
    } else {
      nextValue = `${value.slice(0, start)}${value.slice(end)}`;
      nextCursor = start;
    }
  } else if (key === "Delete") {
    if (start === end && end < value.length)
      nextValue = `${value.slice(0, start)}${value.slice(end + 1)}`;
    else nextValue = `${value.slice(0, start)}${value.slice(end)}`;
    nextCursor = start;
  } else {
    nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
    nextCursor = start + text.length;
  }
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, nextValue);
  else element.value = nextValue;
  element.setSelectionRange(nextCursor, nextCursor);
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType:
        key === "Delete" ? "deleteContentForward" : key ? "deleteContentBackward" : "insertText",
      data: key ? null : text,
    }),
  );
}

function dispatchRemoteInput(input: RemoteInput) {
  const focused =
    document.activeElement instanceof HTMLElement ? document.activeElement : document.body;

  if (
    input.type === "move" ||
    input.type === "pointerdown" ||
    input.type === "pointerup" ||
    input.type === "click" ||
    input.type === "contextmenu" ||
    input.type === "wheel"
  ) {
    const x = input.x * window.innerWidth;
    const y = input.y * window.innerHeight;
    const target = document.elementFromPoint(Math.round(x), Math.round(y));
    if (
      !target ||
      target.closest("[data-no-remote-control],input[type='password'],input[type='file']")
    )
      return;
    window.dispatchEvent(
      new CustomEvent<RemotePointerPosition>("screen-control:pointer", {
        detail: { x, y },
      }),
    );
    if (input.type === "move") {
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: x,
          clientY: y,
          pointerType: "mouse",
          buttons: input.buttons ?? 0,
        }),
      );
      return;
    }
    if (input.type === "wheel") {
      target.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
        }),
      );
      let scrollable: HTMLElement | null = target instanceof HTMLElement ? target : null;
      while (scrollable && scrollable !== document.body) {
        const style = getComputedStyle(scrollable);
        if (
          (/(auto|scroll)/.test(style.overflowY) &&
            scrollable.scrollHeight > scrollable.clientHeight) ||
          (/(auto|scroll)/.test(style.overflowX) && scrollable.scrollWidth > scrollable.clientWidth)
        ) {
          scrollable.scrollBy({ left: input.deltaX, top: input.deltaY, behavior: "instant" });
          return;
        }
        scrollable = scrollable.parentElement;
      }
      window.scrollBy({ left: input.deltaX, top: input.deltaY, behavior: "instant" });
      return;
    }
    if (input.type === "click" || input.type === "contextmenu") {
      target.dispatchEvent(
        new MouseEvent(input.type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: input.button ?? 0,
        }),
      );
      return;
    }
    if (input.type === "pointerdown" && target instanceof HTMLElement)
      target.focus({ preventScroll: true });
    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: input.button ?? 0,
      buttons: input.buttons ?? (input.type === "pointerdown" ? 1 : 0),
      pointerType: "mouse",
    };
    target.dispatchEvent(new PointerEvent(input.type, eventInit));
    target.dispatchEvent(
      new MouseEvent(input.type === "pointerdown" ? "mousedown" : "mouseup", eventInit),
    );
    return;
  }

  if (input.type === "key") {
    if (input.ctrl && ["r", "w", "l", "t", "n"].includes(input.key.toLowerCase())) return;
    if (input.alt && input.key === "F4") return;
    if (
      focused.closest("[data-no-remote-control]") ||
      (focused instanceof HTMLInputElement &&
        ["password", "file"].includes(focused.type.toLowerCase()))
    )
      return;
    const keyboardEvent = new KeyboardEvent(input.down ? "keydown" : "keyup", {
      key: input.key,
      code: input.code,
      bubbles: true,
      cancelable: true,
      ctrlKey: input.ctrl,
      altKey: input.alt,
      shiftKey: input.shift,
      metaKey: input.meta,
    });
    focused.dispatchEvent(keyboardEvent);
    if (input.down && input.key === "Enter" && focused instanceof HTMLElement) {
      const form =
        focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
          ? focused.form
          : null;
      if (form && !(focused instanceof HTMLTextAreaElement)) form.requestSubmit();
    }
    return;
  }

  if (focused.closest("[data-no-remote-control]")) return;
  if (input.type === "text" && isTextControl(focused)) {
    editTextControl(focused, input.text);
    return;
  }
  if (input.type === "edit" && isTextControl(focused)) editTextControl(focused, "", input.key);
}

function displayName(session: ScreenControlSession, currentUserId: string) {
  return session.requester_id === currentUserId ? session.target.name : session.requester.name;
}

function getScreenPoint(container: HTMLElement, clientX: number, clientY: number) {
  const video = container.querySelector<HTMLVideoElement>("[data-screen-control-video]");
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const rect = video.getBoundingClientRect();
  const frameRatio = video.videoWidth / video.videoHeight;
  let frameWidth = rect.width;
  let frameHeight = rect.height;
  let frameLeft = rect.left;
  let frameTop = rect.top;
  if (rect.width / rect.height > frameRatio) {
    frameWidth = rect.height * frameRatio;
    frameLeft += (rect.width - frameWidth) / 2;
  } else {
    frameHeight = rect.width / frameRatio;
    frameTop += (rect.height - frameHeight) / 2;
  }
  const x = (clientX - frameLeft) / frameWidth;
  const y = (clientY - frameTop) / frameHeight;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export function ScreenControlWidget() {
  const { user } = useSession();
  const routePath = useRouterState({ select: (state) => state.location.pathname });
  const token = user?.sessionToken ?? "";
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<ScreenControlState["onlineUsers"]>([]);
  const [sessions, setSessions] = useState<ScreenControlSession[]>([]);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remotePointer, setRemotePointer] = useState<RemotePointerPosition | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | "waiting">(
    "waiting",
  );
  const [isWorkspaceFullscreen, setIsWorkspaceFullscreen] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamSessionRef = useRef<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const inputQueueRef = useRef<RemoteInput[]>([]);
  const lastMoveSentAt = useRef(0);
  const pollLock = useRef(false);
  const signalErrorShown = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncFullscreenState = () =>
      setIsWorkspaceFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    let disposed = false;
    const findHeaderTarget = () => {
      if (!disposed)
        setHeaderTarget(document.querySelector<HTMLElement>("[data-app-shell-header-actions]"));
    };
    findHeaderTarget();
    const observer = new MutationObserver(findHeaderTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [routePath, user?.id]);

  const refreshState = useCallback(
    async (quiet = false) => {
      if (!token) return;
      if (!quiet) setLoading(true);
      try {
        const state = await getScreenControlState({ data: { sessionToken: token } });
        setOnlineUsers(state.onlineUsers);
        setSessions(state.sessions);
        setError(null);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Could not check screen-control status.";
        setError(message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      setSessions([]);
      setOnlineUsers([]);
      return;
    }
    let mounted = true;
    const poll = async () => {
      if (!mounted || pollLock.current) return;
      pollLock.current = true;
      try {
        const state = await getScreenControlState({ data: { sessionToken: token } });
        if (mounted) {
          setOnlineUsers(state.onlineUsers);
          setSessions(state.sessions);
          setError(null);
        }
      } catch (cause) {
        if (mounted)
          setError(
            cause instanceof Error ? cause.message : "Could not check screen-control status.",
          );
      } finally {
        pollLock.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    const disconnectOnPageExit = (event: PageTransitionEvent) => {
      // pagehide also fires when a page enters the back/forward cache. Keep
      // the session alive because the page may be restored immediately.
      if (event.persisted) return;
      const body = new Blob([JSON.stringify({ sessionToken: token })], {
        type: "application/json",
      });
      navigator.sendBeacon?.("/api/screen-control/disconnect", body);
    };
    window.addEventListener("pagehide", disconnectOnPageExit);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", disconnectOnPageExit);
    };
  }, [token]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.status === "active") ?? null,
    [sessions],
  );
  const activeSessionId = activeSession?.id;
  const activeSessionStatus = activeSession?.status;
  const activeSessionTargetId = activeSession?.target_id;
  useEffect(() => {
    const active = Boolean(activeSessionId && activeSessionStatus === "active");
    if (active) document.body.dataset.screenControlActive = "true";
    else delete document.body.dataset.screenControlActive;

    const video = document.querySelector<HTMLVideoElement>(".background-video-layer");
    if (!video) return;
    if (active) {
      video.dataset.screenControlPaused = "true";
      video.pause();
    } else if (video.dataset.screenControlPaused === "true") {
      delete video.dataset.screenControlPaused;
      void video.play().catch(() => undefined);
    }
    return () => {
      delete document.body.dataset.screenControlActive;
    };
  }, [activeSessionId, activeSessionStatus]);
  useEffect(() => {
    if (!activeSessionId || activeSessionTargetId !== user?.id) {
      setRemotePointer(null);
      return;
    }
    const onRemotePointer = (event: Event) => {
      const position = (event as CustomEvent<RemotePointerPosition>).detail;
      if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) setRemotePointer(position);
    };
    window.addEventListener("screen-control:pointer", onRemotePointer);
    return () => window.removeEventListener("screen-control:pointer", onRemotePointer);
  }, [activeSessionId, activeSessionTargetId, user?.id]);
  const incomingRequests = useMemo(
    () =>
      sessions.filter((session) => session.status === "pending" && session.target_id === user?.id),
    [sessions, user?.id],
  );
  const outgoingRequests = useMemo(
    () =>
      sessions.filter(
        (session) => session.status === "pending" && session.requester_id === user?.id,
      ),
    [sessions, user?.id],
  );
  const recentResults = useMemo(
    () =>
      sessions
        .filter((session) => ["declined", "expired", "ended"].includes(session.status))
        .slice(0, 3),
    [sessions],
  );
  const isController = Boolean(activeSession && activeSession.requester_id === user?.id);
  const participantBusy = sessions.some(
    (session) => session.status === "pending" || session.status === "active",
  );

  const closeLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    localStreamSessionRef.current = null;
  }, []);

  const finishSession = useCallback(
    async (sessionId: string, reason = "ended_by_user") => {
      if (token) {
        try {
          await endScreenControlSession({ data: { sessionToken: token, sessionId, reason } });
        } catch (cause) {
          toast.error(
            cause instanceof Error ? cause.message : "Could not end the screen-control session.",
          );
        }
      }
      closeLocalStream();
      setRemoteStream(null);
      inputQueueRef.current = [];
      setSessions((current) => current.filter((session) => session.id !== sessionId));
    },
    [closeLocalStream, token],
  );

  const sendInput = useCallback((payload: RemoteInput) => {
    const channel = channelRef.current;
    if (channel?.readyState === "open" && channel.bufferedAmount < 128_000)
      channel.send(JSON.stringify(payload));
    else if (payload.type !== "move" && payload.type !== "wheel") {
      inputQueueRef.current = [...inputQueueRef.current, payload].slice(-40);
    }
  }, []);

  async function requestControl(targetId: string) {
    if (!token || participantBusy) return;
    setBusyId(targetId);
    try {
      await createScreenControlRequest({ data: { sessionToken: token, targetId } });
      toast.success("Request sent. The other user must accept it before screen sharing starts.");
      await refreshState(true);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not send the screen-control request.",
      );
      await refreshState(true);
    } finally {
      setBusyId(null);
    }
  }

  async function answerRequest(session: ScreenControlSession, accept: boolean) {
    if (!token) return;
    setBusyId(session.id);
    let captured: MediaStream | null = null;
    try {
      if (accept) {
        if (!navigator.mediaDevices?.getDisplayMedia)
          throw new Error(
            "Screen sharing is not available in this browser. Use the app over HTTPS in a supported browser.",
          );
        // This call must happen directly from the user's Accept click. The browser
        // shows its own chooser; the app cannot capture without the owner choosing.
        const captureOptions: DisplayMediaStreamOptions & { preferCurrentTab?: boolean } = {
          video: { displaySurface: "browser", frameRate: { ideal: 15, max: 24 } },
          audio: false,
          preferCurrentTab: true,
        };
        const backgroundVideo = document.querySelector<HTMLVideoElement>(".background-video-layer");
        if (backgroundVideo) {
          backgroundVideo.dataset.screenControlPaused = "true";
          backgroundVideo.pause();
        }
        captured = await navigator.mediaDevices.getDisplayMedia(captureOptions);
        localStreamRef.current = captured;
        localStreamSessionRef.current = session.id;
      }
      await respondToScreenControlRequest({
        data: { sessionToken: token, sessionId: session.id, accept },
      });
      if (!accept) toast.info("Screen-control request declined.");
      setOpen(false);
      await refreshState(true);
    } catch (cause) {
      captured?.getTracks().forEach((track) => track.stop());
      if (localStreamRef.current === captured) closeLocalStream();
      const backgroundVideo = document.querySelector<HTMLVideoElement>(".background-video-layer");
      if (backgroundVideo?.dataset.screenControlPaused === "true") {
        delete backgroundVideo.dataset.screenControlPaused;
        void backgroundVideo.play().catch(() => undefined);
      }
      toast.error(
        cause instanceof Error ? cause.message : "Could not respond to the screen-control request.",
      );
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (!activeSessionId || activeSessionStatus !== "active" || !token || !user?.id) {
      peerRef.current?.close();
      peerRef.current = null;
      channelRef.current = null;
      setRemoteStream(null);
      setConnectionState("waiting");
      inputQueueRef.current = [];
      if (!activeSessionId && localStreamRef.current) closeLocalStream();
      return;
    }

    const sessionId = activeSessionId;
    const isOwner = activeSessionTargetId === user.id;
    const ownedStream =
      isOwner && localStreamSessionRef.current === sessionId ? localStreamRef.current : null;
    if (isOwner && !ownedStream) return;

    let disposed = false;
    let signalCursor = 0;
    let pollingSignals = false;
    let remoteDescriptionSet = false;
    const queuedCandidates: RTCIceCandidateInit[] = [];
    const peer = new RTCPeerConnection(RTC_CONFIG);
    let restartTimer: number | null = null;
    let restartInFlight = false;
    let restartAttempts = 0;
    peerRef.current = peer;
    setConnectionState("connecting");
    signalErrorShown.current = false;

    const sendSignal = async (
      signalType: "offer" | "answer" | "ice",
      payload: Record<string, unknown>,
    ) => {
      if (disposed) return;
      await sendScreenControlSignal({
        data: { sessionToken: token, sessionId, signalType, payload },
      });
    };
    const restartConnection = async () => {
      if (disposed || !isOwner || restartInFlight || restartAttempts >= 3) return;
      restartInFlight = true;
      restartAttempts += 1;
      try {
        peer.restartIce();
        const offer = await peer.createOffer({ iceRestart: true });
        await peer.setLocalDescription(offer);
        if (peer.localDescription)
          await sendSignal(
            "offer",
            peer.localDescription.toJSON() as unknown as Record<string, unknown>,
          );
      } catch {
        // The next connection-state change or manual retry can try again.
      } finally {
        restartInFlight = false;
      }
    };
    const installControlChannel = (channel: RTCDataChannel) => {
      channelRef.current = channel;
      const flushQueuedInputs = () => {
        if (channel.readyState !== "open") return;
        const queued = inputQueueRef.current.splice(0);
        for (const payload of queued) {
          if (channel.bufferedAmount >= 128_000) {
            inputQueueRef.current.unshift(payload);
            break;
          }
          channel.send(JSON.stringify(payload));
        }
      };
      channel.onopen = flushQueuedInputs;
      flushQueuedInputs();
      channel.onmessage = (event) => {
        if (!isOwner) return;
        try {
          const message = JSON.parse(String(event.data)) as RemoteInput;
          dispatchRemoteInput(message);
        } catch {
          // Ignore malformed data-channel messages.
        }
      };
      channel.onclose = () => {
        if (channelRef.current === channel) channelRef.current = null;
      };
    };

    peer.onicecandidate = (event) => {
      if (event.candidate)
        void sendSignal(
          "ice",
          event.candidate.toJSON() as unknown as Record<string, unknown>,
        ).catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (disposed) return;
      setConnectionState(peer.connectionState);
      if (peer.connectionState === "connected") {
        restartAttempts = 0;
        if (restartTimer !== null) window.clearTimeout(restartTimer);
        restartTimer = null;
      } else if (
        isOwner &&
        (peer.connectionState === "disconnected" || peer.connectionState === "failed") &&
        restartAttempts < 3
      ) {
        if (restartTimer !== null) window.clearTimeout(restartTimer);
        restartTimer = window.setTimeout(() => void restartConnection(), 800);
      }
    };
    peer.ontrack = (event) => {
      if (!isOwner) setRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
    };
    peer.ondatachannel = (event) => installControlChannel(event.channel);

    if (isOwner && ownedStream) {
      ownedStream.getTracks().forEach((track) => {
        track.onended = () => void finishSession(sessionId, "screen_share_stopped");
        peer.addTrack(track, ownedStream);
      });
      installControlChannel(peer.createDataChannel("app-control", { ordered: true }));
      void (async () => {
        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          if (peer.localDescription)
            await sendSignal(
              "offer",
              peer.localDescription.toJSON() as unknown as Record<string, unknown>,
            );
        } catch (cause) {
          if (!disposed) {
            toast.error(cause instanceof Error ? cause.message : "Could not start screen sharing.");
            void finishSession(sessionId, "connection_failed");
          }
        }
      })();
    }

    const pollSignals = async () => {
      if (disposed || pollingSignals) return;
      pollingSignals = true;
      try {
        const signals = (await receiveScreenControlSignals({
          data: { sessionToken: token, sessionId, afterId: signalCursor },
        })) as ScreenSignal[];
        for (const signal of signals) {
          if (disposed || signal.id <= signalCursor) continue;
          signalCursor = signal.id;
          if (signal.signal_type === "offer" && !isOwner) {
            await peer.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit);
            remoteDescriptionSet = true;
            for (const candidate of queuedCandidates.splice(0))
              await peer.addIceCandidate(candidate);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            if (peer.localDescription)
              await sendSignal(
                "answer",
                peer.localDescription.toJSON() as unknown as Record<string, unknown>,
              );
          } else if (signal.signal_type === "answer" && isOwner) {
            await peer.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit);
            remoteDescriptionSet = true;
            for (const candidate of queuedCandidates.splice(0))
              await peer.addIceCandidate(candidate);
          } else if (signal.signal_type === "ice") {
            const candidate = signal.payload as RTCIceCandidateInit;
            if (remoteDescriptionSet) await peer.addIceCandidate(candidate);
            else queuedCandidates.push(candidate);
          }
        }
      } catch (cause) {
        if (!disposed && !signalErrorShown.current) {
          signalErrorShown.current = true;
          const message =
            cause instanceof Error ? cause.message : "The screen-control connection ended.";
          if (/ended|active|session/i.test(message)) void refreshState(true);
          else toast.error(message);
        }
      } finally {
        pollingSignals = false;
      }
    };
    void pollSignals();
    // Keep handshake and ICE-restart latency low without creating an unbounded
    // request loop; receiveScreenControlSignals returns at most 50 rows.
    const signalTimer = window.setInterval(() => void pollSignals(), 400);

    return () => {
      disposed = true;
      window.clearInterval(signalTimer);
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.ondatachannel = null;
      peer.close();
      if (peerRef.current === peer) peerRef.current = null;
      if (channelRef.current?.readyState !== "closed") channelRef.current?.close();
      channelRef.current = null;
      inputQueueRef.current = [];
      setRemoteStream(null);
      setConnectionState("waiting");
    };
  }, [
    activeSessionId,
    activeSessionStatus,
    activeSessionTargetId,
    closeLocalStream,
    finishSession,
    refreshState,
    token,
    user?.id,
  ]);

  useEffect(() => {
    if (!remoteStream) return;
    const video = document.querySelector<HTMLVideoElement>("[data-screen-control-video]");
    if (video && video.srcObject !== remoteStream) video.srcObject = remoteStream;
  }, [remoteStream]);

  const controller =
    user && isController && activeSession ? displayName(activeSession, user.id) : null;
  useEffect(() => {
    if (!controller) return;
    const previousTitle = document.title;
    document.title = `Remote app session · ${controller}`;
    return () => {
      document.title = previousTitle;
    };
  }, [controller]);

  if (!user) return null;

  const target = activeSession?.target_id === user.id ? displayName(activeSession, user.id) : null;
  const connectionLabel =
    connectionState === "connected"
      ? "Connected"
      : connectionState === "failed" || connectionState === "disconnected"
        ? "Reconnecting…"
        : "Connecting…";

  async function toggleWorkspaceFullscreen() {
    try {
      if (document.fullscreenElement === workspaceRef.current) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen();
    } catch {
      toast.error("Could not enter fullscreen mode in this browser.");
    }
  }

  return (
    <>
      {headerTarget &&
        createPortal(
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="relative h-8 shrink-0 gap-1.5 px-2"
                data-no-remote-control
                aria-label={`Share screen${incomingRequests.length ? `, ${incomingRequests.length} incoming request` : ""}`}
              >
                <MonitorUp className="size-4" />
                <span className="hidden xl:inline">Share screen</span>
                {incomingRequests.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                    {incomingRequests.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={10}
              className="w-[min(23rem,calc(100vw-1.5rem))] p-0"
              data-no-remote-control
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <ScreenShare className="size-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold">Screen sharing</h2>
                    <p className="text-[11px] text-muted-foreground">
                      Only users currently online are listed
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => void refreshState()}
                  aria-label="Refresh online users"
                >
                  {loading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
              </div>
              <div className="max-h-[min(70vh,34rem)] space-y-4 overflow-y-auto p-3">
                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                {incomingRequests.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Requests for your screen
                    </h3>
                    {incomingRequests.map((request) => (
                      <div
                        key={request.id}
                        className="rounded-lg border border-primary/30 bg-primary/5 p-3"
                      >
                        <p className="text-sm font-medium">
                          {request.requester.name} wants to view and control this app
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Accepting opens the browser’s screen-sharing chooser. Choose this app tab
                          if you only want to share it; you can stop sharing at any time.
                        </p>
                        <div className="mt-3 flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === request.id}
                            onClick={() => void answerRequest(request, false)}
                          >
                            <X className="size-3.5" /> Decline
                          </Button>
                          <Button
                            size="sm"
                            disabled={busyId === request.id}
                            onClick={() => void answerRequest(request, true)}
                          >
                            {busyId === request.id ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Accept & share
                          </Button>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                {activeSession && (
                  <div className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-xs text-green-950">
                    <MousePointer2 className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {isController
                          ? `Controlling ${controller}`
                          : `Sharing your screen with ${target}`}
                      </p>
                      <p className="mt-0.5">
                        {isController
                          ? connectionLabel
                          : "Your app tab is being shared. You can end this session at any time."}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void finishSession(activeSession.id)}
                    >
                      End
                    </Button>
                  </div>
                )}
                {outgoingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-xs"
                  >
                    <span>Waiting for {request.target.name} to accept…</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void finishSession(request.id, "cancelled_by_requester")}
                    >
                      Cancel
                    </Button>
                  </div>
                ))}
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Users className="size-3.5" /> Online users ({onlineUsers.length})
                  </h3>
                  {onlineUsers.length === 0 ? (
                    <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                      No other users are online right now.
                    </p>
                  ) : (
                    onlineUsers.map((person) => (
                      <div
                        key={person.id}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <UserRound className="size-4" />
                          <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-card bg-green-500" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{person.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            @{person.username} · {person.role}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={participantBusy || busyId === person.id}
                          onClick={() => void requestControl(person.id)}
                        >
                          {busyId === person.id ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <MonitorUp className="size-3.5" />
                          )}
                          Request
                        </Button>
                      </div>
                    ))
                  )}
                </section>
                {recentResults.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Recent sessions
                    </h3>
                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                      {recentResults.map((session) => (
                        <li key={session.id} className="flex justify-between gap-2">
                          <span>{displayName(session, user.id)}</span>
                          <span className="capitalize">
                            {session.status === "declined"
                              ? "Declined"
                              : session.end_reason === "request_timeout"
                                ? "Timed out"
                                : session.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                No recording. The screen owner must accept, then choose what to share in the browser
                prompt. Control is limited to this app tab.
              </div>
            </PopoverContent>
          </Popover>,
          headerTarget,
        )}

      {target && activeSession && (
        <div
          className="fixed inset-x-0 top-16 z-[60] flex items-center justify-center px-3 py-2"
          data-no-remote-control
          role="status"
        >
          <div className="flex max-w-3xl flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-400 bg-amber-50 px-4 py-2 text-xs text-amber-950 shadow-lg">
            <ShieldAlert className="size-4 shrink-0" />
            <span>
              Your selected screen is being shared with <strong>{target}</strong>; control is
              limited to this app tab.
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void finishSession(activeSession.id)}
            >
              Stop sharing
            </Button>
          </div>
        </div>
      )}

      {controller && activeSession && (
        <section
          ref={workspaceRef}
          className="fixed inset-0 z-[80] flex h-[100dvh] w-screen flex-col overflow-hidden bg-slate-950 text-white"
          aria-label={`Remote app session with ${controller}`}
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-background px-3 text-foreground shadow-sm sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <MonitorUp className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold sm:text-base">
                  Remote app session · {controller}
                </h1>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  Mouse, keyboard, drag, and scroll control · no recording
                </p>
              </div>
              <span
                className={`ml-1 hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                  connectionState === "connected"
                    ? "bg-green-100 text-green-800"
                    : connectionState === "failed"
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-800"
                }`}
                role="status"
                aria-live="polite"
              >
                {connectionLabel}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void toggleWorkspaceFullscreen()}
                aria-label={isWorkspaceFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isWorkspaceFullscreen ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
                <span className="hidden sm:inline">
                  {isWorkspaceFullscreen ? "Exit fullscreen" : "Fullscreen"}
                </span>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void finishSession(activeSession.id, "ended_by_controller")}
              >
                <X className="size-4" />
                <span>Disconnect</span>
              </Button>
            </div>
          </header>
          <div
            className="relative min-h-0 flex-1 overflow-hidden bg-black focus:outline-none"
            tabIndex={0}
            role="application"
            aria-label="Remote app screen. Click here to send mouse and keyboard input."
            onPointerMove={(event) => {
              const now = Date.now();
              if (now - lastMoveSentAt.current < 45) return;
              lastMoveSentAt.current = now;
              const point = getScreenPoint(event.currentTarget, event.clientX, event.clientY);
              if (point) sendInput({ type: "move", ...point, buttons: event.buttons });
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.focus();
              const point = getScreenPoint(event.currentTarget, event.clientX, event.clientY);
              if (point)
                sendInput({
                  type: "pointerdown",
                  ...point,
                  button: event.button,
                  buttons: event.buttons,
                });
            }}
            onPointerUp={(event) => {
              const point = getScreenPoint(event.currentTarget, event.clientX, event.clientY);
              if (point)
                sendInput({
                  type: "pointerup",
                  ...point,
                  button: event.button,
                  buttons: event.buttons,
                });
              if (point && event.button === 0)
                sendInput({ type: "click", ...point, button: event.button });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const point = getScreenPoint(event.currentTarget, event.clientX, event.clientY);
              if (point) sendInput({ type: "contextmenu", ...point, button: 2 });
            }}
            onWheel={(event) => {
              event.preventDefault();
              const point = getScreenPoint(event.currentTarget, event.clientX, event.clientY);
              if (point)
                sendInput({
                  type: "wheel",
                  ...point,
                  deltaX: event.deltaX,
                  deltaY: event.deltaY,
                });
            }}
            onKeyDown={(event) => {
              event.preventDefault();
              if (
                (event.ctrlKey || event.metaKey) &&
                ["r", "w", "l", "t", "n"].includes(event.key.toLowerCase())
              )
                return;
              if (event.altKey && event.key === "F4") return;
              sendInput({
                type: "key",
                key: event.key,
                code: event.code,
                down: true,
                ctrl: event.ctrlKey,
                alt: event.altKey,
                shift: event.shiftKey,
                meta: event.metaKey,
              });
              if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey)
                sendInput({ type: "text", text: event.key });
              if (event.key === "Backspace" || event.key === "Delete")
                sendInput({ type: "edit", key: event.key });
            }}
            onKeyUp={(event) => {
              event.preventDefault();
              sendInput({
                type: "key",
                key: event.key,
                code: event.code,
                down: false,
                ctrl: event.ctrlKey,
                alt: event.altKey,
                shift: event.shiftKey,
                meta: event.metaKey,
              });
            }}
          >
            {remoteStream ? (
              <video
                data-screen-control-video
                autoPlay
                playsInline
                muted
                className="block h-full w-full bg-black object-contain"
                onLoadedMetadata={(event) => void event.currentTarget.play().catch(() => undefined)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-white">
                <LoaderCircle className="size-8 animate-spin" />
                <p className="text-sm">{connectionLabel}. Waiting for the screen stream…</p>
              </div>
            )}
            {connectionState === "connected" && (
              <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-1.5 rounded-md bg-black/70 px-3 py-2 text-xs text-white">
                <MousePointer2 className="size-3.5" /> Click, scroll, and use your keyboard to
                control the app
              </div>
            )}
          </div>
        </section>
      )}
      {target && activeSession && remotePointer && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[200] -translate-x-1 -translate-y-1"
          data-no-remote-control
          style={{ left: remotePointer.x, top: remotePointer.y }}
        >
          <MousePointer2
            className="size-7 fill-red-600 stroke-white text-red-600 drop-shadow-[0_2px_3px_rgba(0,0,0,0.65)]"
            aria-label={`Remote cursor controlled by ${target}`}
          />
        </div>
      )}
    </>
  );
}
