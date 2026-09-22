import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

function apiDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function extractRows(body: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const upstream = body?.data;
  const payload = upstream && typeof upstream === "object" && !Array.isArray(upstream)
    ? ((upstream as Record<string, unknown>).data ?? upstream)
    : upstream;
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.ewayBills)) return record.ewayBills as Array<Record<string, unknown>>;
    if (Array.isArray(record.ewbList)) return record.ewbList as Array<Record<string, unknown>>;
  }
  return [];
}

export function perioneError(body: Record<string, unknown> | null, responseStatus: number): Error {
  const upstream = body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : body ?? {};
  const nested = body?.error;
  const errorObject = nested && typeof nested === "object" ? nested as Record<string, unknown> : {};
  const detail = [
    errorObject.message,
    errorObject.error,
    errorObject.errorMessage,
    errorObject.errorCodes,
    upstream.status_desc,
    upstream.statusDesc,
    upstream.message,
    body?.message,
  ].find((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const raw = body ? JSON.stringify(body).slice(0, 700) : "No response body";
  return new Error(`PeriOne request failed (HTTP ${responseStatus}): ${detail ? String(detail) : raw}`);
}

export const serverFetchEwayBills = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string().min(1), snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branchId: z.string().uuid().nullable() }))
  .handler(async ({ data }) => {
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");
    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey) throw new Error("EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    let branchQuery = db.from("branches").select("id,gstin,state_code").eq("eway_auto_fetch_enabled", true);
    if (data.branchId) branchQuery = branchQuery.eq("id", data.branchId);
    const { data: branches, error: branchError } = await branchQuery;
    if (branchError) throw new Error(branchError.message);
    if (!branches?.length) throw new Error("No enabled E-Way Bill branch is available for this selection");
    const summary: Array<Record<string, unknown>> = [];
    for (const branch of branches as Array<{ id: string; gstin?: string; state_code?: string }>) {
      if (!branch.gstin) { summary.push({ branch_id: branch.id, skipped: true, reason: "GSTIN missing" }); continue; }
      const { data: existing } = await db.from("eway_bill_fetch_runs").select("status,ewb_count").eq("branch_id", branch.id).eq("snapshot_date", data.snapshotDate).maybeSingle();
      if (existing?.status === "completed") { summary.push({ branch_id: branch.id, skipped: true, reason: "Already fetched", ewb_count: existing.ewb_count }); continue; }
      await db.from("eway_bill_fetch_runs").upsert({ branch_id: branch.id, snapshot_date: data.snapshotDate, status: "running", error_message: null }, { onConflict: "branch_id,snapshot_date" });
      try {
        const url = new URL(`${baseUrl}/v1/branches/${encodeURIComponent(branch.id)}/ewaybills/transporter/by-gstin`);
        url.searchParams.set("date", apiDate(data.snapshotDate));
        url.searchParams.set("gstin", branch.gstin);
        if (branch.state_code) url.searchParams.set("stateCode", branch.state_code);
        const response = await fetch(url, { headers: { Accept: "application/json", "X-API-Key": apiKey } });
        const body = await response.json().catch(() => null) as Record<string, unknown> | null;
        const upstream = body?.data && typeof body.data === "object" ? body.data as Record<string, unknown> : body;
        if (!response.ok || body?.ok === false || upstream?.status_cd === "0" || upstream?.status === "0") throw perioneError(body, response.status);
        const snapshots = extractRows(body).map((row) => ({ branch_id: branch.id, snapshot_date: data.snapshotDate, ewb_number: String(row.ewbNo ?? row.ewayBillNo ?? ""), invoice_number: String(row.docNo ?? ""), generated_by: String(row.genGstin ?? row.generatedBy ?? ""), destination: String(row.delPlace ?? row.toPlace ?? row.destination ?? ""), valid_until: String(row.validUpto ?? row.validUntil ?? ""), status: String(row.status ?? ""), raw_data: row, fetched_at: new Date().toISOString() })).filter((row) => /^\d{12}$/.test(row.ewb_number));
        if (snapshots.length) {
          const { error: insertError } = await db.from("eway_bill_daily_snapshots").upsert(snapshots, { onConflict: "branch_id,snapshot_date,ewb_number" });
          if (insertError) throw new Error(insertError.message);
        }
        await db.from("eway_bill_fetch_runs").update({ status: "completed", fetched_at: new Date().toISOString(), ewb_count: snapshots.length, error_message: null }).eq("branch_id", branch.id).eq("snapshot_date", data.snapshotDate);
        summary.push({ branch_id: branch.id, fetched: snapshots.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown fetch error";
        await db.from("eway_bill_fetch_runs").update({ status: "failed", fetched_at: new Date().toISOString(), error_message: message }).eq("branch_id", branch.id).eq("snapshot_date", data.snapshotDate);
        summary.push({ branch_id: branch.id, failed: true, error: message });
      }
    }
    return { snapshotDate: data.snapshotDate, branches: summary };
  });
