import { createFileRoute } from "@tanstack/react-router";
import { verifyAppToken } from "@/lib/user-auth";
import {
  executeBrowserInstruction,
  openBrowserRuntime,
  releaseBrowserSession,
  writeAgentEvent,
} from "@/lib/orca-agent/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HIGH_IMPACT_ACTIONS = /\b(send|submit|purchase|buy|delete|remove|transfer|pay|book|publish|post|change password|log in|login)\b/i;

type AgentRequest = {
  action?: "start" | "task" | "approve" | "stop";
  instruction?: string;
  targetUrl?: string;
  sessionId?: string;
  taskId?: string;
  approved?: boolean;
};

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function currentUser(request: Request) {
  const token = bearerToken(request);
  return token ? verifyAppToken(token) : null;
}

async function getOwnedSession(userId: string, sessionId?: string) {
  const db = supabaseAdmin as any;
  let query = db
    .from("orca_agent_sessions")
    .select("id,browserbase_session_id,live_view_url,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("last_seen_at", { ascending: false })
    .limit(1);
  if (sessionId) query = query.eq("id", sessionId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as {
    id: string;
    browserbase_session_id: string;
    live_view_url: string | null;
    status: string;
  } | null;
}

async function createOwnedSession(userId: string) {
  const runtime = await openBrowserRuntime();
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("orca_agent_sessions")
    .insert({
      user_id: userId,
      browserbase_session_id: runtime.browserbaseSessionId,
      live_view_url: runtime.liveViewUrl,
      context: { provider: "browserbase", worker: "stagehand" },
    })
    .select("id,browserbase_session_id,live_view_url,status")
    .single();
  await runtime.stagehand.close().catch(() => undefined);
  if (error) throw error;
  await writeAgentEvent({
    userId,
    sessionId: data.id,
    eventType: "session_started",
    payload: { browserbaseSessionId: runtime.browserbaseSessionId },
  });
  return data as {
    id: string;
    browserbase_session_id: string;
    live_view_url: string;
    status: string;
  };
}

async function runTask(input: {
  taskId: string;
  userId: string;
  session: { id: string; browserbase_session_id: string; live_view_url: string | null };
  instruction: string;
  targetUrl?: string;
}) {
  const db = supabaseAdmin as any;
  await db
    .from("orca_agent_tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", input.taskId)
    .eq("user_id", input.userId);
  await writeAgentEvent({
    userId: input.userId,
    taskId: input.taskId,
    sessionId: input.session.id,
    eventType: "task_started",
    payload: { instruction: input.instruction },
  });

  let runtime: Awaited<ReturnType<typeof openBrowserRuntime>> | null = null;
  try {
    runtime = await openBrowserRuntime(input.session.browserbase_session_id);
    const result = await executeBrowserInstruction(runtime, input.instruction, input.targetUrl);
    await db
      .from("orca_agent_sessions")
      .update({ live_view_url: runtime.liveViewUrl, last_seen_at: new Date().toISOString() })
      .eq("id", input.session.id);
    await db
      .from("orca_agent_tasks")
      .update({
        status: "completed",
        result,
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.taskId)
      .eq("user_id", input.userId);
    await writeAgentEvent({
      userId: input.userId,
      taskId: input.taskId,
      sessionId: input.session.id,
      eventType: "task_completed",
      payload: { url: result.url, title: result.title },
    });
    return { ok: true, result, liveViewUrl: runtime.liveViewUrl, sessionId: input.session.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser task failed.";
    await db
      .from("orca_agent_tasks")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", input.taskId)
      .eq("user_id", input.userId);
    await writeAgentEvent({
      userId: input.userId,
      taskId: input.taskId,
      sessionId: input.session.id,
      eventType: "task_failed",
      payload: { error: message },
    });
    return { ok: false, error: message, sessionId: input.session.id };
  } finally {
    await runtime?.stagehand.close().catch(() => undefined);
  }
}

export const Route = createFileRoute("/api/orca/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const identity = await currentUser(request);
        if (!identity) return jsonError("Unauthorized", 401);

        let body: AgentRequest;
        try {
          body = (await request.json()) as AgentRequest;
        } catch {
          return jsonError("A JSON request body is required.", 400);
        }

        const action = body.action ?? "task";
        const db = supabaseAdmin as any;
        try {
          if (action === "start") {
            const session = await createOwnedSession(identity.uid);
            return Response.json({ ok: true, sessionId: session.id, liveViewUrl: session.live_view_url });
          }

          if (action === "stop") {
            const session = await getOwnedSession(identity.uid, body.sessionId);
            if (!session) return jsonError("No active ORCA browser session found.", 404);
            await releaseBrowserSession(session.browserbase_session_id);
            await db
              .from("orca_agent_sessions")
              .update({ status: "released", released_at: new Date().toISOString() })
              .eq("id", session.id)
              .eq("user_id", identity.uid);
            await writeAgentEvent({ userId: identity.uid, sessionId: session.id, eventType: "session_released" });
            return Response.json({ ok: true, sessionId: session.id });
          }

          if (action === "approve") {
            if (!body.taskId) return jsonError("taskId is required for approval.", 400);
            const { data: task, error: taskError } = await db
              .from("orca_agent_tasks")
              .select("id,instruction,session_id,status")
              .eq("id", body.taskId)
              .eq("user_id", identity.uid)
              .eq("status", "pending_approval")
              .maybeSingle();
            if (taskError) throw taskError;
            if (!task) return jsonError("Approval is missing or the task has expired.", 404);
            const session = await getOwnedSession(identity.uid, task.session_id);
            if (!session) return jsonError("The browser session is no longer active.", 409);
            await db.from("orca_agent_tasks").update({ approved_at: new Date().toISOString() }).eq("id", task.id);
            return Response.json(
              await runTask({
                taskId: task.id,
                userId: identity.uid,
                session,
                instruction: task.instruction,
              }),
            );
          }

          const instruction = body.instruction?.trim();
          if (!instruction) return jsonError("instruction is required.", 400);
          let session = await getOwnedSession(identity.uid, body.sessionId);
          if (!session) session = await createOwnedSession(identity.uid);

          const requiresApproval = HIGH_IMPACT_ACTIONS.test(instruction) && body.approved !== true;
          const { data: task, error: taskError } = await db
            .from("orca_agent_tasks")
            .insert({
              user_id: identity.uid,
              session_id: session.id,
              instruction,
              status: requiresApproval ? "pending_approval" : "queued",
              requires_approval: requiresApproval,
            })
            .select("id")
            .single();
          if (taskError) throw taskError;

          if (requiresApproval) {
            await writeAgentEvent({
              userId: identity.uid,
              taskId: task.id,
              sessionId: session.id,
              eventType: "approval_requested",
              payload: { instruction },
            });
            return Response.json({
              ok: true,
              requiresApproval: true,
              taskId: task.id,
              sessionId: session.id,
              liveViewUrl: session.live_view_url,
              message: "This browser action needs your approval before ORCA can perform it.",
            });
          }

          return Response.json(
            await runTask({
              taskId: task.id,
              userId: identity.uid,
              session,
              instruction,
              targetUrl: body.targetUrl,
            }),
          );
        } catch (error) {
          console.error("[orca-agent] request failed:", error);
          return jsonError(error instanceof Error ? error.message : "ORCA browser agent failed.", 500);
        }
      },
    },
  },
});
