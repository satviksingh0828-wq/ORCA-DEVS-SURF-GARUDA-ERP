import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

const inputSchema = z.object({
  token: z.string().min(1),
  action: z.enum(["get", "save"]),
  branchId: z.string().uuid(),
  apiUsername: z.string().trim().max(120).optional(),
  apiPassword: z.string().max(500).optional(),
});

function getKey(): Buffer {
  const raw = process.env.EWB_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("EWB_CREDENTIAL_ENCRYPTION_KEY is not configured on the ORCA server");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("EWB_CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

function encryptPassword(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptPassword(value: string): string {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Invalid encrypted password format");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

async function authorize(token: string, branchId: string) {
  const session = await verifyAppToken(token);
  if (!session) throw new Error("Unauthorized");
  if (session.role !== "admin" && session.role !== "semi_admin") throw new Error("Only administrators can manage E-Way Bill credentials");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { session, supabaseAdmin };
}

export const serverGetBranchEwbCredentials = createServerFn({ method: "POST" })
  .validator(inputSchema.pick({ token: true, branchId: true }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await authorize(data.token, data.branchId);
    const { data: row, error } = await supabaseAdmin
      .from("branch_eway_credentials")
      .select("api_username, encrypted_api_password, credential_status")
      .eq("branch_id", data.branchId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      api_username: row?.api_username ?? "",
      configured: Boolean(row?.encrypted_api_password) && row?.credential_status === "configured",
    };
  });

export const serverSaveBranchEwbCredentials = createServerFn({ method: "POST" })
  .validator(inputSchema.extend({ action: z.literal("save"), apiUsername: z.string().trim().min(1).max(120), apiPassword: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await authorize(data.token, data.branchId);
    const { data: branch, error: branchError } = await supabaseAdmin.from("branches").select("id").eq("id", data.branchId).maybeSingle();
    if (branchError) throw new Error(branchError.message);
    if (!branch) throw new Error("Branch not found");
    const { error } = await supabaseAdmin.from("branch_eway_credentials").upsert({
      branch_id: data.branchId,
      api_username: data.apiUsername,
      encrypted_api_password: encryptPassword(data.apiPassword),
      credential_status: "configured",
      last_auth_error_code: null,
      last_auth_error_at: null,
    }, { onConflict: "branch_id" });
    if (error) throw new Error(error.message);
    return { configured: true };
  });

// Keep the decrypt helper server-only and available for a future server-side health check.
export { decryptPassword };
