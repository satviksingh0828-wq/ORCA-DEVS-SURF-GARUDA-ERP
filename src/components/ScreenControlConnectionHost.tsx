import { useEffect } from "react";
import {
  receiveScreenControlSignals,
  sendScreenControlSignal,
  endScreenControlSession,
  type ScreenSignal,
} from "@/lib/screen-control";
import {
  screenControlHostChannelName,
  type HostCaptureRequest,
  type HostToMainPayload,
  type HostToMainMessage,
  type MainToHostMessage,
} from "@/lib/screen-control-host-bridge";
import {
  sendWindowsDesktopAgentInput,
  startWindowsDesktopAgentCapture,
  stopWindowsDesktopAgentCapture,
  type AgentRemoteInput,
} from "@/lib/windows-desktop-agent";
import { OrcaLogo } from "@/components/OrcaLogo";
import { PoweredBy } from "@/components/PoweredBy";

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

type HostSession = HostCaptureRequest["session"] & { status: "active" | "pending" };

function asRemoteInput(value: unknown): AgentRemoteInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    ["move", "pointerdown", "pointerup", "click", "contextmenu"].includes(String(input.type)) &&
    Number.isFinite(input.x) &&
    Number.isFinite(input.y)
  )
    return input as AgentRemoteInput;
  if (
    input.type === "wheel" &&
    Number.isFinite(input.x) &&
    Number.isFinite(input.y) &&
    Number.isFinite(input.deltaX) &&
    Number.isFinite(input.deltaY)
  )
    return input as AgentRemoteInput;
  if (input.type === "key" && typeof input.key === "string" && typeof input.code === "string")
    return input as AgentRemoteInput;
  if (input.type === "text" && typeof input.text === "string") return input as AgentRemoteInput;
  if (input.type === "edit" && ["Backspace", "Delete"].includes(String(input.key)))
    return input as AgentRemoteInput;
  return null;
}

