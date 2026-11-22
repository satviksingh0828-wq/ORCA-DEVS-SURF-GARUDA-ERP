import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";
import { perioneError, perioneFailed } from "@/lib/ewaybill-fetch";

const schema = z.object({
  token: z.string().min(1),
  shipmentId: z.string().uuid(),
  fromPlace: z.string().trim().min(1).max(50),
  fromState: z.string().regex(/^\d{1,2}$/).refine((v) => Number(v) > 0),
  fromPincode: z.string().regex(/^[1-9]\d{5}$/),
  remainingDistance: z.number().int().positive().max(4000),
  transMode: z.enum(["1", "2", "3", "4", "5"]),
  vehicleNo: z.string().trim().max(15),
  transDocNo: z.string().trim().max(15),
  transDocDate: z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/),
  reasonCode: z.enum(["1", "2", "4", "5", "99"]),
  remarks: z.string().trim().min(1).max(100),
  transitType: z.enum(["R", "W", "O"]),
  addressLine1: z.string().trim().max(100),
  addressLine2: z.string().trim().max(100),
  addressLine3: z.string().trim().max(100),
}).superRefine((d, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (d.transMode === "1" && !/^[A-Z0-9]{7,15}$/.test(d.vehicleNo.toUpperCase().replace(/\s/g, ""))) issue("Enter a valid vehicle number.");
  if (["2", "3", "4"].includes(d.transMode) && (!d.transDocNo || !d.transDocDate)) issue("Transport document number and date are required.");
  if (d.transMode === "5" && !d.addressLine1) issue("Current transit address is required.");
});

function responseValidity(value: unknown, bill: string, depth = 0): string | null {
  if (depth > 6 || !value) return null;
  if (typeof value === "string") {
    try { return responseValidity(JSON.parse(value), bill, depth + 1); } catch { return null; }
  }
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const number = row.ewayBillNo ?? row.ewbNo;
  if (number != null && String(number) !== bill) return null;
  const raw = row.validUpto ?? row.validUntil;
  if (typeof raw === "string" && raw.trim()) return raw;
  for (const key of ["data", "response_data", "response", "result"]) {
    const found = responseValidity(row[key], bill, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeValidity(raw: string): string {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  let iso = raw;
  if (match) {
    let hour = Number(match[4]);
    if (match[7] && hour <= 12) hour = (hour % 12) + (match[7].toUpperCase() === "PM" ? 12 : 0);
    iso = `${match[3]}-${match[2]}-${match[1]}T${String(hour).padStart(2, "0")}:${match[5]}:${match[6] || "00"}+05:30`;
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) {
    iso = raw.replace(" ", "T") + "+05:30";
  } else if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    throw new Error("PeriOne returned an unreadable expiry. Check E-Way Bill details before retrying.");
  }
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) throw new Error("PeriOne returned an invalid expiry. Check E-Way Bill details before retrying.");
  return parsed.toISOString();
}

export const serverExtendShipmentValidity = createServerFn({ method: "POST" })
  .validator(schema)
  .handler(async ({ data }) => {
    const session = await verifyAppToken(data.token);
    if (!session) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: shipment, error } = await db.from("shipments")
      .select("id,branch_id,eway_bill_number,eway_bill_status,valid_until,approximate_distance_km")
      .eq("id", data.shipmentId).maybeSingle();
    if (error || !shipment) throw new Error("Shipment not found");
    if (session.role === "basic") {
      const { data: access, error: accessError } = await db.from("user_branch_access")
        .select("branch_id").eq("user_id", session.uid).eq("branch_id", shipment.branch_id).maybeSingle();
      if (accessError || !access) throw new Error("You do not have access to this branch");
    }
    const bill = String(shipment.eway_bill_number ?? "");
    if (!/^\d{12}$/.test(bill)) throw new Error("Shipment has no valid E-Way Bill number");
    if (/^(cancelled|canceled|cnl|discarded|dis|closed)$/i.test(String(shipment.eway_bill_status))) throw new Error("This E-Way Bill cannot be extended");
    const total = Number(shipment.approximate_distance_km);
    if (total > 0 && data.remainingDistance > total) throw new Error("Remaining distance cannot exceed the original distance.");
    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey) throw new Error("E-Way Bill backend is not configured");
    const transit = data.transMode === "5";
    const response = await fetch(`${baseUrl}/v1/branches/${encodeURIComponent(shipment.branch_id)}/ewaybills/extend-validity`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        ewbNo: Number(bill), fromPlace: data.fromPlace, fromState: Number(data.fromState),
        fromPincode: Number(data.fromPincode), remainingDistance: data.remainingDistance,
        transMode: data.transMode, vehicleNo: transit ? "" : data.vehicleNo.toUpperCase().replace(/\s/g, ""),
        transDocNo: transit ? "" : data.transDocNo,
        transDocDate: !transit && data.transDocDate ? data.transDocDate.split("-").reverse().join("/") : "",
        extnRsnCode: Number(data.reasonCode), extnRemarks: data.remarks,
        consignmentStatus: transit ? "T" : "M", transitType: transit ? data.transitType : "",
        addressLine1: transit ? data.addressLine1 : "", addressLine2: transit ? data.addressLine2 : "", addressLine3: transit ? data.addressLine3 : "",
      }),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || perioneFailed(body)) throw perioneError(body, response.status);
    const raw = responseValidity(body, bill);
    if (!raw) throw new Error("PeriOne did not return the new validity. Check E-Way Bill details before retrying.");
    const validUntil = normalizeValidity(raw);
    const { error: saveError } = await db.from("shipments").update({ valid_until: validUntil, eway_bill_status: "Active" }).eq("id", shipment.id);
    return { validUntil, status: "Active", saved: !saveError, warning: saveError ? "Validity extended at PeriOne, but ERP could not save the new expiry. Do not submit again; reconcile the shipment first." : null };
  });
