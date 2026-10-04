import type { RemoteInputMessage } from "@/lib/screen-control-host-types";

export type HostCaptureRequest = {
  requestId: string;
  session: {
    id: string;
    requester_id: string;
    target_id: string;
    share_scope: "app" | "system";
    requester: { id: string; name: string };
    target: { id: string; name: string };
  };
  sessionToken: string;
};

export type HostStartRequest = {
  session: HostCaptureRequest["session"] & { status: "active" };
  sessionToken: string;
};

export type MainToHostMessage =
  | { type: "main:probe"; ownerId: string }
  | ({ type: "main:capture"; ownerId: string } & HostCaptureRequest)
  | ({ type: "main:start"; ownerId: string } & HostStartRequest)
  | { type: "main:stop"; ownerId: string; sessionId: string }
  | ({ type: "main:resume"; ownerId: string } & HostCaptureRequest);

export type HostToMainMessage =
  | { type: "host:ready"; ownerId: string; hostId: string }
  | {
      type: "host:state";
      ownerId: string;
      hostId: string;
      sessionId: string | null;
      captureActive: boolean;
      peerState: RTCPeerConnectionState | "waiting";
    }
  | { type: "host:capture-ready"; ownerId: string; hostId: string; requestId: string }
  | {
      type: "host:capture-error";
      ownerId: string;
      hostId: string;
      requestId: string;
      message: string;
    }
  | {
      type: "host:input";
      ownerId: string;
      hostId: string;
      sessionId: string;
      input: RemoteInputMessage;
    }
  | { type: "host:ended"; ownerId: string; hostId: string; sessionId: string; reason?: string }
  | { type: "host:closed"; ownerId: string; hostId: string }
  | { type: "host:alive"; ownerId: string; hostId: string };

export type HostToMainPayload = HostToMainMessage extends infer Message
  ? Message extends HostToMainMessage
    ? Omit<Message, "ownerId" | "hostId">
    : never
  : never;

const HOST_KEY_STORAGE_KEY = "orca.screen-control.host-key.v1";

export function getScreenControlHostKey() {
  const existing = sessionStorage.getItem(HOST_KEY_STORAGE_KEY);
  if (existing) return existing;
  const key = crypto.randomUUID();
  sessionStorage.setItem(HOST_KEY_STORAGE_KEY, key);
  return key;
}

export function screenControlHostChannelName(ownerId: string, hostKey: string) {
  return `orca-screen-control-host:${ownerId}:${hostKey}`;
}
