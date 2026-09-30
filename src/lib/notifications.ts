/**
 * Supabase-backed admin notifications.
 *
 * Rules:
 *  - kind + ref_id is UNIQUE → no duplicate rows ever.
 *  - Sync upserts fresh data without touching `dismissed` (dismissed rows stay dismissed).
 *  - Non-dismissed rows whose issue is resolved are auto-deleted (e.g. insurance renewed).
 *  - Once any admin dismisses a notification it stays gone for everyone.
 *
 * SECURITY:
 *  - All server functions use POST (TanStack Start CSRF protection works correctly
 *    only with POST; GET server functions bypass some middleware protections).
 *  - Every function calls requireAdmin() before touching data.
 *  - Errors from Supabase are surfaced (thrown) so the caller can react instead
 *    of silently swallowing them and showing a misleading "All clear" state.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  manifestCharges,
  findEntry,
  num,
  type EntryLite,
  type ManifestLite,
} from "@/lib/trip-calc";
import { adminAlertEmails, emailTemplate, sendResendEmail } from "@/lib/email";
import { shouldEmailNotification } from "@/lib/notification-email-policy";
import type { AppRole } from "@/lib/roles";

// ── Public types ──────────────────────────────────────────────────────────────

export type NotificationKind =
  | "insurance"
  | "road_tax"
  | "manifest_zero_income"
  | "monthly_mis"
  | "manifest_date_future"
  | "manifest_date_old"
  | "manifest_date_missing";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  ref_id: string;
  title: string;
  detail: string;
  days_left?: number | null;
  created_at: string;
};

type ComputedItem = {
  kind: NotificationKind;
  ref_id: string;
  title: string;
  detail: string;
  days_left: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(base: Date, n: number) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysUntil(s: string, today: Date) {
  return Math.ceil((new Date(s).getTime() - today.getTime()) / 86_400_000);
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

const notificationAccent: Record<NotificationKind, string> = {
  insurance: "#d97706",
  road_tax: "#7c3aed",
  manifest_zero_income: "#e11d48",
  monthly_mis: "#059669",
  manifest_date_future: "#9333ea",
  manifest_date_old: "#ca8a04",
  manifest_date_missing: "#dc2626",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function emailPendingNotifications(db: any): Promise<{ sent: number; failed: number }> {
  const { getEmailSettings, withPriyanshiCc } = await import("@/lib/email-settings.server");
  const settings = await getEmailSettings();
  if (!settings.email_send_admin_notifications) return { sent: 0, failed: 0 };
  const recipients = adminAlertEmails();
  if (!process.env.RESEND_API_KEY) {
    console.error("[notifications] Email skipped: RESEND_API_KEY is not configured");
    return { sent: 0, failed: 0 };
  }
  if (recipients.length === 0) {
    console.error("[notifications] Email skipped: no admin alert email is configured");
    return { sent: 0, failed: 0 };
  }

  const { data: pending, error } = await db
    .from("notifications")
    .select("id,kind,ref_id,title,detail,days_left")
    .eq("dismissed", false)
    .is("emailed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load notification emails: ${error.message}`);

  const eligible = (pending ?? []).filter((item: { kind: string }) =>
    shouldEmailNotification(item.kind),
  );
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  // Resolve the owning branch for every pooled alert so its branch inbox is CC'd.
  const manifestIds = eligible
    .filter((i: { kind: string }) =>
      ["manifest_zero_income", "manifest_date_old", "manifest_date_missing"].includes(i.kind),
    )
    .map((i: { ref_id?: string }) => String(i.ref_id ?? "").replace(/^(?:mzi|mdo|mdm)-/, ""));
  const insuranceIds = eligible
    .filter((i: { kind: string }) => i.kind === "insurance")
    .map((i: { ref_id?: string }) => String(i.ref_id ?? "").replace(/^ins-/, ""));
  const roadTaxIds = eligible
    .filter((i: { kind: string }) => i.kind === "road_tax")
    .map((i: { ref_id?: string }) => String(i.ref_id ?? "").replace(/^rt-/, ""));
  const branchIds = new Set<string>();
  const vehicleIds = new Set<string>();
  if (manifestIds.length) {
    const { data: manifests } = await db
      .from("trip_manifests")
      .select("trip_id")
      .in("id", manifestIds);
    const tripIds = (manifests ?? []).map((row: { trip_id: string }) => row.trip_id);
    if (tripIds.length) {
      const { data: trips } = await db.from("trips").select("branch_id").in("id", tripIds);
      for (const row of trips ?? []) if (row.branch_id) branchIds.add(String(row.branch_id));
    }
  }
  for (const [table, ids] of [
    ["vehicle_insurance", insuranceIds],
    ["vehicle_road_tax", roadTaxIds],
  ] as const) {
    if (!ids.length) continue;
    const { data: rows } = await db.from(table).select("vehicle_id").in("id", ids);
    for (const row of rows ?? []) if (row.vehicle_id) vehicleIds.add(String(row.vehicle_id));
  }
  if (vehicleIds.size) {
    const { data: vehicles } = await db
      .from("vehicles")
      .select("branch_id")
      .in("id", [...vehicleIds]);
    for (const row of vehicles ?? []) if (row.branch_id) branchIds.add(String(row.branch_id));
  }
  let branchEmails: string[] = [];
  if (branchIds.size) {
    const { data: branches } = await db
      .from("branches")
      .select("branch_email")
      .in("id", [...branchIds]);
    branchEmails = (branches ?? [])
      .map((row: { branch_email?: string }) => row.branch_email?.trim() ?? "")
      .filter(Boolean);
  }

  const cards = eligible
    .map((item: { kind: NotificationKind; title: string; detail: string }) => {
      const accent = notificationAccent[item.kind] ?? "#4f46e5";
      return `<div style="margin:0 0 12px;padding:16px;border:1px solid #e2e8f0;border-left:4px solid ${accent};border-radius:9px;background:#f8fafc"><div style="font-size:14px;font-weight:700;color:#0f172a">${escapeHtml(item.title)}</div><div style="margin-top:5px;font-size:13px;line-height:1.55;color:#475569">${escapeHtml(item.detail)}</div></div>`;
    })
    .join("");
  try {
    await sendResendEmail({
      to: recipients,
      cc: withPriyanshiCc(branchEmails),
      subject: `${eligible.length} pending admin notification${eligible.length === 1 ? "" : "s"} — Garuda Logistics`,
      html: emailTemplate({
        title: "Pending dashboard notifications",
        eyebrow: "Consolidated alert",
        intro: `This email combines ${eligible.length} unsent notification${eligible.length === 1 ? "" : "s"}, including all older pending alerts and alerts found in the latest sync.`,
        content: cards,
        notice: "Open the notification bell in the dashboard to review or dismiss these alerts.",
      }),
    });
    const ids = eligible.map((item: { id: string }) => item.id);
    const { error: markError } = await db
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .in("id", ids)
      .is("emailed_at", null);
    if (markError)
      throw new Error(`Failed to mark pooled notifications emailed: ${markError.message}`);
    return { sent: eligible.length, failed: 0 };
  } catch (emailError) {
    console.error("[notifications] Pooled admin email failed:", emailError);
    return { sent: 0, failed: eligible.length };
  }
}

/**
 * Computes current bell alerts and sends eligible pending emails without a
 * browser session. Used by the scheduled notification route so delivery does
 * not depend on an administrator having the dashboard open.
 */
