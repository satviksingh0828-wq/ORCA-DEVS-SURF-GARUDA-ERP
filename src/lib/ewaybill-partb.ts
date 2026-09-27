import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

const inputSchema = z.object({
  token: z.string().min(1),
  movementId: z.string().uuid(),
  fromPinCode: z.string().regex(/^\d{6}$/),
  fromPlace: z.string().trim().min(1).max(100),
  vehicleNo: z.string().trim().min(1).max(20),
  vehicleType: z.enum(["R", "O"]),
  transMode: z.enum(["1", "2", "3", "4"]),
  transDocNo: z.string().trim().max(50).optional().default(""),
  transDocDate: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/)
    .optional()
    .default(""),
  reasonCode: z.enum(["1", "2", "3", "4"]),
  reasonRem: z.string().trim().min(1).max(100),
});

const STATE_CODES: Record<string, number> = {
  "JAMMU AND KASHMIR": 1,
  "HIMACHAL PRADESH": 2,
  PUNJAB: 3,
  CHANDIGARH: 4,
  UTTARAKHAND: 5,
  HARYANA: 6,
  DELHI: 7,
  RAJASTHAN: 8,
  "UTTAR PRADESH": 9,
  BIHAR: 10,
  SIKKIM: 11,
  "ARUNACHAL PRADESH": 12,
  NAGALAND: 13,
  MANIPUR: 14,
  MIZORAM: 15,
  TRIPURA: 16,
  MEGHALAYA: 17,
  ASSAM: 18,
  "WEST BENGAL": 19,
  JHARKHAND: 20,
  ODISHA: 21,
  CHHATTISGARH: 22,
  "MADHYA PRADESH": 23,
  GUJARAT: 24,
  "DAMAN AND DIU": 25,
  "DADRA AND NAGAR HAVELI": 26,
  MAHARASHTRA: 27,
  ANDHRA: 28,
  KARNATAKA: 29,
  GOA: 30,
  LAKSHADWEEP: 31,
  KERALA: 32,
  "TAMIL NADU": 33,
  PUDUCHERRY: 34,
  "ANDAMAN AND NICOBAR ISLANDS": 35,
  TELANGANA: 36,
  LADAKH: 38,
};
function stateCodeForPin(pin: string, state: string): number {
  const code = STATE_CODES[state.trim().toUpperCase()];
  if (!code) throw new Error(`Could not derive a GST state code for PIN ${pin}`);
  return code;
}
function findStatusObject(value: unknown): { status_cd?: string; status?: string } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (typeof record.status_cd === "string" || typeof record.status === "string")
    return record as { status_cd?: string; status?: string };
  return findStatusObject(record.data);
}
function errorText(body: Record<string, unknown> | null, fallback: string) {
  const upstream =
    body?.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : (body ?? {});
  const error =
    body?.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : {};
  return String(
    error.message ??
      error.errorCodes ??
      upstream.status_desc ??
      upstream.statusDesc ??
      body?.message ??
      fallback,
  );
}
function apiDateToDb(value: string) {
  if (!value) return null;
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

export const serverUpdateEwayBillPartB = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async ({ data }): Promise<any> => {
    const session = await verifyAppToken(data.token);
    if (!session) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: movement, error: movementError } = await db
      .from("consignments")
      .select(
        "id,consignment_number,branch_id,trip_id,part_b_updated_at,part_b_vehicle_no,shipments(id,eway_bill_number)",
      )
      .eq("id", data.movementId)
      .maybeSingle();
    if (movementError) throw new Error(movementError.message);
    if (!movement) throw new Error("Movement not found");
    if (!movement.trip_id) throw new Error("Assign this movement to a trip before updating Part-B");
    if (session.role === "basic") {
      const { data: access, error } = await db
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", session.uid)
        .eq("branch_id", movement.branch_id)
        .maybeSingle();
      if (error || !access) throw new Error("You do not have access to this branch");
    }
    const isFirst = !movement.part_b_updated_at;
    if (isFirst && data.reasonCode !== "4")
      throw new Error("The first Part-B update must use reason code 4 — First Time");
    if (!isFirst) {
      if (data.reasonCode === "4")
        throw new Error("Reason code 4 is only for the first Part-B update");
      if (data.vehicleNo.toUpperCase() === String(movement.part_b_vehicle_no ?? "").toUpperCase())
        throw new Error("Part-B can be updated again only when the vehicle number changes");
    }
    if (data.transMode !== "1" && !data.transDocNo.trim())
      throw new Error("Transport document number is required for non-road transport");
    const postalResponse = await fetch(`https://api.postalpincode.in/pincode/${data.fromPinCode}`);
    const postal = (await postalResponse.json().catch(() => null)) as Array<{
      Status?: string;
      PostOffice?: Array<{ State?: string }>;
    }> | null;
    const stateName = postal?.[0]?.PostOffice?.[0]?.State ?? "";
    const fromState = stateCodeForPin(data.fromPinCode, stateName);
    const ewayBillNumbers = (movement.shipments ?? [])
      .map((s: { eway_bill_number?: string }) => String(s.eway_bill_number ?? ""))
      .filter((n: string) => /^\d{12}$/.test(n));
    if (!ewayBillNumbers.length) throw new Error("This movement has no valid E-Way Bills");
    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey)
      throw new Error(
        "EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured on the ORCA server",
      );
    const results: Array<{ ewayBillNumber: string; ok: boolean; data?: unknown; error?: string }> =
      [];
    for (const ewayBillNumber of ewayBillNumbers) {
      const response = await fetch(
        `${baseUrl}/v1/branches/${encodeURIComponent(movement.branch_id)}/ewaybills/update-part-b`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            ewbNo: Number(ewayBillNumber),
            fromPlace: data.fromPlace,
            fromState,
            vehicleNo: data.vehicleNo.trim().toUpperCase(),
            vehicleType: data.vehicleType,
            transMode: data.transMode,
            transDocNo: data.transDocNo.trim(),
            transDocDate: data.transDocDate,
            reasonCode: data.reasonCode,
            reasonRem: data.reasonRem.trim(),
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const upstream = findStatusObject(body?.data ?? body);
      const ok =
        response.ok && body?.ok !== false && upstream.status_cd !== "0" && upstream.status !== "0";
      results.push(
        ok
          ? { ewayBillNumber, ok, data: body?.data ?? body }
          : {
              ewayBillNumber,
              ok: false,
              error: errorText(body, "E-Way Bill Part-B update failed"),
            },
      );
    }
    const successful = results.filter((r) => r.ok);
    const now = new Date().toISOString();
    if (successful.length) {
      const successfulNumbers = new Set(successful.map((r) => r.ewayBillNumber));
      const historyRows = (movement.shipments ?? [])
        .filter((s: { id: string; eway_bill_number?: string }) =>
          successfulNumbers.has(String(s.eway_bill_number ?? "")),
        )
        .map((s: { id: string; eway_bill_number?: string }) => ({
          shipment_id: s.id,
          consignment_id: movement.id,
          trip_id: movement.trip_id,
          eway_bill_number: String(s.eway_bill_number),
          from_place: data.fromPlace,
          from_pin_code: data.fromPinCode,
          from_state: fromState,
          vehicle_no: data.vehicleNo.trim().toUpperCase(),
          vehicle_type: data.vehicleType,
          trans_mode: data.transMode,
          trans_doc_no: data.transDocNo.trim() || null,
          trans_doc_date: apiDateToDb(data.transDocDate),
          reason_code: data.reasonCode,
          reason_rem: data.reasonRem.trim(),
          updated_at: now,
          updated_by: session.uid,
          response_data:
            successful.find((r) => r.ewayBillNumber === s.eway_bill_number)?.data ?? null,
        }));
      const { error: historyError } = await db.from("shipment_part_b_history").insert(historyRows);
      if (historyError) throw new Error(historyError.message);
      const { error: shipmentError } = await db
        .from("shipments")
        .update({ part_b_updated_at: now })
        .in(
          "id",
          historyRows.map((r: { shipment_id: string }) => r.shipment_id),
        );
      if (shipmentError) throw new Error(shipmentError.message);
      const { error: movementUpdateError } = await db
        .from("consignments")
        .update({
          part_b_updated_at: now,
          part_b_vehicle_no: data.vehicleNo.trim().toUpperCase(),
          part_b_from_pin_code: data.fromPinCode,
          part_b_from_state: fromState,
          part_b_from_place: data.fromPlace,
          part_b_transport_mode: data.transMode,
          part_b_vehicle_type: data.vehicleType,
          part_b_trans_doc_no: data.transDocNo.trim() || null,
          part_b_trans_doc_date: apiDateToDb(data.transDocDate),
          part_b_reason_code: data.reasonCode,
          part_b_reason_rem: data.reasonRem.trim(),
          part_b_updated_by: session.uid,
        })
        .eq("id", movement.id);
      if (movementUpdateError) throw new Error(movementUpdateError.message);
      const { error: tripLockError } = await db
        .from("trips")
        .update({ part_b_locked_at: now, part_b_locked_by: session.uid })
        .eq("id", movement.trip_id)
        .is("part_b_locked_at", null);
      if (tripLockError) throw new Error(tripLockError.message);
    }
    return {
      updated: successful.length,
      failed: results.length - successful.length,
      fromState,
      stateName,
      firstUpdate: isFirst,
      results: results.map(({ ewayBillNumber, ok, error }) => ({
        ewayBillNumber,
        ok,
        error: error ?? null,
      })),
    };
  });
