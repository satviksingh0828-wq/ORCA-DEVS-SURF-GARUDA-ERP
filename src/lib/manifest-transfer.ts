import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

const inputSchema = z.object({
  sessionToken: z.string().min(1),
  branchId: z.string().uuid(),
  partnerGstin: z.string().trim().regex(/^\d{2}[0-9A-Z]{13}$/i),
  ewayBillNumbers: z.array(z.string().regex(/^\d{12}$/)).min(1).max(100),
});

function findStatusObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (typeof record.status_cd === "string" || typeof record.status === "string" || record.error) return record;
  return findStatusObject(record.data);
}

export const serverTransferManifestLrs = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (session.role === "basic") {
      const { data: assignment, error } = await supabaseAdmin
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", session.uid)
        .eq("branch_id", data.branchId)
        .maybeSingle();
      if (error || !assignment) throw new Error("You do not have access to this branch");
    }
    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey) throw new Error("EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured on the ORCA server");
    const results: Array<{ ewayBillNumber: string; ok: boolean; error?: string }> = [];
    for (const ewayBillNumber of data.ewayBillNumbers) {
      const response = await fetch(`${baseUrl}/v1/branches/${encodeURIComponent(data.branchId)}/ewaybills/update-transporter`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ ewbNo: Number(ewayBillNumber), transporterId: data.partnerGstin.toUpperCase() }),
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      const status = findStatusObject(body?.data ?? body);
      const errorObject = body?.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
      const errorValue = status.error && typeof status.error === "object" ? status.error as Record<string, unknown> : {};
      const ok = response.ok && body?.ok !== false && status.status_cd !== "0" && status.status !== "0";
      results.push({
        ewayBillNumber,
        ok,
        ...(ok ? {} : { error: String(errorObject.message ?? errorValue.errorCodes ?? status.status_desc ?? status.message ?? `PeriOne rejected E-Way Bill ${ewayBillNumber}`) }),
      });
    }
    return { results };
  });
