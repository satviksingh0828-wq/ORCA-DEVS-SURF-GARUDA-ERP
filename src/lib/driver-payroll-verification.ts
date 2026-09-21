import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type DriverPendingKind = "payroll" | "advance";
export type DriverPendingPayload = Record<string, string | boolean | null>;
export type DriverPendingEntry = {
  id: string;
  kind: DriverPendingKind;
  submitted_by: string;
  driver_id: string | null;
  branch_id: string | null;
  payload: DriverPendingPayload;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

const kindSchema = z.enum(["payroll", "advance"]);
const payloadSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.null()]));

async function verifyToken(token: string): Promise<{ id: string; role: string }> {
  const lastColon = token.lastIndexOf(":");
  if (!token || lastColon < 0) throw new Error("Invalid session token");
  const signedPayload = token.slice(0, lastColon);
  const signature = token.slice(lastColon + 1);
  const [id, role, expiresText] = signedPayload.split(":");
  if (!id || !role || Date.now() > Number(expiresText)) throw new Error("Session token expired");
  const { createHmac, timingSafeEqual } = await import("crypto");
  const expected = createHmac("sha256", process.env.SESSION_SECRET ?? "dev-fallback-secret").update(signedPayload).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid session token");
  }
  return { id, role };
}

function tableFor(kind: DriverPendingKind): string {
  return kind === "payroll" ? "driver_payroll_verification_pending" : "driver_advance_verification_pending";
}

export const serverSubmitPendingDriverFinance = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string(), kind: kindSchema, payload: payloadSchema }))
  .handler(async ({ data }) => {
    const session = await verifyToken(data.sessionToken);
    if (session.role !== "basic") throw new Error("Only Basic users submit driver payroll or advance entries");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: row, error } = await db.from(tableFor(data.kind)).insert({
      submitted_by: session.id,
      driver_id: typeof data.payload.driver_id === "string" ? data.payload.driver_id : null,
      branch_id: typeof data.payload.branch_id === "string" ? data.payload.branch_id : null,
      payload: data.payload,
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Could not submit driver finance entry");
    return { id: row.id as string };
  });

export const serverListPendingDriverFinance = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string(), kind: kindSchema }))
  .handler(async ({ data }): Promise<DriverPendingEntry[]> => {
    const session = await verifyToken(data.sessionToken);
    if (!["admin", "semi_admin", "viewer", "basic"].includes(session.role)) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    let query = db.from(tableFor(data.kind)).select("id,submitted_by,driver_id,branch_id,payload,status,created_at").eq("status", "pending").order("created_at", { ascending: false });
    if (session.role === "basic") query = query.eq("submitted_by", session.id);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Record<string, unknown>[]).map((row) => ({ ...row, kind: data.kind })) as DriverPendingEntry[];
  });

export const serverApprovePendingDriverFinance = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string(), kind: kindSchema, pendingId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const session = await verifyToken(data.sessionToken);
    if (!["admin", "semi_admin", "viewer"].includes(session.role)) {
      throw new Error("Only Admin, Semi-Admin, or Viewer users can approve driver finance entries");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const rpc = data.kind === "payroll" ? "tms_approve_pending_driver_payroll" : "tms_approve_pending_driver_advance";
    const { data: actualId, error } = await db.rpc(rpc, {
      p_pending_id: data.pendingId,
      p_reviewer_id: session.id,
    });
    if (error) throw new Error(error.message);
    return { actualId: actualId as string };
  });
