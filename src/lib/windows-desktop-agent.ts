export type WindowsAgentStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "missing"; reason?: string };

export type AgentRemoteInput =
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

type AgentHello = {
  type: "agent.hello";
  protocol: number;
  version: string;
  capabilities: string[];
};

type AgentMessage = Record<string, unknown> & { type: string };

const PROTOCOL_VERSION = 1;
const CONNECT_TIMEOUT_MS = 1_800;
const CAPTURE_APPROVAL_TIMEOUT_MS = 120_000;
const LOCAL_RTC_CONFIG: RTCConfiguration = { iceServers: [] };
const AGENT_WS_URL = import.meta.env.VITE_WINDOWS_AGENT_WS_URL || "ws://127.0.0.1:17654/v1";
const INSTALLER_URL = import.meta.env.VITE_WINDOWS_DESKTOP_AGENT_INSTALLER_URL || "";

type ActiveCapture = {
  sessionId: string;
  socket: WebSocket;
  peer: RTCPeerConnection;
  stream: MediaStream | null;
};

let activeCapture: ActiveCapture | null = null;

export function getWindowsAgentInstallerUrl() {
  return INSTALLER_URL;
}

function parseAgentMessage(data: unknown): AgentMessage | null {
  try {
    const message = JSON.parse(String(data)) as AgentMessage;
    return message && typeof message.type === "string" ? message : null;
  } catch {
    return null;
  }
}

function sendJson(socket: WebSocket, message: Record<string, unknown>) {
  if (socket.readyState !== WebSocket.OPEN)
    throw new Error("The Windows desktop agent disconnected.");
  socket.send(JSON.stringify(message));
}

function openAgentSocket(): Promise<{ socket: WebSocket; hello: AgentHello }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: WebSocket;
    const timeout = window.setTimeout(() => {
      finish(new Error("The Windows desktop agent did not respond."));
    }, CONNECT_TIMEOUT_MS);
    const finish = (error?: Error, hello?: AgentHello) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (error) {
        try {
          socket?.close();
        } catch {
          // The socket may not have finished opening.
        }
        reject(error);
      } else if (hello) resolve({ socket, hello });
      else reject(new Error("The Windows desktop agent returned an invalid handshake."));
    };

    try {
      socket = new WebSocket(AGENT_WS_URL);
    } catch {
      finish(new Error("The Windows desktop agent is not installed or running."));
      return;
    }
    socket.onopen = () => {
      try {
        sendJson(socket, { type: "client.hello", protocol: PROTOCOL_VERSION });
      } catch {
        finish(new Error("Could not start a connection to the Windows desktop agent."));
      }
    };
    socket.onmessage = (event) => {
      const message = parseAgentMessage(event.data);
      if (message?.type !== "agent.hello") return;
      const hello = message as unknown as AgentHello;
      if (
        hello.protocol !== PROTOCOL_VERSION ||
        typeof hello.version !== "string" ||
        !Array.isArray(hello.capabilities)
      ) {
        finish(
          new Error("The installed Windows desktop agent uses an unsupported protocol version."),
        );
        return;
      }
      finish(undefined, hello);
    };
    socket.onerror = () =>
      finish(new Error("The Windows desktop agent is not installed or running."));
    socket.onclose = () => {
      if (!settled) finish(new Error("The Windows desktop agent closed the connection."));
    };
  });
}

export async function probeWindowsDesktopAgent(): Promise<WindowsAgentStatus> {
  if (typeof window === "undefined" || typeof WebSocket === "undefined")
    return {
      state: "missing",
      reason: "This browser cannot connect to the Windows desktop agent.",
    };
  try {
    const { socket, hello } = await openAgentSocket();
    socket.close(1000, "discovery complete");
    if (!hello.capabilities.includes("desktop-capture") || !hello.capabilities.includes("input"))
      return {
        state: "missing",
        reason: "The installed agent is missing desktop-control capabilities.",
      };
    return { state: "available", version: hello.version };
  } catch (cause) {
    return {
      state: "missing",
      reason: cause instanceof Error ? cause.message : "The Windows desktop agent is unavailable.",
    };
  }
}