export async function syncScheduledNotificationEmails(): Promise<{
  notifications: number;
  sent: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const computed = await computeItems(db);
  const { data: dismissed, error: dismissedError } = await db
    .from("notifications")
    .select("ref_id")
    .eq("dismissed", true);
  if (dismissedError)
    throw new Error(`Failed to read dismissed notifications: ${dismissedError.message}`);

  const dismissedRefs = new Set<string>(
    (dismissed ?? []).map((row: Record<string, unknown>) => String(row.ref_id)),
  );
  // Store every issue independently so a manifest can show both a date warning
  // and a zero-freight warning. Email policy is applied only during delivery.
  const active = computed.filter((item) => !dismissedRefs.has(item.ref_id));
  if (active.length > 0) {
    const now = new Date().toISOString();
    const { error } = await db.from("notifications").upsert(
      active.map((item) => ({
        kind: item.kind,
        ref_id: item.ref_id,
        title: item.title,
        detail: item.detail,
        days_left: item.days_left,
        updated_at: now,
      })),
      { onConflict: "kind,ref_id", ignoreDuplicates: false },
    );
    if (error) throw new Error(`Failed to upsert scheduled notifications: ${error.message}`);
  }

  const delivery = await emailPendingNotifications(db);
  if (delivery.failed > 0) {
    throw new Error(
      `${delivery.failed} notification email${delivery.failed === 1 ? "" : "s"} failed to send`,
    );
  }
  return { notifications: active.length, sent: delivery.sent };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Verifies that the caller is an active Admin or Viewer. Throws on any failure.
 */
async function requireNotificationUser(userId: string): Promise<AppRole> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("app_users")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Auth check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: user not found.");
  if (!(data as { is_active: boolean }).is_active)
    throw new Error("Forbidden: account is inactive.");
  const role = (data as { role: string }).role;
  if (role !== "admin" && role !== "semi_admin" && role !== "viewer")
    throw new Error("Forbidden: notification access required.");
  return role;
}

