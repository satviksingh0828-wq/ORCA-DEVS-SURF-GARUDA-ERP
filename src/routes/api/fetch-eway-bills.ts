import { createFileRoute } from "@tanstack/react-router";

function indiaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (name: string) => parts.find((part) => part.type === name)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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

export const Route = createFileRoute("/api/fetch-eway-bills")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return new Response("Unauthorized", { status: 401 });
        const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
        const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
        if (!baseUrl || !apiKey) return Response.json({ ok: false, error: "EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured" }, { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const snapshotDate = shiftDate(indiaDateKey(), -1);
        const { data: branches, error: branchError } = await db.from("branches").select("id,gstin,state_code").eq("eway_auto_fetch_enabled", true);
        if (branchError) return Response.json({ ok: false, error: branchError.message }, { status: 500 });

        const summary: Array<Record<string, unknown>> = [];
        for (const branch of (branches ?? []) as Array<{ id: string; gstin?: string; state_code?: string }>) {
          if (!branch.gstin) { summary.push({ branch_id: branch.id, skipped: true, reason: "GSTIN missing" }); continue; }
          const { data: existing } = await db.from("eway_bill_fetch_runs").select("status,ewb_count").eq("branch_id", branch.id).eq("snapshot_date", snapshotDate).maybeSingle();
          if (existing?.status === "completed") { summary.push({ branch_id: branch.id, skipped: true, reason: "Already fetched", ewb_count: existing.ewb_count }); continue; }

          await db.from("eway_bill_fetch_runs").upsert({ branch_id: branch.id, snapshot_date: snapshotDate, status: "running", error_message: null }, { onConflict: "branch_id,snapshot_date" });
          try {
            const url = new URL(`${baseUrl}/v1/branches/${encodeURIComponent(branch.id)}/ewaybills/transporter/by-gstin`);
            url.searchParams.set("date", apiDate(snapshotDate));
            url.searchParams.set("gstin", branch.gstin);
            if (branch.state_code) url.searchParams.set("stateCode", branch.state_code);
            const response = await fetch(url, { headers: { Accept: "application/json", "X-API-Key": apiKey } });
            const body = await response.json().catch(() => null) as Record<string, unknown> | null;
            const upstream = body?.data && typeof body.data === "object" ? body.data as Record<string, unknown> : body;
            if (!response.ok || body?.ok === false || upstream?.status_cd === "0" || upstream?.status === "0") throw new Error(String((body?.error as Record<string, unknown> | undefined)?.message ?? upstream?.status_desc ?? "PeriOne rejected the assigned-EWB request"));
            const rows = extractRows(body);
            const snapshots = rows.map((row) => ({
              branch_id: branch.id,
              snapshot_date: snapshotDate,
              ewb_number: String(row.ewbNo ?? row.ewayBillNo ?? ""),
              invoice_number: String(row.docNo ?? ""),
              generated_by: String(row.genGstin ?? row.generatedBy ?? ""),
              destination: String(row.delPlace ?? row.toPlace ?? row.destination ?? ""),
              valid_until: String(row.validUpto ?? row.validUntil ?? ""),
              status: String(row.status ?? ""),
              raw_data: row,
              fetched_at: new Date().toISOString(),
            })).filter((row) => /^\d{12}$/.test(row.ewb_number));
            if (snapshots.length) {
              const { error: insertError } = await db.from("eway_bill_daily_snapshots").upsert(snapshots, { onConflict: "branch_id,snapshot_date,ewb_number" });
              if (insertError) throw new Error(insertError.message);
            }
            await db.from("eway_bill_fetch_runs").update({ status: "completed", fetched_at: new Date().toISOString(), ewb_count: snapshots.length, error_message: null }).eq("branch_id", branch.id).eq("snapshot_date", snapshotDate);
            summary.push({ branch_id: branch.id, fetched: snapshots.length, snapshot_date: snapshotDate });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown fetch error";
            await db.from("eway_bill_fetch_runs").update({ status: "failed", fetched_at: new Date().toISOString(), error_message: message }).eq("branch_id", branch.id).eq("snapshot_date", snapshotDate);
            summary.push({ branch_id: branch.id, failed: true, error: message });
          }
        }
        return Response.json({ ok: true, snapshot_date: snapshotDate, branches: summary });
      },
    },
  },
});
