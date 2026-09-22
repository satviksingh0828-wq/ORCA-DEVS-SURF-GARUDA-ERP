import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

const inputSchema = z.object({
  token: z.string().min(1),
  branchId: z.string().uuid(),
  ewayBillNumbers: z.array(z.string().regex(/^\d{12}$/)).min(1).max(100),
  fromPlace: z.string().trim().min(1).max(100),
  fromState: z.coerce.number().int().min(1).max(99),
  vehicleNo: z.string().trim().min(1).max(20),
  vehicleType: z.enum(["R", "O"]),
  transMode: z.enum(["1", "2", "3", "4"]),
  transDocNo: z.string().trim().min(1).max(50),
  transDocDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  reasonCode: z.string().regex(/^\d$/),
  reasonRem: z.string().trim().min(1).max(50),
});

export const serverUpdateEwayBillPartB = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    const session = await verifyAppToken(data.token);
    if (!session) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (session.role === "basic") {
      const { data: assignment, error } = await supabaseAdmin
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", session.uid)
        .eq("branch_id", data.branchId)
        .maybeSingle();
      if (assignmentErrorOrMissing(assignment, error)) throw new Error("You do not have access to this branch");
    }

    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey) throw new Error("EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured on the ORCA server");

    const results: Array<{ ewayBillNumber: string; ok: boolean; data?: unknown; error?: string }> = [];
    for (const ewayBillNumber of data.ewayBillNumbers) {
      const response = await fetch(`${baseUrl}/v1/branches/${encodeURIComponent(data.branchId)}/ewaybills/update-part-b`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          ewbNo: Number(ewayBillNumber),
          fromPlace: data.fromPlace,
          fromState: data.fromState,
          vehicleNo: data.vehicleNo,
          vehicleType: data.vehicleType,
          transMode: data.transMode,
          transDocNo: data.transDocNo,
          transDocDate: data.transDocDate,
          reasonCode: data.reasonCode,
          reasonRem: data.reasonRem,
        }),
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      const upstream = findStatusObject(body?.data ?? body);
      if (response.ok && body?.ok !== false && upstream?.status_cd !== "0" && upstream?.status === "0") {
        results.push({ ewayBillNumber, ok: false, error: String(upstream.error?.errorCodes ?? "PeriOne rejected the Part-B update") });
      } else if (response.ok && body?.ok !== false && upstream?.status_cd !== "0") {
        results.push({ ewayBillNumber, ok: true, data: body?.data ?? body });
      } else {
        const error = body?.error as Record<string, unknown> | undefined;
        results.push({ ewayBillNumber, ok: false, error: String(error?.message ?? "PeriOne rejected the Part-B update") });
      }
    }
    const failed = results.filter((result) => !result.ok);
    if (failed.length) throw new Error(`Part-B update failed for ${failed.length} of ${results.length} E-Way Bill(s): ${failed.map((result) => `${result.ewayBillNumber} (${result.error})`).join(", ")}`);
    return { updated: results.length, results };
  });

function assignmentErrorOrMissing(assignment: unknown, error: unknown): boolean {
  return Boolean(error) || !assignment;
}

function findStatusObject(value: unknown): { status_cd?: string; status?: string; error?: { errorCodes?: unknown } } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (typeof record.status_cd === "string" || typeof record.status === "string") return record as { status_cd?: string; status?: string; error?: { errorCodes?: unknown } };
  return findStatusObject(record.data);
}
