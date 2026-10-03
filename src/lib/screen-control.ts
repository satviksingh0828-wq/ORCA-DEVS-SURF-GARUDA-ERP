import { createServerFn } from "@tanstack/react-start";

export type OnlineScreenUser = {
  id: string;
  name: string;
  username: string;
  role: string;
};

export type ScreenControlSession = {
  id: string;
  requester_id: string;
  target_id: string;
  status: "pending" | "active" | "declined" | "ended" | "expired";
  share_scope: "app" | "system";
  created_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  end_reason: string | null;
  requester: { id: string; name: string };
  target: { id: string; name: string };
};

export type ScreenControlState = {
  me: { id: string; name: string; username: string };
  onlineUsers: OnlineScreenUser[];
  sessions: ScreenControlSession[];
};

export type ScreenSignal = {
  id: number;
  sender_id: string;
  signal_type: "offer" | "answer" | "ice";
  payload: Record<string, unknown>;
  created_at: string;
};

export const getScreenControlState = createServerFn({ method: "POST" })
  .validator((input: { sessionToken: string }) => input)
  .handler(async ({ data }) => {
    const server = await import("@/lib/screen-control.server");
    return server.getScreenControlState(data.sessionToken);
  });

export const createScreenControlRequest = createServerFn({ method: "POST" })
  .validator((input: { sessionToken: string; targetId: string; shareScope: "app" | "system" }) => input)
  .handler(async ({ data }) => {
    const server = await import("@/lib/screen-control.server");
    return server.createScreenControlRequest(data.sessionToken, data.targetId, data.shareScope);
  });

export const respondToScreenControlRequest = createServerFn({ method: "POST" })
  .validator((input: { sessionToken: string; sessionId: string; accept: boolean }) => input)
  .handler(async ({ data }) => {
    const server = await import("@/lib/screen-control.server");
    return server.respondToScreenControlRequest(data.sessionToken, data.sessionId, data.accept);
  });

export const endScreenControlSession = createServerFn({ method: "POST" })
  .validator((input: { sessionToken: string; sessionId: string; reason?: string }) => input)
  .handler(async ({ data }) => {
    const server = await import("@/lib/screen-control.server");
    return server.endScreenControlSession(data.sessionToken, data.sessionId, data.reason);
  });

export const sendScreenControlSignal = createServerFn({ method: "POST" })
  .validator(
    (input: {
      sessionToken: string;
      sessionId: string;
      signalType: "offer" | "answer" | "ice";
      payload: Record<string, unknown>;
    }) => input,
  )
  .handler(async ({ data }) => {
    const server = await import("@/lib/screen-control.server");
    return server.sendScreenControlSignal(
      data.sessionToken,
      data.sessionId,
      data.signalType,
      data.payload,
    );
  });

export const receiveScreenControlSignals = createServerFn({ method: "POST" })
  .validator((input: { sessionToken: string; sessionId: string; afterId: number }) => input)
  .handler(async ({ data }) => {
    const server = await import("@/lib/screen-control.server");
    return server.receiveScreenControlSignals(data.sessionToken, data.sessionId, data.afterId);
  });
