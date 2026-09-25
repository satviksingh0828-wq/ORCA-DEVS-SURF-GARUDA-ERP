import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

const transferInputSchema = z.object({
  sessionToken: z.string().min(1),
  branchId: z.string().uuid(),
  partnerGstin: z
    .string()
    .trim()
    .regex(/^\d{2}[0-9A-Z]{13}$/i),
  ewayBillNumbers: z
    .array(z.string().regex(/^\d{12}$/))
    .min(1)
    .max(100),
});

const recordInputSchema = z.object({
  sessionToken: z.string().min(1),
  branchId: z.string().uuid(),
  transporterId: z.string().uuid().nullable(),
  transporterName: z.string().trim().min(1).max(200),
  transporterGstin: z
    .string()
    .trim()
    .regex(/^\d{2}[0-9A-Z]{13}$/i),
  items: z
    .array(
      z.object({
        consignment_id: z.string().uuid(),
        consignment_number: z.string().min(1).max(80),
        shipment_id: z.string().uuid(),
        eway_bill_number: z.string().max(12),
        transfer_status: z.enum(["transferred", "failed"]),
        transfer_error: z.string().max(1000),
      }),
    )
    .min(1)
    .max(1000),
});

function findStatusObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if ("status_cd" in record || "status" in record || "error" in record) return record;
  for (const key of ["data", "result", "response"]) {
    const found = findStatusObject(record[key]);
    if (Object.keys(found).length) return found;
  }
  return {};
}

function responseError(
  body: unknown,
  status: Record<string, unknown>,
  statusText: string,
  ewayBillNumber: string,
): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : {};
  const statusError =
    status.error && typeof status.error === "object"
      ? (status.error as Record<string, unknown>)
      : {};
  return String(
    error.message ??
      statusError.errorCodes ??
      status.status_desc ??
      status.message ??
      (statusText || undefined) ??
      `PeriOne rejected E-Way Bill ${ewayBillNumber}`,
  );
}

export const serverTransferManifestLrs = createServerFn({ method: "POST" })
  .validator(transferInputSchema)
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
    if (!baseUrl || !apiKey)
      throw new Error(
        "EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured on the ORCA server",
      );
    const results: Array<{ ewayBillNumber: string; ok: boolean; error?: string }> = [];
    for (const ewayBillNumber of data.ewayBillNumbers) {
      try {
        const response = await fetch(
          `${baseUrl}/v1/branches/${encodeURIComponent(data.branchId)}/ewaybills/update-transporter`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
            },
            body: JSON.stringify({
              ewbNo: Number(ewayBillNumber),
              transporterId: data.partnerGstin.toUpperCase(),
            }),
          },
        );
        const rawBody = await response.text();
        let body: unknown = null;
        try {
          body = rawBody ? (JSON.parse(rawBody) as unknown) : null;
        } catch {
          body = null;
        }
        const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const status = findStatusObject(body);
        const statusCode = String(status.status_cd ?? "");
        const statusValue = String(status.status ?? "");
        const explicitRejection =
          record.ok === false || Boolean(record.error) || statusCode === "0" || statusValue === "0";
        const ok = response.ok && body !== null && !explicitRejection;
        results.push({
          ewayBillNumber,
          ok,
          ...(ok
            ? {}
            : { error: responseError(body, status, response.statusText, ewayBillNumber) }),
        });
      } catch (error) {
        results.push({
          ewayBillNumber,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : `Could not contact E-Way Bill service for ${ewayBillNumber}`,
        });
      }
    }
    return { results };
  });

export const serverRecordLtmsManifestTransfer = createServerFn({ method: "POST" })
  .validator(recordInputSchema)
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
    // The generated Supabase types predate this migration's RPC signature.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: result, error } = await (supabaseAdmin as any).rpc(
      "record_ltms_manifest_transfer",
      {
        p_branch_id: data.branchId,
        p_transporter_id: data.transporterId,
        p_transporter_name: data.transporterName,
        p_transporter_gstin: data.transporterGstin.toUpperCase(),
        p_created_by: session.uid,
        p_items: data.items,
      },
    );
    if (error)
      throw new Error(
        `E-Way Bill transfer returned but Supabase could not save its manifest: ${error.message}`,
      );
    if (!result?.manifest_number)
      throw new Error("Supabase did not return the new Manifest number");
    return {
      manifestNumber: String(result.manifest_number),
      transferStatus: String(result.transfer_status),
    };
  });
