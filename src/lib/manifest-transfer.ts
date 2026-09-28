import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";
import { isManualEwayBill } from "@/lib/ewaybill-generation";

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
  manifestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Manifest Date is required"),
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
  const error = record.error;
  const hasMeaningfulError =
    error != null &&
    (typeof error !== "object" || Object.keys(error as Record<string, unknown>).length > 0);
  if ("status_cd" in record || "status" in record || hasMeaningfulError) return record;
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
  const format = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      return String(value).trim();
    if (Array.isArray(value)) return value.map(format).filter(Boolean).join(", ");
    if (typeof value === "object") {
      const object = value as Record<string, unknown>;
      for (const key of [
        "message",
        "errorMessage",
        "error_message",
        "errorCodes",
        "status_desc",
        "statusDesc",
        "description",
        "reason",
        "code",
      ]) {
        const nested = format(object[key]);
        if (nested) return nested;
      }
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    }
    return "";
  };
  return (
    format(error.message) ||
    format(statusError.errorCodes) ||
    format(status.status_desc) ||
    format(status.message) ||
    statusText ||
    `PeriOne rejected E-Way Bill ${ewayBillNumber}`
  );
}

function hasMeaningfulError(value: unknown): boolean {
  return (
    value != null &&
    (typeof value !== "object" || Object.keys(value as Record<string, unknown>).length > 0)
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
    // Generated Supabase types predate the application's shipments table.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shipmentDb = supabaseAdmin as any;
    const { data: shipments, error: shipmentError } = await shipmentDb
      .from("shipments")
      .select("eway_bill_number,generation_mode")
      .eq("branch_id", data.branchId)
      .in("eway_bill_number", data.ewayBillNumbers);
    if (shipmentError)
      throw new Error(`Could not verify E-Way Bill generation mode: ${shipmentError.message}`);
    const shipmentRows = (shipments ?? []) as Array<Record<string, unknown>>;
    const verifiedBills = new Set(
      shipmentRows.map((shipment) => String(shipment.eway_bill_number)),
    );
    const unverifiedBills = data.ewayBillNumbers.filter((number) => !verifiedBills.has(number));
    if (unverifiedBills.length)
      throw new Error(
        `Cannot verify E-Way Bill generation mode for: ${unverifiedBills.join(", ")}`,
      );
    const manualBills = shipmentRows
      .filter((shipment) => isManualEwayBill(shipment))
      .map((shipment) => String(shipment.eway_bill_number));
    if (manualBills.length)
      throw new Error(
        `Manual E-Way Bills must be updated in-app and cannot be sent to the E-Way Bill API: ${manualBills.join(", ")}`,
      );
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
          record.ok === false ||
          hasMeaningfulError(record.error) ||
          statusCode === "0" ||
          statusValue === "0";
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
        p_manifest_date: data.manifestDate,
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

const shipmentTransporterInputSchema = z.object({
  sessionToken: z.string().min(1),
  branchId: z.string().uuid(),
  shipmentId: z.string().uuid(),
  transporterGstin: z
    .string()
    .trim()
    .regex(/^\d{2}[0-9A-Z]{13}$/i),
  transporterName: z.string().trim().min(1).max(200),
});

export const serverUpdateShipmentTransporter = createServerFn({ method: "POST" })
  .validator(shipmentTransporterInputSchema)
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
    const db = supabaseAdmin as any;
    const { data: shipment, error: shipmentError } = await db
      .from("shipments")
      .select("id,consignment_id,branch_id,eway_bill_number,generation_mode")
      .eq("id", data.shipmentId)
      .eq("branch_id", data.branchId)
      .single();
    if (shipmentError || !shipment)
      throw new Error("Shipment was not found in the selected branch");
    if (!/^\d{12}$/.test(String(shipment.eway_bill_number ?? "")))
      throw new Error("This shipment does not have a valid 12-digit E-Way Bill number");
    if (isManualEwayBill(shipment))
      throw new Error(
        "Manual E-Way Bills must be updated in-app and cannot be sent to the E-Way Bill API",
      );
    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey)
      throw new Error("E-Way Bill service is not configured on the ORCA server");
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
          ewbNo: Number(shipment.eway_bill_number),
          transporterId: data.transporterGstin.toUpperCase(),
        }),
      },
    );
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const status = findStatusObject(body);
    const rejected =
      !response.ok ||
      body === null ||
      body?.ok === false ||
      String(status.status_cd ?? "") === "0" ||
      String(status.status ?? "") === "0";
    if (rejected)
      throw new Error(
        responseError(body, status, response.statusText, String(shipment.eway_bill_number)),
      );
    const { error: updateError } = await db
      .from("shipments")
      .update({
        transporter_id: data.transporterGstin.toUpperCase(),
        transporter_update_status: "updated",
        transporter_update_error: "",
        transporter_updated_at: new Date().toISOString(),
      })
      .eq("id", data.shipmentId);
    if (updateError)
      throw new Error(
        `E-Way Bill updated but local status could not be saved: ${updateError.message}`,
      );
    if (shipment.consignment_id) {
      await db
        .from("consignments")
        .update({
          transporter_update_status: "updated",
          transporter_update_error: "",
          transporter_updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.consignment_id)
        .eq("branch_id", data.branchId);
    }
    return {
      ok: true,
      ewayBillNumber: String(shipment.eway_bill_number),
      transporterName: data.transporterName,
    };
  });