async function requireAdmin(userId: string): Promise<void> {
  const role = await requireNotificationUser(userId);
  if (role !== "admin" && role !== "semi_admin")
    throw new Error("Forbidden: admin access required.");
}

// ── Compute notifications from live data ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeItems(db: any): Promise<ComputedItem[]> {
  const today = new Date();
  const in30 = addDays(today, 30);
  const items: ComputedItem[] = [];

  // 1 & 2 — expiring insurance / road tax (within 30 days) ──────────────────
  const [{ data: insRows }, { data: rtRows }] = await Promise.all([
    db
      .from("vehicle_insurance")
      .select("id,vehicle_id,end_date,insurance_number")
      .gte("end_date", isoDate(today))
      .lte("end_date", isoDate(in30)),
    db
      .from("vehicle_road_tax")
      .select("id,vehicle_id,end_date,state")
      .gte("end_date", isoDate(today))
      .lte("end_date", isoDate(in30)),
  ]);

  const vIds = [
    ...new Set(
      [
        ...(insRows ?? []).map((r: Record<string, unknown>) => r.vehicle_id as string),
        ...(rtRows ?? []).map((r: Record<string, unknown>) => r.vehicle_id as string),
      ].filter(Boolean),
    ),
  ];
  const vMap = new Map<string, string>();
  if (vIds.length) {
    const { data: vs } = await db.from("vehicles").select("id,registration_number").in("id", vIds);
    for (const v of vs ?? [])
      vMap.set(v.id as string, (v.registration_number as string) ?? String(v.id));
  }

  for (const row of insRows ?? []) {
    const r = row as Record<string, unknown>;
    const dl = daysUntil(r.end_date as string, today);
    const reg = vMap.get(r.vehicle_id as string) ?? String(r.vehicle_id);
    items.push({
      kind: "insurance",
      ref_id: `ins-${r.id}`,
      title: `Insurance expiring in ${dl} day${dl !== 1 ? "s" : ""}`,
      detail: `${reg}${r.insurance_number ? ` — Policy ${r.insurance_number}` : ""} · due ${r.end_date}`,
      days_left: dl,
    });
  }
  for (const row of rtRows ?? []) {
    const r = row as Record<string, unknown>;
    const dl = daysUntil(r.end_date as string, today);
    const reg = vMap.get(r.vehicle_id as string) ?? String(r.vehicle_id);
    items.push({
      kind: "road_tax",
      ref_id: `rt-${r.id}`,
      title: `Road tax expiring in ${dl} day${dl !== 1 ? "s" : ""}`,
      detail: `${reg}${r.state ? ` — ${r.state}` : ""} · due ${r.end_date}`,
      days_left: dl,
    });
  }

  // 3 — open-trip manifests with ₹0 freight + ₹0 loading income ──────────────
  //
  // Strategy mirrors TripForm and PnL:
  //   a) Load ALL open (live) trips from the trips table.
  //   b) Load ALL contract entries (we need them for every manifest's source_id).
  //   c) Load ALL contracts (for the per_manifest_amount fallback).
  //   d) For each manifest, compute actual freight + loading + fixed using
  //      manifestCharges() — the SAME function the trip UI uses.
  //   e) If freight + loading == 0 (fixed is not an alert trigger), flag it.
  //
  // Open trips = all rows in the `trips` table (they are auto-archived to
  // closed_trips by the deadline mechanism; there is no `closed_at` on trips).
  const { data: openTrips } = await db
    .from("trips")
    .select("id,trip_code,contract_id,ownership,start_date");
  // Zero-income checks only apply to own-vehicle trips; rented trips have no freight income
  const ownTripIds = new Set(
    (openTrips ?? [])
      .filter((t: Record<string, unknown>) => t.ownership !== "third_party")
      .map((t: Record<string, unknown>) => t.id as string),
  );
  const openTripIds = (openTrips ?? []).map((t: Record<string, unknown>) => t.id as string);

  if (openTripIds.length) {
    // Load manifests for all open trips — include weight_kg, quantity, source_id
    const { data: mfRows, error: mfError } = await db
      .from("trip_manifests")
      .select(
        "id,trip_id,manifest_number,manifest_date,source_id,from_location_id,to_location_id,from_pin_code,to_pin_code,weight_kg,quantity",
      )
      .in("trip_id", openTripIds);
    if (mfError) throw new Error(`Failed to load manifests: ${mfError.message}`);

    const mfs = (mfRows ?? []) as Array<{
      id: string;
      trip_id: string;
      manifest_number: string | null;
      manifest_date: string | null;
      source_id: string | null;
      from_location_id: string | null;
      to_location_id: string | null;
      from_pin_code: string | null;
      to_pin_code: string | null;
      weight_kg: string | null;
      quantity: string | null;
    }>;

    if (mfs.length) {
      // Collect all unique source_ids (per-manifest contracts) AND trip-level contract_ids
      const sourceIds = [...new Set(mfs.map((m) => m.source_id).filter(Boolean) as string[])];
      const tripContractIds = [
        ...new Set(
          (openTrips ?? [])
            .map((t: Record<string, unknown>) => t.contract_id as string | null)
            .filter(Boolean) as string[],
        ),
      ];

      // Load ALL contract entries for the relevant contracts
      const allContractIds = [...new Set([...sourceIds, ...tripContractIds])];
      type EntryRow = {
        id: string;
        contract_id: string;
        from_location_id: string | null;
        to_location_id: string | null;
        from_pin_code: string | null;
        to_pin_code: string | null;
        freight_route_range_type: string;
        freight_route_ranges: unknown;
        loading_route_range_type: string;
        loading_route_ranges: unknown;
        per_manifest_amount: string | null;
      };
      const allEntries: EntryRow[] = allContractIds.length
        ? ((
            await db
              .from("contract_entries")
              .select(
                "id,contract_id,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges,per_manifest_amount",
              )
              .in("contract_id", allContractIds)
          ).data ?? [])
        : [];

      // Build contract map for manifestCharges (needs contract name for matched flag)
      const contractMap = new Map<string, { id: string; contract_name: string }>();
      if (allContractIds.length) {
        const { data: contracts } = await db
          .from("contracts")
          .select("id,contract_name")
          .in("id", allContractIds);
        for (const c of contracts ?? [])
          contractMap.set(c.id as string, c as { id: string; contract_name: string });
      }

      // Build location name map
      const allLocIds = [
        ...new Set(
          mfs.flatMap((m) => [m.from_location_id, m.to_location_id]).filter(Boolean) as string[],
        ),
      ];
      const locMap = new Map<string, string>();
      if (allLocIds.length) {
        const { data: locs } = await db
          .from("locations")
          .select("id,location_name")
          .in("id", allLocIds);
        for (const l of locs ?? [])
          locMap.set(l.id as string, (l.location_name as string) ?? String(l.id));
      }

      const tripCodeMap = new Map<string, string>(
        (openTrips ?? []).map((t: Record<string, unknown>) => [
          t.id as string,
          t.trip_code as string,
        ]),
      );
      const tripStartMap = new Map<string, string | null>(
        (openTrips ?? []).map((t: Record<string, unknown>) => [
          t.id as string,
          t.start_date as string | null,
        ]),
      );

      // Group entries by contract_id for fast lookup
      const entriesByContract = new Map<string, EntryLite[]>();
      for (const e of allEntries) {
        if (!entriesByContract.has(e.contract_id)) entriesByContract.set(e.contract_id, []);
        entriesByContract.get(e.contract_id)!.push({
          id: e.id,
          contract_id: e.contract_id,
          from_location_id: e.from_location_id,
          to_location_id: e.to_location_id,
          from_pin_code: e.from_pin_code,
          to_pin_code: e.to_pin_code,
          freight_route_range_type:
            (e.freight_route_range_type as "weight" | "quantity") ?? "weight",
          freight_route_ranges: (e.freight_route_ranges ?? []) as EntryLite["freight_route_ranges"],
          loading_route_range_type:
            (e.loading_route_range_type as "weight" | "quantity") ?? "weight",
          loading_route_ranges: (e.loading_route_ranges ?? []) as EntryLite["loading_route_ranges"],
          per_manifest_amount: e.per_manifest_amount,
        });
      }

      // Check each manifest
      for (const m of mfs) {
        const tripCode = tripCodeMap.get(m.trip_id) ?? m.trip_id;
        const lr = m.manifest_number ? `LR ${m.manifest_number}` : "Manifest";
        const tripStart = tripStartMap.get(m.trip_id);
        if (!m.manifest_date) {
          items.push({
            kind: "manifest_date_missing",
            ref_id: `mdm-${m.id}`,
            title: `Manifest date missing — Trip ${tripCode}`,
            detail: `${lr} has no manifest date`,
            days_left: null,
          });
        } else if (tripStart) {
          const difference = Math.round(
            (Date.parse(m.manifest_date) - Date.parse(tripStart)) / 86_400_000,
          );
          if (difference > 0) {
            items.push({
              kind: "manifest_date_future",
              ref_id: `mdf-${m.id}`,
              title: `Manifest date after trip start — Trip ${tripCode}`,
              detail: `${lr} is dated ${m.manifest_date}; trip starts ${tripStart}`,
              days_left: difference,
            });
          } else if (difference < -2) {
            items.push({
              kind: "manifest_date_old",
              ref_id: `mdo-${m.id}`,
              title: `Manifest date is too old — Trip ${tripCode}`,
              detail: `${lr} is dated ${m.manifest_date}, ${Math.abs(difference)} days before trip start ${tripStart}`,
              days_left: difference,
            });
          }
        }

        // Date checks apply to every trip; zero-income checks remain own-vehicle only.
        if (!ownTripIds.has(m.trip_id)) continue;

        // Determine which contract to use: per-manifest source_id first, then trip-level contract_id
        const contractId =
          m.source_id ??
          ((openTrips ?? []).find((t: Record<string, unknown>) => t.id === m.trip_id)
            ?.contract_id as string | null);

        if (!contractId) {
          // No contract at all — manifest definitely has zero income
          const from = m.from_location_id
            ? (locMap.get(m.from_location_id) ?? m.from_location_id)
            : "?";
          const to = m.to_location_id ? (locMap.get(m.to_location_id) ?? m.to_location_id) : "?";
          items.push({
            kind: "manifest_zero_income",
            ref_id: `mzi-${m.id}`,
            title: `₹0 Freight & Loading — Trip ${tripCode}`,
            detail: `${lr}: ${from} → ${to} has no source/contract`,
            days_left: null,
          });
          continue;
        }

        const contract = contractMap.get(contractId);
        const entries = entriesByContract.get(contractId) ?? [];

        // Use the same findEntry + manifestCharges as TripForm
        const manifestLite: ManifestLite = {
          from_location_id: m.from_location_id,
          to_location_id: m.to_location_id,
          from_pin_code: m.from_pin_code,
          to_pin_code: m.to_pin_code,
          weight_kg: m.weight_kg,
          quantity: m.quantity,
        };
        const entry = findEntry(entries, manifestLite);
        const charges = manifestCharges(contract, entry, manifestLite);

        // Freight is mandatory income. Report ₹0 freight even when loading or a
        // fixed charge exists; those separate charges must not hide the error.
        if (charges.freight === 0) {
          const from = m.from_location_id
            ? (locMap.get(m.from_location_id) ?? m.from_location_id)
            : "?";
          const to = m.to_location_id ? (locMap.get(m.to_location_id) ?? m.to_location_id) : "?";
          let reason = "has no matching rate entry";
          if (entry && charges.freight === 0) {
            // Entry was found but computed zero — likely no weight/quantity or rates are zero
            const hasWeight = num(m.weight_kg) > 0;
            const hasQty = num(m.quantity) > 0;
            if (!hasWeight && !hasQty) {
              reason = "has no weight or quantity";
            } else {
              reason =
                charges.loading === 0
                  ? "has ₹0 freight & loading rates"
                  : `has ₹0 freight (loading is ₹${charges.loading.toLocaleString("en-IN")})`;
            }
          }
          items.push({
            kind: "manifest_zero_income",
            ref_id: `mzi-${m.id}`,
            title: `₹0 Freight — Trip ${tripCode}`,
            detail: `${lr}: ${from} → ${to} ${reason}`,
            days_left: null,
          });
        }
      }
    }
  }

  return items;
}

