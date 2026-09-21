import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const kindSchema = z.enum(["income", "expenditure"]);
export type PendingFinancePayload = Record<string, string | boolean | null>;
const payloadSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.null()]));

async function verifyToken(token: string): Promise<{ id: string; role: string }> {
  if (!token) throw new Error("Session token is required");
  const lastColon = token.lastIndexOf(":");
  if (lastColon < 0) throw new Error("Malformed session token");
  const signedPayload = token.slice(0, lastColon);
  const signature = token.slice(lastColon + 1);
  const parts = signedPayload.split(":");
  if (parts.length !== 3) throw new Error("Malformed session token");
  const [id, role, expiresText] = parts;
  if (!id || !role || Date.now() > Number(expiresText)) throw new Error("Session token expired");
  const { createHmac, timingSafeEqual } = await import("crypto");
  const secret = process.env.SESSION_SECRET ?? "dev-fallback-secret";
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid session token");
  }
  return { id, role };
}

export type PendingFinanceEntry = {
  id: string;
  kind: "income" | "expenditure";
  submitted_by: string;
  branch_id: string | null;
  payload: PendingFinancePayload;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export const serverSubmitPendingFinance = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string(), kind: kindSchema, payload: payloadSchema }))
  .handler(async ({ data }) => {
    const session = await verifyToken(data.sessionToken);
    if (session.role !== "basic") throw new Error("Only Basic users submit verification entries");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const table = data.kind === "income" ? "income_verification_pending" : "expenditure_verification_pending";
    const { data: row, error } = await db
      .from(table)
      .insert({
        submitted_by: session.id,
        branch_id: typeof data.payload.branch_id === "string" ? data.payload.branch_id : null,
        payload: data.payload,
      } as never)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not submit verification entry");
    return { id: row.id as string };
  });

export const serverListPendingFinance = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string(), kind: kindSchema }))
  .handler(async ({ data }): Promise<PendingFinanceEntry[]> => {
    const session = await verifyToken(data.sessionToken);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const table = data.kind === "income" ? "income_verification_pending" : "expenditure_verification_pending";
    let query = db.from(table).select("id,submitted_by,branch_id,payload,status,created_at").eq("status", "pending").order("created_at", { ascending: false });
    if (session.role === "basic") query = query.eq("submitted_by", session.id);
    else if (!["admin", "semi_admin", "viewer"].includes(session.role)) return [];
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Record<string, unknown>[]).map((row) => ({ ...row, kind: data.kind })) as PendingFinanceEntry[];
  });

export const serverApprovePendingFinance = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string(), kind: kindSchema, pendingId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const session = await verifyToken(data.sessionToken);
    if (!["admin", "semi_admin", "viewer"].includes(session.role)) {
      throw new Error("Only Admin, Semi-Admin, or Viewer users can approve finance entries");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: actualId, error } = await db.rpc("tms_approve_pending_finance", {
      p_kind: data.kind,
      p_pending_id: data.pendingId,
      p_reviewer_id: session.id,
    });
    if (error) throw new Error(error.message);
    return { actualId: actualId as string };
  });
