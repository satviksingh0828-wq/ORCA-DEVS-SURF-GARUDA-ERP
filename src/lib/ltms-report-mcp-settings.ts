import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type LtmsReportMcpKey = {
  id: string;
  display_name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

async function requireAdmin(sessionToken: string) {
  const { verifyAppToken } = await import("@/lib/user-auth");
  const session = await verifyAppToken(sessionToken);
  if (!session || session.role !== "admin") throw new Error("Administrator access is required.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: user, error } = await supabaseAdmin
    .from("app_users")
    .select("id,role,is_active,is_paused")
    .eq("id", session.uid)
    .maybeSingle();
  if (error) throw new Error("Could not verify the administrator account.");
  if (!user || user.role !== "admin" || !user.is_active || user.is_paused)
    throw new Error("This administrator account is inactive or no longer authorized.");
  // The MCP key table is intentionally absent from the generated database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { uid: session.uid, db: supabaseAdmin as any };
}

export const serverListLtmsReportMcpKeys = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string().min(1) }))
  .handler(async ({ data }): Promise<LtmsReportMcpKey[]> => {
    const { db } = await requireAdmin(data.sessionToken);
    const { data: keys, error } = await db
      .from("ltms_report_mcp_keys")
      .select("id,display_name,created_at,last_used_at,revoked_at")
      .order("created_at", { ascending: false });
    if (error)
      throw new Error(
        "Could not load MCP access keys. Apply the LTMS MCP database migration first.",
      );
    return keys ?? [];
  });

export const serverCreateLtmsReportMcpKey = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(1),
      displayName: z.string().trim().min(1).max(80),
    }),
  )
  .handler(async ({ data }): Promise<{ key: LtmsReportMcpKey; secret: string }> => {
    const { uid, db } = await requireAdmin(data.sessionToken);
    const { createHash, randomBytes } = await import("node:crypto");
    const secret = `orca_mcp_${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(secret).digest("hex");
    const { data: key, error } = await db
      .from("ltms_report_mcp_keys")
      .insert({ display_name: data.displayName, token_hash: tokenHash, created_by: uid })
      .select("id,display_name,created_at,last_used_at,revoked_at")
      .single();
    if (error || !key)
      throw new Error(
        "Could not create the MCP access key. Apply the LTMS MCP database migration first.",
      );
    return { key, secret };
  });

export const serverRevokeLtmsReportMcpKey = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(1),
      keyId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { db } = await requireAdmin(data.sessionToken);
    const { data: key, error } = await db
      .from("ltms_report_mcp_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.keyId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("Could not revoke the MCP access key.");
    if (!key) throw new Error("The key was already revoked or does not exist.");
    return { ok: true };
  });