// ── Server functions ──────────────────────────────────────────────────────────

/**
 * Syncs computed notifications into the DB and returns all unread ones.
 *
 * Steps:
 *  1. Verify caller is an active admin.
 *  2. Compute fresh items.
 *  3. Fetch existing dismissed ref_ids → skip upserting those (dismissed stays frozen).
 *  4. Upsert non-dismissed items (INSERT ... ON CONFLICT DO UPDATE title/detail/days_left).
 *  5. Delete non-dismissed rows whose ref_id is no longer in the current computed set.
 *  6. Return all non-dismissed rows.
 */
export const serverSyncNotifications = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string() }))
  .handler(async ({ data: { userId } }): Promise<NotificationItem[]> => {
    const notificationRole = await requireNotificationUser(userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const computed = await computeItems(db);
    const now = new Date().toISOString();

    // Fetch already-dismissed ref_ids so we never overwrite them
    const { data: dismissed, error: dismissedError } = await db
      .from("notifications")
      .select("ref_id")
      .eq("dismissed", true);
    if (dismissedError)
      throw new Error(`Failed to read dismissed notifications: ${dismissedError.message}`);
    const dismissedSet = new Set<string>(
      (dismissed ?? []).map((r: Record<string, unknown>) => r.ref_id as string),
    );

    // Upsert only non-dismissed items
    const toUpsert = computed
      .filter((c) => !dismissedSet.has(c.ref_id))
      .map((c) => ({
        kind: c.kind,
        ref_id: c.ref_id,
        title: c.title,
        detail: c.detail,
        days_left: c.days_left,
        updated_at: now,
      }));

    if (toUpsert.length) {
      const { error: upsertError } = await db
        .from("notifications")
        .upsert(toUpsert, { onConflict: "kind,ref_id", ignoreDuplicates: false });
      if (upsertError) throw new Error(`Failed to upsert notifications: ${upsertError.message}`);
    }

    // Delete non-dismissed rows that are no longer in the computed set (issue resolved)
    const currentRefIds = computed.map((c) => c.ref_id);
    const { data: existing, error: existingError } = await db
      .from("notifications")
      .select("id,kind,ref_id")
      .eq("dismissed", false);
    if (existingError)
      throw new Error(`Failed to read existing notifications: ${existingError.message}`);
    const computedKinds = new Set<NotificationKind>([
      "insurance",
      "road_tax",
      "manifest_zero_income",
      "manifest_date_future",
      "manifest_date_old",
      "manifest_date_missing",
    ]);
    const toDelete = (existing ?? [])
      .filter(
        (r: Record<string, unknown>) =>
          computedKinds.has(r.kind as NotificationKind) &&
          !currentRefIds.includes(r.ref_id as string),
      )
      .map((r: Record<string, unknown>) => r.id as string);
    if (toDelete.length) {
      const { error: deleteError } = await db.from("notifications").delete().in("id", toDelete);
      if (deleteError)
        throw new Error(`Failed to delete resolved notifications: ${deleteError.message}`);
    }

    // Only Admin notification loads may trigger the existing alert email delivery.
    // Viewer/Manager reads remain read-only and do not send duplicate email.
    if (notificationRole === "admin" || notificationRole === "semi_admin") {
      await emailPendingNotifications(db);
    }

    // Return all unread
    const { data, error: readError } = await db
      .from("notifications")
      .select("id,kind,ref_id,title,detail,days_left,created_at")
      .eq("dismissed", false)
      .order("days_left", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (readError) throw new Error(`Failed to read notifications: ${readError.message}`);

    return (data ?? []) as NotificationItem[];
  });

/** Marks a notification dismissed for all admins. */
export const serverDismissNotification = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string(), id: z.string(), dismissedBy: z.string() }))
  .handler(async ({ data: { userId, id, dismissedBy } }) => {
    await requireAdmin(userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { error } = await db
      .from("notifications")
      .update({
        dismissed: true,
        dismissed_at: new Date().toISOString(),
        dismissed_by: dismissedBy,
      })
      .eq("id", id);
    if (error) throw new Error(`Failed to dismiss notification: ${error.message}`);
    return { ok: true };
  });