export function ScreenControlConnectionHost({
  ownerId: inlineOwnerId,
  hostKey: inlineHostKey,
}: {
  ownerId?: string;
  hostKey?: string;
} = {}) {
  useEffect(() => {
    const ownerId = inlineOwnerId ?? new URLSearchParams(window.location.search).get("owner");
    const hostKey = inlineHostKey ?? new URLSearchParams(window.location.hash.slice(1)).get("host");
    if (!ownerId || !hostKey || typeof BroadcastChannel === "undefined") {
      if (!inlineOwnerId) window.close();
      return;
    }

    const hostId = crypto.randomUUID();
    const channel = new BroadcastChannel(screenControlHostChannelName(ownerId, hostKey));
    let session: HostSession | null = null;
    let sessionToken = "";
    let stream: MediaStream | null = null;
    let peer: RTCPeerConnection | null = null;
    let captureRequestId: string | null = null;
    const captureRequestIds = new Set<string>();
    let signalCursor = 0;
    let signalTimer: number | null = null;
    let stateTimer: number | null = null;
    let disposed = false;
    let polling = false;
    let restartInFlight = false;
    let restartAttempts = 0;
    let remoteDescriptionSet = false;
    const queuedCandidates: RTCIceCandidateInit[] = [];

    const sendToMain = (message: HostToMainPayload) => {
      channel.postMessage({ ...message, ownerId, hostId } satisfies HostToMainMessage);
    };
    const reportState = () => {
      sendToMain({
        type: "host:state",
        sessionId: session?.id ?? null,
        captureActive: Boolean(
          stream?.getVideoTracks().some((track) => track.readyState === "live"),
        ),
        peerState: peer?.connectionState ?? "waiting",
      });
    };
    const stopPeer = () => {
      if (signalTimer !== null) window.clearInterval(signalTimer);
      signalTimer = null;
      const currentPeer = peer;
      peer = null;
      if (currentPeer) {
        currentPeer.onicecandidate = null;
        currentPeer.onconnectionstatechange = null;
        currentPeer.oniceconnectionstatechange = null;
        currentPeer.close();
      }
      signalCursor = 0;
      polling = false;
      remoteDescriptionSet = false;
      queuedCandidates.length = 0;
      restartAttempts = 0;
      restartInFlight = false;
    };
    const stopCapture = () => {
      const currentStream = stream;
      stream = null;
      stopWindowsDesktopAgentCapture(session?.id);
      currentStream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    };
    const stopSession = async (endOnServer: boolean, reason = "ended_by_user") => {
      const current = session;
      const currentToken = sessionToken;
      stopPeer();
      stopCapture();
      captureRequestId = null;
      captureRequestIds.clear();
      session = null;
      sessionToken = "";
      reportState();
      if (current && endOnServer && currentToken)
        await endScreenControlSession({
          data: { sessionToken: currentToken, sessionId: current.id, reason },
        }).catch(() => undefined);
      if (current) sendToMain({ type: "host:ended", sessionId: current.id, reason });
    };

    const captureScreen = async (request: HostCaptureRequest) => {
      if (disposed || request.session.target_id !== ownerId) return;
      if (captureRequestId === request.requestId) return;
      if (captureRequestId) {
        if (session?.id === request.session.id) {
          captureRequestIds.add(request.requestId);
          session = { ...request.session, status: "pending" };
          sessionToken = request.sessionToken;
        } else {
          sendToMain({
            type: "host:capture-error",
            requestId: request.requestId,
            message: "Another screen picker is still open. Finish or close it before retrying.",
          });
        }
        return;
      }
      if (stream?.getVideoTracks().some((track) => track.readyState === "live")) {
        sendToMain({ type: "host:capture-ready", requestId: request.requestId });
        return;
      }
      captureRequestId = request.requestId;
      captureRequestIds.clear();
      captureRequestIds.add(request.requestId);
      session = { ...request.session, status: "pending" };
      sessionToken = request.sessionToken;
      try {
        let captured: MediaStream;
        if (request.session.share_scope === "system" && !window.electronAPI) {
          captured = await startWindowsDesktopAgentCapture(
            request.session.id,
            request.session.requester.name,
          );
        } else {
          if (!navigator.mediaDevices?.getDisplayMedia)
            throw new Error(
              "Screen sharing is not available in this browser. Use the ERP over HTTPS in a supported browser.",
            );
          const setElectronCaptureScope = window.electronAPI?.screenCaptureScope as
            ((scope: string) => Promise<unknown>) | undefined;
          await setElectronCaptureScope?.(request.session.share_scope);
          captured = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: request.session.share_scope === "system" ? "monitor" : "window",
              frameRate: { ideal: 15, max: 24 },
            },
            audio: false,
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
          } as DisplayMediaStreamOptions & {
            preferCurrentTab?: boolean;
            selfBrowserSurface?: string;
          });
        }
        if (
          disposed ||
          captureRequestId !== request.requestId ||
          session?.id !== request.session.id
        ) {
          captured.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = captured;
        captureRequestId = null;
        const completedRequestIds = [...captureRequestIds];
        captureRequestIds.clear();
        captured.getTracks().forEach((track) => {
          track.onended = () => {
            if (stream !== captured || disposed) return;
            void stopSession(true, "screen_share_stopped");
          };
        });
        reportState();
        for (const requestId of completedRequestIds)
          sendToMain({ type: "host:capture-ready", requestId });
      } catch (cause) {
        if (captureRequestId !== request.requestId || session?.id !== request.session.id) return;
        captureRequestId = null;
        const failedRequestIds = [...captureRequestIds];
        captureRequestIds.clear();
        session = null;
        sessionToken = "";
        for (const requestId of failedRequestIds)
          sendToMain({
            type: "host:capture-error",
            requestId,
            message: cause instanceof Error ? cause.message : "Could not start screen sharing.",
          });
        reportState();
        if (!inlineOwnerId) window.setTimeout(() => window.close(), 150);
      }
    };

    const sendSignal = async (
      signalType: "offer" | "answer" | "ice",
      payload: Record<string, unknown>,
    ) => {
      if (disposed || !session || !sessionToken) return;
      await sendScreenControlSignal({
        data: { sessionToken, sessionId: session.id, signalType, payload },
      });
    };

    const restartConnection = async (currentPeer: RTCPeerConnection) => {
      if (peer !== currentPeer || !session || restartInFlight || restartAttempts >= 8) return;
      restartInFlight = true;
      restartAttempts += 1;
      try {
        currentPeer.restartIce();
        const offer = await currentPeer.createOffer({ iceRestart: true });
        await currentPeer.setLocalDescription(offer);
        if (peer === currentPeer && currentPeer.localDescription)
          await sendSignal(
            "offer",
            currentPeer.localDescription.toJSON() as unknown as Record<string, unknown>,
          );
      } catch {
        // Retry on the next ICE/connection state change.
      } finally {
        if (peer === currentPeer) restartInFlight = false;
      }
    };

    const startPeer = async (start: Extract<MainToHostMessage, { type: "main:start" }>) => {
      if (start.ownerId !== ownerId || start.session.target_id !== ownerId) return;
      if (!stream?.getVideoTracks().some((track) => track.readyState === "live")) {
        sendToMain({
          type: "host:capture-error",
          requestId: `active:${start.session.id}`,
          message:
            "The screen-capture track is no longer active. Choose Resume sharing in the main ERP window.",
        });
        return;
      }
      if (peer && session?.id === start.session.id) return;
      stopPeer();
      session = { ...start.session, status: "active" };
      sessionToken = start.sessionToken;
      signalCursor = 0;
      const currentPeer = new RTCPeerConnection(RTC_CONFIG);
      peer = currentPeer;
      currentPeer.onicecandidate = (event) => {
        if (event.candidate)
          void sendSignal(
            "ice",
            event.candidate.toJSON() as unknown as Record<string, unknown>,
          ).catch(() => undefined);
      };
      currentPeer.onconnectionstatechange = () => {
        if (peer !== currentPeer) return;
        reportState();
        if (currentPeer.connectionState === "connected") restartAttempts = 0;
        else if (["disconnected", "failed"].includes(currentPeer.connectionState))
          window.setTimeout(() => void restartConnection(currentPeer), 800);
      };
      currentPeer.oniceconnectionstatechange = () => {
        if (peer !== currentPeer) return;
        if (currentPeer.iceConnectionState === "failed") void restartConnection(currentPeer);
      };
      stream.getTracks().forEach((track) => currentPeer.addTrack(track, stream as MediaStream));
      const control = currentPeer.createDataChannel("app-control", { ordered: true });
      control.onmessage = (event) => {
        if (peer !== currentPeer || session?.id !== start.session.id) return;
        let input: AgentRemoteInput | null = null;
        try {
          input = asRemoteInput(JSON.parse(String(event.data)));
        } catch {
          return;
        }
        if (!input) return;
        if (start.session.share_scope === "system") sendWindowsDesktopAgentInput(input);
        else sendToMain({ type: "host:input", sessionId: start.session.id, input });
      };
      const offer = await currentPeer.createOffer();
      await currentPeer.setLocalDescription(offer);
      if (currentPeer.localDescription)
        await sendSignal(
          "offer",
          currentPeer.localDescription.toJSON() as unknown as Record<string, unknown>,
        );
      reportState();

      const pollSignals = async () => {
        if (disposed || peer !== currentPeer || polling || !session) return;
        polling = true;
        try {
          const signals = (await receiveScreenControlSignals({
            data: { sessionToken, sessionId: start.session.id, afterId: signalCursor },
          })) as ScreenSignal[];
          for (const signal of signals) {
            if (disposed || peer !== currentPeer || signal.id <= signalCursor) continue;
            signalCursor = signal.id;
            if (signal.signal_type === "answer") {
              await currentPeer.setRemoteDescription(
                signal.payload as unknown as RTCSessionDescriptionInit,
              );
              remoteDescriptionSet = true;
              for (const candidate of queuedCandidates.splice(0))
                await currentPeer.addIceCandidate(candidate);
            } else if (signal.signal_type === "offer") {
              await currentPeer.setRemoteDescription(
                signal.payload as unknown as RTCSessionDescriptionInit,
              );
              remoteDescriptionSet = true;
              for (const candidate of queuedCandidates.splice(0))
                await currentPeer.addIceCandidate(candidate);
              const answer = await currentPeer.createAnswer();
              await currentPeer.setLocalDescription(answer);
              if (currentPeer.localDescription)
                await sendSignal(
                  "answer",
                  currentPeer.localDescription.toJSON() as unknown as Record<string, unknown>,
                );
            } else if (signal.signal_type === "ice") {
              const candidate = signal.payload as RTCIceCandidateInit;
              if (remoteDescriptionSet) await currentPeer.addIceCandidate(candidate);
              else queuedCandidates.push(candidate);
            }
          }
        } catch (cause) {
          if (/ended|active|session/i.test(cause instanceof Error ? cause.message : ""))
            void stopSession(false, "session_ended");
        } finally {
          polling = false;
        }
      };
      void pollSignals();
      signalTimer = window.setInterval(() => void pollSignals(), 400);
    };

    channel.onmessage = (event: MessageEvent<MainToHostMessage | HostToMainMessage>) => {
      const message = event.data;
      if (!message || message.ownerId !== ownerId || disposed) return;
      if (message.type === "main:probe") {
        sendToMain({ type: "host:alive" });
      } else if (message.type === "main:capture" || message.type === "main:resume") {
        void captureScreen(message);
      } else if (message.type === "main:start") {
        void startPeer(message).catch((cause) => {
          sendToMain({
            type: "host:capture-error",
            requestId: `active:${message.session.id}`,
            message:
              cause instanceof Error ? cause.message : "Could not establish the screen connection.",
          });
          void stopSession(false, "connection_failed");
        });
      } else if (message.type === "main:stop" && session?.id === message.sessionId) {
        void stopSession(false, "ended_by_user");
        if (!inlineOwnerId) window.setTimeout(() => window.close(), 100);
      }
    };

    channel.postMessage({ type: "host:ready", ownerId, hostId } satisfies HostToMainMessage);
    stateTimer = window.setInterval(() => {
      sendToMain({ type: "host:ready" });
      reportState();
    }, 1_000);
    const onPageHide = () => {
      channel.postMessage({ type: "host:closed", ownerId, hostId } satisfies HostToMainMessage);
      if (!sessionToken || !session) return;
      const body = JSON.stringify({ sessionToken });
      try {
        navigator.sendBeacon?.(
          "/api/screen-control/disconnect",
          new Blob([body], { type: "application/json" }),
        );
      } catch {
        // The host is closing; server cleanup is best-effort.
      }
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      if (stateTimer !== null) window.clearInterval(stateTimer);
      if (signalTimer !== null) window.clearInterval(signalTimer);
      window.removeEventListener("pagehide", onPageHide);
      channel.close();
      stopPeer();
      stopCapture();
    };
  }, [inlineHostKey, inlineOwnerId]);

  if (inlineOwnerId) return null;

  return (
    <main className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#07101d] text-slate-50">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-40 size-[34rem] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -bottom-48 -right-32 size-[38rem] rounded-full bg-blue-600/10 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(15,36,57,0.28),transparent_62%)]" />
      </div>

      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <section className="w-full max-w-2xl text-center">
          <div className="relative mx-auto mb-10 flex size-36 items-center justify-center rounded-full border border-cyan-100/15 bg-white/[0.035] shadow-[0_0_100px_rgba(34,211,238,0.10)] sm:size-44">
            <div className="absolute inset-2 rounded-full border border-white/[0.08]" />
            <OrcaLogo className="size-24 text-white drop-shadow-[0_0_24px_rgba(103,232,249,0.45)] sm:size-28" />
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/75">
            ORCA DEVS SURF · CONNECTION WINDOW
          </p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-5xl">
            Screen sharing stays connected here
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
            Do not close this window. Return to the main ERP site to manage screen-sharing requests
            and controls.
          </p>

          <div className="mt-9 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2.5 text-sm text-slate-300">
            <span className="relative flex size-2.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300/60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-300" />
            </span>
            Leave this window open while sharing
          </div>
        </section>
      </div>

      <footer className="relative flex min-h-16 items-center justify-center border-t border-white/[0.08] px-4 py-4">
        <PoweredBy
          className="gap-2 text-[11px] tracking-[0.16em] text-slate-400 transition-colors hover:text-white"
          logoClassName="size-4 text-cyan-200"
        />
      </footer>
    </main>
  );
}
