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
const AGENT_WS_URL = import.meta.env.VITE_WINDOWS_AGENT_WS_URL || "ws://127.0.0.1:17654/v1";
const INSTALLER_URL = import.meta.env.VITE_WINDOWS_DESKTOP_AGENT_INSTALLER_URL || "";

type ActiveCapture = {
  sessionId: string;
  socket: WebSocket;
};

let activeCapture: ActiveCapture | null = null;

function disposeCapture(capture: ActiveCapture, reason: string) {
  if (activeCapture === capture) activeCapture = null;
  const { socket } = capture;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  if (socket.readyState === WebSocket.OPEN) {
    try {
      sendJson(socket, {
        type: "capture.stop",
        protocol: PROTOCOL_VERSION,
        sessionId: capture.sessionId,
      });
    } catch {
      // Closing the socket below still releases the agent-side session.
    }
  }

  try {
    if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING)
      socket.close(1000, reason.slice(0, 100));
  } catch {
    // The browser may have already closed the local agent connection.
  }
}

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
    if (!hello.capabilities.includes("input") || !hello.capabilities.includes("input-only"))
      return {
        state: "missing",
        reason: "Update the Windows desktop agent to version 1.1.0 or later.",
      };
    return { state: "available", version: hello.version };
  } catch (cause) {
    return {
      state: "missing",
      reason: cause instanceof Error ? cause.message : "The Windows desktop agent is unavailable.",
    };
  }
}

export async function startWindowsDesktopAgentInputSession(
  sessionId: string,
  requesterName: string,
): Promise<void> {
  stopWindowsDesktopAgentCapture();
  const { socket, hello } = await openAgentSocket();
  if (!hello.capabilities.includes("input") || !hello.capabilities.includes("input-only")) {
    socket.close();
    throw new Error("Update the Windows desktop agent before starting system sharing.");
  }

  const capture: ActiveCapture = { sessionId, socket };
  activeCapture = capture;
  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      fail(new Error("The Windows user did not approve remote control in time."));
    }, CAPTURE_APPROVAL_TIMEOUT_MS);
    const cleanupListeners = () => {
      window.clearTimeout(timeout);
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      disposeCapture(capture, "control setup failed");
      reject(error);
    };
    const approve = () => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      socket.onclose = () => disposeCapture(capture, "agent disconnected");
      socket.onerror = () => disposeCapture(capture, "agent connection error");
      resolve();
    };

    socket.onmessage = (event) => {
      const message = parseAgentMessage(event.data);
      if (!message || message.sessionId !== sessionId) return;
      if (message.type === "capture.approved") approve();
      else if (message.type === "capture.denied")
        fail(new Error("The Windows user declined remote control in the tray app."));
      else if (message.type === "capture.error")
        fail(
          new Error(
            typeof message.message === "string"
              ? message.message
              : "The Windows agent could not start remote control.",
          ),
        );
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
        mediaSource: "browser",
      });
    } catch {
      fail(new Error("Could not request remote control from the Windows tray app."));
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
  disposeCapture(capture, "screen-control ended");
}
