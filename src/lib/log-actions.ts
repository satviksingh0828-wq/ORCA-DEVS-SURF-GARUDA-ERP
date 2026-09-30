/**
 * log-actions.ts
 *
 * Centralized audit logging for Garuda Logistics Solutions.
 *
 * Server functions (serverAddLog, serverListLogs, serverDeleteLogs) run
 * with the service-role key — logs are never exposed to anon clients.
 *
 * Client helper (logAction) reads the session from sessionStorage and
 * fires a non-blocking server log call.
 */

import { createServerFn } from "@tanstack/react-start";
import { secureSession } from "./storage";

export type LogEntry = {
  id: string;
  user_id: string | null;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  // Using a string-keyed record with serializable primitive values
  details: Record<string, string | number | boolean | null>;
  created_at: string;
};

export type AddLogInput = {
  user_id?: string | null;
  username: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  entity_label?: string;
  details?: Record<string, string | number | boolean | null>;
};

// ── Server: insert a log entry ────────────────────────────────────────────────

export const serverAddLog = createServerFn({ method: "POST" })
  .validator((input: AddLogInput) => input)
  .handler(async ({ data }): Promise<void> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin as any).from("app_logs").insert({
        user_id: data.user_id ?? null,
        username: data.username ?? "system",
        action: data.action,
        entity_type: data.entity_type,
        entity_id: data.entity_id ?? "",
        entity_label: data.entity_label ?? "",
        details: data.details ?? {},
      });
    } catch {
      // Logging must never throw — silently swallow errors
    }
  });

// ── Server: list logs (admin-only) ────────────────────────────────────────────

export type ListLogsInput = {
  entity_type?: string; // filter by tab/entity (optional)
  limit?: number;
};

export const serverListLogs = createServerFn({ method: "POST" })
  .validator((input: ListLogsInput) => input)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    let q = db
      .from("app_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 500);
    if (data.entity_type) {
      q = q.eq("entity_type", data.entity_type);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Server: delete logs (admin-only) ──────────────────────────────────────────

export type DeleteLogsInput = {
  entity_type?: string; // if set, delete only this entity type; otherwise delete all
};

export const serverDeleteLogs = createServerFn({ method: "POST" })
  .validator((input: DeleteLogsInput) => input)
  .handler(async ({ data }): Promise<void> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    let q = db.from("app_logs").delete();
    if (data.entity_type) {
      q = q.eq("entity_type", data.entity_type);
    } else {
      // Delete all — use a truthy filter to satisfy PostgREST
      q = q.gte("created_at", "1970-01-01");
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
  });

// ── Server: list logs for a specific entity (admin-only) ─────────────────────

export type ListLogsByEntityInput = {
  entity_type: string;
  entity_id: string;
  limit?: number;
};

export const serverListLogsByEntity = createServerFn({ method: "POST" })
  .validator((input: ListLogsByEntityInput) => input)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .handler(async ({ data }): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("app_logs")
      .select("*")
      .eq("entity_type", data.entity_type)
      .eq("entity_id", data.entity_id)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Client-side fire-and-forget logger ────────────────────────────────────────

let _cachedUser: { id: string; username: string } | null = null;

function getSessionUser(): { id: string; username: string } | null {
  if (_cachedUser) return _cachedUser;
  if (typeof window === "undefined") return null;
  try {
    const raw = secureSession.getItem("tms.session.v2");
    if (!raw) return null;
    const u = JSON.parse(raw) as { id: string; username: string };
    _cachedUser = u;
    return u;
  } catch {
    return null;
  }
}

/** Update cached user (called by session provider on sign-in / sign-out). */
export function setLoggerUser(user: { id: string; username: string } | null): void {
  _cachedUser = user;
}

/**
 * Fire-and-forget audit log from any client component.
 * Never awaited — logging must not block UX.
 */
export function logAction(
  action: string,
  entityType: string,
  opts?: {
    entityId?: string;
    entityLabel?: string;
    details?: Record<string, string | number | boolean | null>;
  },
): void {
  const user = getSessionUser();
  serverAddLog({
    data: {
      user_id: user?.id ?? null,
      username: user?.username ?? "unknown",
      action,
      entity_type: entityType,
      entity_id: opts?.entityId ?? "",
      entity_label: opts?.entityLabel ?? "",
      details: opts?.details ?? {},
    },
  }).catch(() => {
    // Swallow silently
  });
}