export async function startWindowsDesktopAgentCapture(
  sessionId: string,
  requesterName: string,
): Promise<MediaStream> {
  stopWindowsDesktopAgentCapture();
  const { socket, hello } = await openAgentSocket();
  if (!hello.capabilities.includes("desktop-capture") || !hello.capabilities.includes("input")) {
    socket.close();
    throw new Error(
      "This Windows desktop agent does not support desktop capture and input control.",
    );
  }

  const peer = new RTCPeerConnection(LOCAL_RTC_CONFIG);
  const capture: ActiveCapture = { sessionId, socket, peer, stream: null };
  activeCapture = capture;
  let settled = false;
  let approvalReceived = false;
  let pendingStream: MediaStream | null = null;
  let remoteDescriptionSet = false;
  const queuedCandidates: RTCIceCandidateInit[] = [];

  return await new Promise<MediaStream>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      fail(new Error("The Windows user did not approve desktop sharing in time."));
    }, CAPTURE_APPROVAL_TIMEOUT_MS);
    const cleanupListeners = () => {
      window.clearTimeout(timeout);
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      if (activeCapture === capture) activeCapture = null;
      try {
        if (socket.readyState === WebSocket.OPEN)
          sendJson(socket, { type: "capture.stop", protocol: PROTOCOL_VERSION, sessionId });
      } catch {
        // Best-effort cleanup when the agent has already disconnected.
      }
      peer.close();
      socket.close();
      reject(error);
    };
    const resolveApprovedStream = (stream: MediaStream) => {
      if (settled || !approvalReceived) return;
      settled = true;
      cleanupListeners();
      capture.stream = stream;
      socket.onclose = () => {
        if (activeCapture !== capture) return;
        activeCapture = null;
        stream.getTracks().forEach((track) => track.stop());
        peer.close();
      };
      socket.onerror = () => socket.close();
      peer.onconnectionstatechange = () => {
        if (
          activeCapture === capture &&
          (peer.connectionState === "failed" || peer.connectionState === "closed")
        ) {
          activeCapture = null;
          stream.getTracks().forEach((track) => track.stop());
        }
      };
      resolve(stream);
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate || socket.readyState !== WebSocket.OPEN) return;
      try {
        sendJson(socket, {
          type: "rtc.ice",
          protocol: PROTOCOL_VERSION,
          sessionId,
          candidate: event.candidate.toJSON(),
        });
      } catch {
        fail(new Error("The Windows desktop agent disconnected during connection setup."));
      }
    };
    peer.ontrack = (event) => {
      if (settled) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (!stream.getVideoTracks().length) return;
      pendingStream = stream;
      resolveApprovedStream(stream);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed")
        fail(new Error("Could not establish the local connection to the Windows desktop agent."));
    };
    socket.onmessage = (event) => {
      const message = parseAgentMessage(event.data);
      if (!message || message.sessionId !== sessionId) return;
      if (message.type === "capture.approved") {
        approvalReceived = true;
        if (pendingStream) resolveApprovedStream(pendingStream);
        return;
      }
      if (message.type === "capture.denied") {
        fail(new Error("The Windows user declined desktop sharing in the tray app."));
        return;
      }
      if (message.type === "capture.error") {
        fail(
          new Error(
            typeof message.message === "string"
              ? message.message
              : "The agent could not capture the desktop.",
          ),
        );
        return;
      }
      if (message.type === "rtc.offer") {
        void (async () => {
          try {
            await peer.setRemoteDescription(message.description as RTCSessionDescriptionInit);
            remoteDescriptionSet = true;
            for (const candidate of queuedCandidates.splice(0))
              await peer.addIceCandidate(candidate);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            if (!peer.localDescription)
              throw new Error("Could not create a desktop stream answer.");
            sendJson(socket, {
              type: "rtc.answer",
              protocol: PROTOCOL_VERSION,
              sessionId,
              description: peer.localDescription.toJSON(),
            });
          } catch (cause) {
            fail(
              cause instanceof Error ? cause : new Error("Could not negotiate desktop streaming."),
            );
          }
        })();
        return;
      }
      if (message.type === "rtc.ice") {
        const candidate = message.candidate as RTCIceCandidateInit;
        if (!candidate) return;
        if (remoteDescriptionSet) void peer.addIceCandidate(candidate).catch(() => undefined);
        else queuedCandidates.push(candidate);
      }
    };
    socket.onerror = () => fail(new Error("The Windows desktop agent disconnected."));
    socket.onclose = () => fail(new Error("The Windows desktop agent disconnected."));

    try {
      sendJson(socket, {
        type: "capture.request",
        protocol: PROTOCOL_VERSION,
        sessionId,
        requesterName,
        appOrigin: window.location.origin,
      });
    } catch {
      fail(new Error("Could not request desktop sharing from the Windows tray app."));
    }
  });
}

export function sendWindowsDesktopAgentInput(input: AgentRemoteInput) {
  const capture = activeCapture;
  if (!capture || capture.socket.readyState !== WebSocket.OPEN) return;
  try {
    sendJson(capture.socket, {
      type: "control.input",
      protocol: PROTOCOL_VERSION,
      sessionId: capture.sessionId,
      input,
    });
  } catch {
    // A lost local agent connection is handled by the screen-sharing session state.
  }
}

export function stopWindowsDesktopAgentCapture(expectedSessionId?: string) {
  const capture = activeCapture;
  if (!capture || (expectedSessionId && capture.sessionId !== expectedSessionId)) return;
  activeCapture = null;
  try {
    if (capture.socket.readyState === WebSocket.OPEN)
      sendJson(capture.socket, {
        type: "capture.stop",
        protocol: PROTOCOL_VERSION,
        sessionId: capture.sessionId,
      });
  } catch {
    // Best-effort stop; closing the socket also terminates the agent session.
  }
  capture.stream?.getTracks().forEach((track) => track.stop());
  capture.peer.close();
  capture.socket.close(1000, "screen-control ended");
}
