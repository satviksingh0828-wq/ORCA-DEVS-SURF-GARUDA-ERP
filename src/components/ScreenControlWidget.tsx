import { useRouterState } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
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
import { ScreenControlConnectionHost } from "@/components/ScreenControlConnectionHost";
import {
  getScreenControlHostKey,
  screenControlHostChannelName,
  type HostCaptureRequest,
  type MainToHostMessage,
  type HostToMainMessage,
} from "@/lib/screen-control-host-bridge";
import {
  getWindowsAgentInstallerUrl,
  probeWindowsDesktopAgent,
  sendWindowsDesktopAgentInput,
  type WindowsAgentStatus,
} from "@/lib/windows-desktop-agent";
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

declare global {
  interface Window {
    electronAPI?: Record<string, unknown>;
  }
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
  bundlePolicy: "max-bundle",
  iceCandidatePoolSize: 10,
};

type HostCaptureWaiter = { resolve: () => void; reject: (error: Error) => void; timer: number };

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

function dispatchRemoteInput(input: RemoteInput, systemShare = false) {
  if (systemShare) {
    const nativeInput = window.electronAPI?.systemInput as
      ((payload: RemoteInput) => Promise<unknown>) | undefined;
    if (nativeInput) {
      void nativeInput(input).catch(() => undefined);
      return;
    }
    sendWindowsDesktopAgentInput(input);
    return;
  }
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

function getScreenOverlayPosition(container: HTMLElement, x: number, y: number) {
  const video = container.querySelector<HTMLVideoElement>("[data-screen-control-video]");
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const containerRect = container.getBoundingClientRect();
  const videoRect = video.getBoundingClientRect();
  const frameRatio = video.videoWidth / video.videoHeight;
  let frameWidth = videoRect.width;
  let frameHeight = videoRect.height;
  let frameLeft = videoRect.left;
  let frameTop = videoRect.top;
  if (videoRect.width / videoRect.height > frameRatio) {
    frameWidth = videoRect.height * frameRatio;
    frameLeft += (videoRect.width - frameWidth) / 2;
  } else {
    frameHeight = videoRect.width / frameRatio;
    frameTop += (videoRect.height - frameHeight) / 2;
  }
  return {
    left: frameLeft - containerRect.left + x * frameWidth,
    top: frameTop - containerRect.top + y * frameHeight,
  };
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
  const [controllerPointer, setControllerPointer] = useState<RemotePointerPosition | null>(null);
  const [localShareReady, setLocalShareReady] = useState(false);
  const [agentStatus, setAgentStatus] = useState<WindowsAgentStatus>({ state: "checking" });
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | "waiting">(
    "waiting",
  );
  const [isWorkspaceFullscreen, setIsWorkspaceFullscreen] = useState(false);
  const [hostCaptureState, setHostCaptureState] = useState<{
    sessionId: string | null;
    captureActive: boolean;
    peerState: RTCPeerConnectionState | "waiting";
  }>({ sessionId: null, captureActive: false, peerState: "waiting" });
  const [hostAvailable, setHostAvailable] = useState(false);
  const hostChannelRef = useRef<BroadcastChannel | null>(null);
  const hostChannelKeyRef = useRef("");
  const hostWindowRef = useRef<Window | null>(null);
  const hostLastSeenAtRef = useRef(0);
  const pendingHostCaptureRef = useRef<HostCaptureRequest | null>(null);
  const hostCaptureWaitersRef = useRef(new Map<string, HostCaptureWaiter>());
  const activeSessionRef = useRef<ScreenControlSession | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const inputQueueRef = useRef<RemoteInput[]>([]);
  const lastMoveSentAt = useRef(0);
  const pollLock = useRef(false);
  const signalErrorShown = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const controlSurfaceRef = useRef<HTMLDivElement>(null);
  const installerUrl = getWindowsAgentInstallerUrl();

  if (typeof window !== "undefined" && !hostChannelKeyRef.current)
    hostChannelKeyRef.current = getScreenControlHostKey();

  useEffect(() => {
    let mounted = true;
    if (window.electronAPI) {
      setAgentStatus({ state: "available", version: "Electron host" });
      return () => {
        mounted = false;
      };
    }
    const checkAgent = async () => {
      const status = await probeWindowsDesktopAgent();
      if (mounted) setAgentStatus(status);
    };
    void checkAgent();
    const timer = window.setInterval(() => void checkAgent(), 15_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

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
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [token]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.status === "active") ?? null,
    [sessions],
  );
  activeSessionRef.current = activeSession;
  const activeSessionId = activeSession?.id;
  const activeSessionStatus = activeSession?.status;
  const activeSessionTargetId = activeSession?.target_id;
  const activeShareScope = activeSession?.share_scope;
  useEffect(() => {
    if (!user?.id || typeof BroadcastChannel === "undefined") return;
    const hostKey = hostChannelKeyRef.current || getScreenControlHostKey();
    hostChannelKeyRef.current = hostKey;
    const channel = new BroadcastChannel(screenControlHostChannelName(user.id, hostKey));
    const captureWaiters = hostCaptureWaitersRef.current;
    hostChannelRef.current = channel;
    hostLastSeenAtRef.current = 0;
    channel.onmessage = (event: MessageEvent<HostToMainMessage>) => {
      const message = event.data;
      if (!message || message.ownerId !== user.id) return;
      if (message.type === "host:ready" || message.type === "host:alive") {
        hostLastSeenAtRef.current = Date.now();
        setHostAvailable(true);
        const pending = pendingHostCaptureRef.current;
        if (pending) {
          channel.postMessage({
            type: "main:capture",
            ownerId: user.id,
            ...pending,
          } satisfies MainToHostMessage);
        }
      } else if (message.type === "host:state") {
        hostLastSeenAtRef.current = Date.now();
        setHostAvailable(true);
        setHostCaptureState({
          sessionId: message.sessionId,
          captureActive: message.captureActive,
          peerState: message.peerState,
        });
      } else if (message.type === "host:capture-ready" || message.type === "host:capture-error") {
        const waiter = captureWaiters.get(message.requestId);
        if (!waiter) return;
        window.clearTimeout(waiter.timer);
        captureWaiters.delete(message.requestId);
        if (pendingHostCaptureRef.current?.requestId === message.requestId)
          pendingHostCaptureRef.current = null;
        if (message.type === "host:capture-ready") waiter.resolve();
        else waiter.reject(new Error(message.message));
      } else if (message.type === "host:input") {
        const current = activeSessionRef.current;
        if (
          current?.id === message.sessionId &&
          current.target_id === user.id &&
          current.share_scope === "app"
        )
          dispatchRemoteInput(message.input);
      } else if (message.type === "host:ended") {
        if (activeSessionRef.current?.id === message.sessionId) {
          setHostCaptureState({
            sessionId: message.sessionId,
            captureActive: false,
            peerState: "waiting",
          });
          void refreshState(true);
        }
      } else if (message.type === "host:closed") {
        hostLastSeenAtRef.current = 0;
        hostWindowRef.current = null;
        setHostAvailable(false);
        setHostCaptureState({ sessionId: null, captureActive: false, peerState: "waiting" });
      }
    };
    channel.postMessage({ type: "main:probe", ownerId: user.id } satisfies MainToHostMessage);
    const staleCheck = window.setInterval(() => {
      if (Date.now() - hostLastSeenAtRef.current > 4_000) setHostAvailable(false);
    }, 1_000);
    return () => {
      window.clearInterval(staleCheck);
      if (hostChannelRef.current === channel) hostChannelRef.current = null;
      channel.close();
      captureWaiters.forEach((waiter) => {
        window.clearTimeout(waiter.timer);
        waiter.reject(new Error("The main ERP window closed before screen sharing started."));
      });
      captureWaiters.clear();
    };
  }, [refreshState, user?.id]);
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
  useEffect(() => {
    setControllerPointer(null);
  }, [activeSessionId, activeShareScope]);
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

  const closeLocalStream = useCallback(
    (sessionId?: string) => {
      const id = sessionId ?? activeSessionRef.current?.id;
      if (id && user?.id)
        hostChannelRef.current?.postMessage({
          type: "main:stop",
          ownerId: user.id,
          sessionId: id,
        } satisfies MainToHostMessage);
      setLocalShareReady(false);
    },
    [user?.id],
  );

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
      closeLocalStream(sessionId);
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

  async function requestControl(targetId: string, shareScope: "app" | "system") {
    if (!token || participantBusy) return;
    setBusyId(targetId);
    try {
      await createScreenControlRequest({ data: { sessionToken: token, targetId, shareScope } });
      toast.success(
        `${shareScope === "system" ? "Full-system" : "App-only"} request sent. The other user must accept it.`,
      );
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

  function openScreenControlHost() {
    if (!user?.id || typeof BroadcastChannel === "undefined")
      throw new Error("This browser cannot open the screen-control connection host.");
    const hostIsRecent = hostAvailable && Date.now() - hostLastSeenAtRef.current < 4_000;
    if (window.electronAPI) return;
    if (hostIsRecent) return;
    if (hostWindowRef.current && !hostWindowRef.current.closed) return;
    const popupScreen = window.screen as Screen & { availLeft?: number; availTop?: number };
    const url = new URL("/screen-control-host", window.location.origin);
    url.searchParams.set("owner", user.id);
    url.hash = `host=${encodeURIComponent(hostChannelKeyRef.current || getScreenControlHostKey())}`;
    const popup = window.open(
      url.toString(),
      `orca-screen-control-${user.id}-${crypto.randomUUID()}`,
      [
        "popup=yes",
        `width=${window.screen.availWidth}`,
        `height=${window.screen.availHeight}`,
        `left=${popupScreen.availLeft ?? 0}`,
        `top=${popupScreen.availTop ?? 0}`,
        "resizable=yes",
        "scrollbars=no",
      ].join(","),
    );
    if (!popup)
      throw new Error(
        "Please allow the screen-control popup. It stays blank and only maintains the connection.",
      );
    hostWindowRef.current = popup;
  }

  function captureInHost(session: ScreenControlSession) {
    if (!user?.id || !token || !hostChannelRef.current)
      return Promise.reject(new Error("The main ERP window is not ready to start screen sharing."));
    const requestId = crypto.randomUUID();
    const request: HostCaptureRequest = {
      requestId,
      session: {
        id: session.id,
        requester_id: session.requester_id,
        target_id: session.target_id,
        share_scope: session.share_scope,
        requester: session.requester,
        target: session.target,
      },
      sessionToken: token,
    };
    pendingHostCaptureRef.current = request;
    openScreenControlHost();
    const promise = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        hostCaptureWaitersRef.current.delete(requestId);
        pendingHostCaptureRef.current = null;
        reject(new Error("The screen-sharing window did not finish opening. Please try again."));
      }, 60_000);
      hostCaptureWaitersRef.current.set(requestId, { resolve, reject, timer });
    });
    hostChannelRef.current.postMessage({
      type: "main:capture",
      ownerId: user.id,
      ...request,
    } satisfies MainToHostMessage);
    return promise;
  }

  async function answerRequest(session: ScreenControlSession, accept: boolean) {
    if (!token || !user?.id) return;
    setBusyId(session.id);
    try {
      if (accept) await captureInHost(session);
      await respondToScreenControlRequest({
        data: { sessionToken: token, sessionId: session.id, accept },
      });
      if (accept) {
        hostChannelRef.current?.postMessage({
          type: "main:start",
          ownerId: user.id,
          session: { ...session, status: "active" },
          sessionToken: token,
        } satisfies MainToHostMessage);
        setLocalShareReady(true);
        const backgroundVideo = document.querySelector<HTMLVideoElement>(".background-video-layer");
        if (backgroundVideo) {
          backgroundVideo.dataset.screenControlPaused = "true";
          backgroundVideo.pause();
        }
      } else toast.info("Screen-control request declined.");
      pendingHostCaptureRef.current = null;
      setOpen(false);
      await refreshState(true);
    } catch (cause) {
      pendingHostCaptureRef.current = null;
      hostChannelRef.current?.postMessage({
        type: "main:stop",
        ownerId: user.id,
        sessionId: session.id,
      } satisfies MainToHostMessage);
      toast.error(
        cause instanceof Error ? cause.message : "Could not respond to the screen-control request.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function resumeScreenShare(session: ScreenControlSession) {
    if (!token || !user?.id || session.status !== "active" || session.target_id !== user.id) return;
    setBusyId(session.id);
    try {
      await captureInHost(session);
      hostChannelRef.current?.postMessage({
        type: "main:start",
        ownerId: user.id,
        session: { ...session, status: "active" },
        sessionToken: token,
      } satisfies MainToHostMessage);
      setLocalShareReady(true);
      toast.success("Screen sharing resumed in the connection window.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not resume screen sharing.");
    } finally {
      pendingHostCaptureRef.current = null;
      setBusyId(null);
    }
  }

  useEffect(() => {
    const ownerIsSharing = activeSession?.target_id === user?.id;
    setLocalShareReady(
      Boolean(
        ownerIsSharing &&
        hostCaptureState.sessionId === activeSession?.id &&
        hostCaptureState.captureActive,
      ),
    );
  }, [activeSession?.id, activeSession?.target_id, hostCaptureState, user?.id]);

  useEffect(() => {
    if (
      !activeSession ||
      activeSession.target_id !== user?.id ||
      activeSession.status !== "active" ||
      hostCaptureState.sessionId !== activeSession.id ||
      !hostCaptureState.captureActive ||
      hostCaptureState.peerState !== "waiting" ||
      !token ||
      !user?.id
    )
      return;
    hostChannelRef.current?.postMessage({
      type: "main:start",
      ownerId: user.id,
      session: { ...activeSession, status: "active" },
      sessionToken: token,
    } satisfies MainToHostMessage);
  }, [activeSession, hostCaptureState, token, user?.id]);

  useEffect(() => {
    if (!activeSessionId || activeSessionStatus !== "active" || !token || !user?.id) {
      peerRef.current?.close();
      peerRef.current = null;
      channelRef.current = null;
      setRemoteStream(null);
      setConnectionState("waiting");
      inputQueueRef.current = [];
      return;
    }

    const sessionId = activeSessionId;
    const isOwner = activeSessionTargetId === user.id;
    if (isOwner) {
      peerRef.current?.close();
      peerRef.current = null;
      channelRef.current = null;
      setRemoteStream(null);
      setConnectionState("waiting");
      return;
    }

    let disposed = false;
    let signalCursor = 0;
    let pollingSignals = false;
    let remoteDescriptionSet = false;
    const queuedCandidates: RTCIceCandidateInit[] = [];
    const peer = new RTCPeerConnection(RTC_CONFIG);
    let restartTimer: number | null = null;
    let connectionTimeout: number | null = null;
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
      if (disposed || !isOwner || restartInFlight || restartAttempts >= 8) return;
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
          dispatchRemoteInput(message, activeShareScope === "system");
        } catch {
          // Ignore malformed data-channel messages.
        }
      };
      channel.onclose = () => {
        if (channelRef.current !== channel || disposed) return;
        channelRef.current = null;
        if (isOwner) {
          const replacement = peer.createDataChannel("app-control", { ordered: true });
          installControlChannel(replacement);
          void restartConnection();
        }
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
        if (connectionTimeout !== null) window.clearTimeout(connectionTimeout);
        connectionTimeout = null;
      } else if (
        isOwner &&
        (peer.connectionState === "disconnected" || peer.connectionState === "failed") &&
        restartAttempts < 8
      ) {
        if (restartTimer !== null) window.clearTimeout(restartTimer);
        restartTimer = window.setTimeout(() => void restartConnection(), 800);
      }
    };
    peer.ontrack = (event) => {
      if (!isOwner) setRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
    };
    peer.ondatachannel = (event) => installControlChannel(event.channel);
    connectionTimeout = window.setTimeout(() => void restartConnection(), 8_000);

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
      if (connectionTimeout !== null) window.clearTimeout(connectionTimeout);
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
    activeShareScope,
    closeLocalStream,
    finishSession,
    localShareReady,
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
      {window.electronAPI && (
        <ScreenControlConnectionHost ownerId={user.id} hostKey={hostChannelKeyRef.current} />
      )}
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
                          {request.requester.name} requests{" "}
                          {request.share_scope === "system" ? "full system" : "this app"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {request.share_scope === "system"
                            ? "Accepting lets the Windows tray agent share and control your full desktop after you approve in Windows. Do not share passwords or other sensitive windows."
                            : "Accepting shares only the ERP app surface. You can stop sharing at any time."}
                        </p>
                        {request.share_scope === "system" && agentStatus.state !== "available" && (
                          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                            <p>
                              {agentStatus.state === "checking"
                                ? "Checking for the Windows desktop tray agent…"
                                : agentStatus.reason ||
                                  "The Windows desktop tray agent is not detected. Install and start it to share the full desktop."}
                            </p>
                            {agentStatus.state === "missing" && installerUrl ? (
                              <a
                                href={installerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex items-center gap-1 font-semibold underline"
                              >
                                <Download className="size-3.5" /> Install Windows tray agent
                              </a>
                            ) : agentStatus.state === "missing" ? (
                              <p className="mt-1">
                                Ask your administrator for the signed installer.
                              </p>
                            ) : null}
                          </div>
                        )}
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
                            disabled={
                              busyId === request.id ||
                              (request.share_scope === "system" &&
                                agentStatus.state !== "available")
                            }
                            onClick={() => void answerRequest(request, true)}
                          >
                            {busyId === request.id ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Accept & share {request.share_scope === "system" ? "system" : "app"}
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
                          : activeSession.share_scope === "system"
                            ? "Your full Windows desktop is being shared. You can end this session at any time."
                            : "This app is being shared. You can end this session at any time."}
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
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={participantBusy || busyId === person.id}
                            onClick={() => void requestControl(person.id, "app")}
                          >
                            App
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={participantBusy || busyId === person.id}
                            onClick={() => void requestControl(person.id, "system")}
                          >
                            System
                          </Button>
                        </div>
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
                No recording. The screen owner must accept in the app and approve again in the
                Windows tray agent for full-desktop control. App-only sharing is unchanged.
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
              {activeSession.share_scope === "system"
                ? "Your full Windows desktop is being shared with "
                : "Your selected app screen is being shared with "}
              <strong>{target}</strong>
              {activeSession.share_scope === "system"
                ? "; remote desktop control is enabled."
                : "."}
            </span>
            {!localShareReady &&
              (activeSession.share_scope !== "app" ||
                typeof window === "undefined" ||
                !window.electronAPI) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === activeSession.id}
                  onClick={() => void resumeScreenShare(activeSession)}
                >
                  {busyId === activeSession.id ? "Resuming…" : "Resume sharing"}
                </Button>
              )}
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
          aria-label={`${activeSession.share_scope === "system" ? "Remote Windows desktop" : "Remote app session"} with ${controller}`}
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-background px-3 text-foreground shadow-sm sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <MonitorUp className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold sm:text-base">
                  {activeSession.share_scope === "system"
                    ? "Remote Windows desktop"
                    : "Remote app session"}{" "}
                  · {controller}
                </h1>
                <p className="hidden text-xs text-muted-foreground sm:block">
                  {activeSession.share_scope === "system"
                    ? "Full desktop · mouse and keyboard control · no recording"
                    : "App window · mouse, keyboard, drag, and scroll control · no recording"}
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
            ref={controlSurfaceRef}
            className="relative min-h-0 flex-1 overflow-hidden bg-black focus:outline-none"
            tabIndex={0}
            role="application"
            aria-label={
              activeSession.share_scope === "system"
                ? "Remote Windows desktop. Click here to send mouse and keyboard input."
                : "Remote app screen. Click here to send mouse and keyboard input."
            }
            onPointerMove={(event) => {
              const point = getScreenPoint(event.currentTarget, event.clientX, event.clientY);
              if (point && activeSession.share_scope === "system") setControllerPointer(point);
              const now = Date.now();
              if (now - lastMoveSentAt.current < 45) return;
              lastMoveSentAt.current = now;
              if (point) sendInput({ type: "move", ...point, buttons: event.buttons });
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.focus();
              const point = getScreenPoint(event.currentTarget, event.clientX, event.clientY);
              if (point && activeSession.share_scope === "system") setControllerPointer(point);
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
              if (point && activeSession.share_scope === "system") setControllerPointer(point);
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
            {activeSession.share_scope === "system" && controllerPointer && remoteStream && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-10"
                data-no-remote-control
                style={
                  getScreenOverlayPosition(
                    controlSurfaceRef.current ?? document.body,
                    controllerPointer.x,
                    controllerPointer.y,
                  ) ?? undefined
                }
              >
                <MousePointer2 className="size-7 -translate-x-1 -translate-y-1 fill-red-600 stroke-white text-red-600 drop-shadow-[0_2px_3px_rgba(0,0,0,0.65)]" />
              </div>
            )}
            {connectionState === "connected" && (
              <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-1.5 rounded-md bg-black/70 px-3 py-2 text-xs text-white">
                <MousePointer2 className="size-3.5" /> Click, scroll, and use your keyboard to
                control {activeSession.share_scope === "system" ? "the desktop" : "the app"}
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
