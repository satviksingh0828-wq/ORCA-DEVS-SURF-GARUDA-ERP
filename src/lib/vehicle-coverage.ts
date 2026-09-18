/**
 * vehicle-coverage.ts
 * Server functions for Vehicle Insurance and Road Tax.
 * All DB operations go through supabaseAdmin (service role) to bypass RLS on
 * vehicle_insurance / vehicle_road_tax tables.
 *
 * SECURITY: Every exported server function accepts a `userId` field and calls
 * requireAdmin() before touching any data.  requireAdmin() looks up the user
 * in app_users and throws if the role is not 'admin'.  This means a malicious
 * or unauthenticated caller who knows the endpoint URL still cannot perform
 * writes, deletes, or read sensitive coverage data.
 *
 * Monthly expense calculation (day-accurate):
 *   daily_rate   = total_amount / total_days_inclusive
 *   monthly_amt  = daily_rate × actual_days_covered_in_that_calendar_month
 * This gives proper 28/29/30/31-day months and handles partial first/last months.
 */

import { createServerFn } from "@tanstack/react-start";

// ── Auth helper ────────────────────────────────────────────────────────────────

async function requireAdmin(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`Auth check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: user not found.");
  if (!(data as { is_active: boolean }).is_active) throw new Error("Forbidden: account is inactive.");
  if ((data as { role: string }).role !== "admin" && (data as { role: string }).role !== "semi_admin") throw new Error("Forbidden: admin access required.");
}

// ── Shared month helpers ───────────────────────────────────────────────────────

export const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthShort(m: number) { return MONTH_SHORT[m - 1] ?? String(m); }

function monthCount(sm: number, sy: number, em: number, ey: number): number {
  return (ey * 12 + em) - (sy * 12 + sm) + 1;
}

// ── Day-accurate monthly split ─────────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD string into numeric components without any timezone shift.
 * `new Date('YYYY-MM-DD')` parses as UTC midnight and drifts to the previous local
 * day in negative-offset zones — always use this helper instead.
 */
function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const parts = iso.split("-");
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

/** UTC milliseconds for a calendar date (no time-zone shift). */
function dateUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

/** Days in a calendar month, computed entirely in UTC. */
function daysInCalendarMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Total inclusive days between two ISO date strings (YYYY-MM-DD).
 * Uses pure UTC arithmetic — safe in every timezone.
 */
export function totalDaysBetween(startDate: string, endDate: string): number {
  const s = parseIsoDate(startDate);
  const e = parseIsoDate(endDate);
  return Math.round((dateUtcMs(e.year, e.month, e.day) - dateUtcMs(s.year, s.month, s.day)) / 86_400_000) + 1;
}

/**
 * Splits total_amount across calendar months using actual days per month.
 * Handles partial first and last months correctly.
 * Uses UTC arithmetic throughout — no timezone shift on `YYYY-MM-DD` strings.
 * Zero-day slices are silently skipped (guard for identical start/end edge cases).
 *
 * Returns an array of { month (1-12), year, days (covered in that month), amount }.
 */
export function splitByMonth(
  startDate: string,
  endDate: string,
  totalAmount: number,
): Array<{ month: number; year: number; days: number; amount: number }> {
  const s = parseIsoDate(startDate);
  const e = parseIsoDate(endDate);

  const totalDays = totalDaysBetween(startDate, endDate);
  if (totalDays <= 0) return [];
  const dailyRate = totalAmount / totalDays;

  const result: Array<{ month: number; year: number; days: number; amount: number }> = [];

  let curYear  = s.year;
  let curMonth = s.month; // 1-based

  const rangeStartMs = dateUtcMs(s.year, s.month, s.day);
  const rangeEndMs   = dateUtcMs(e.year, e.month, e.day);

  while (curYear < e.year || (curYear === e.year && curMonth <= e.month)) {
    const monthFirstMs = dateUtcMs(curYear, curMonth, 1);
    const monthLastMs  = dateUtcMs(curYear, curMonth, daysInCalendarMonth(curYear, curMonth));

    const clampedStartMs = Math.max(rangeStartMs, monthFirstMs);
    const clampedEndMs   = Math.min(rangeEndMs,   monthLastMs);

    const days = Math.round((clampedEndMs - clampedStartMs) / 86_400_000) + 1;

    if (days > 0) {
      const amount = Math.round(dailyRate * days * 100) / 100;
      result.push({ month: curMonth, year: curYear, days, amount });
    }

    curMonth++;
    if (curMonth > 12) { curMonth = 1; curYear++; }
  }

  return result;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type InsuranceEntry = {
  id: string;
  vehicle_id: string;
  start_date: string;
  end_date: string;
  start_month: number;
  start_year: number;
  end_month: number;
  end_year: number;
  total_amount: number;
  insurance_number: string;
  created_at: string;
};

export type RoadTaxEntry = {
  id: string;
  vehicle_id: string;
  start_date: string;
  end_date: string;
  start_month: number;
  start_year: number;
  end_month: number;
  end_year: number;
  total_amount: number;
  state: string;
  created_at: string;
};

// ── Insurance server functions ─────────────────────────────────────────────────

export const serverLoadInsurance = createServerFn({ method: "POST" })
  .validator((data: { userId: string; vehicleId: string }) => data)
  .handler(async ({ data }): Promise<InsuranceEntry[]> => {
    await requireAdmin(data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("vehicle_insurance")
      .select("*")
      .eq("vehicle_id", data.vehicleId)
      .order("start_year", { ascending: false })
      .order("start_month", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as InsuranceEntry[];
  });

export const serverSaveInsurance = createServerFn({ method: "POST" })
  .validator((data: {
    userId: string;
    vehicleId: string;
    branchId: string | null;
    registrationNumber: string;
    startDate: string;   // YYYY-MM-DD
    endDate: string;     // YYYY-MM-DD
    totalAmount: number;
    insuranceNumber: string;
    paymentLedgerId: string;
  }) => data)
  .handler(async ({ data }) => {
    await requireAdmin(data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Derive month/year from dates (UTC-safe — no new Date() on YYYY-MM-DD strings)
    const startD = parseIsoDate(data.startDate);
    const endD   = parseIsoDate(data.endDate);
    const startMonth = startD.month;
    const startYear  = startD.year;
    const endMonth   = endD.month;
    const endYear    = endD.year;

    if (dateUtcMs(endD.year, endD.month, endD.day) < dateUtcMs(startD.year, startD.month, startD.day))
      throw new Error("End date must not be before start date.");

    const count = monthCount(startMonth, startYear, endMonth, endYear);
    if (count > 120) throw new Error("Period cannot exceed 10 years.");

    // Check for overlapping insurance entries
    const newStart = startYear * 12 + startMonth;
    const newEnd   = endYear   * 12 + endMonth;

    const { data: existing, error: overlapErr } = await supabaseAdmin
      .from("vehicle_insurance")
      .select("insurance_number, start_month, start_year, end_month, end_year")
      .eq("vehicle_id", data.vehicleId);

    if (overlapErr) throw new Error(overlapErr.message);

    for (const row of existing ?? []) {
      const exStart = (row.start_year as number) * 12 + (row.start_month as number);
      const exEnd   = (row.end_year   as number) * 12 + (row.end_month   as number);
      if (newStart <= exEnd && exStart <= newEnd) {
        throw new Error(
          `This period overlaps with existing insurance "${row.insurance_number}" ` +
          `(${MONTH_NAMES[(row.start_month as number) - 1]} ${row.start_year} – ` +
          `${MONTH_NAMES[(row.end_month as number) - 1]} ${row.end_year}).`
        );
      }
    }

    // Insert insurance record
    const { data: ins, error: insErr } = await supabaseAdmin
      .from("vehicle_insurance")
      .insert({
        vehicle_id: data.vehicleId,
        start_date: data.startDate,
        end_date: data.endDate,
        start_month: startMonth,
        start_year: startYear,
        end_month: endMonth,
        end_year: endYear,
        total_amount: data.totalAmount,
        insurance_number: data.insuranceNumber,
        paid_by_ledger_id: data.paymentLedgerId,
      } as never)
      .select("id")
      .single();

    if (insErr) {
      if (insErr.code === "23505") {
        throw new Error("An insurance entry for this exact period already exists for this vehicle.");
      }
      throw new Error(insErr.message);
    }

    const insuranceId = (ins as { id: string }).id;

    // Day-accurate monthly split
    const monthSlices = splitByMonth(data.startDate, data.endDate, data.totalAmount);
    const totalDays   = totalDaysBetween(data.startDate, data.endDate);

    const expenditureRows = monthSlices.map(({ month, year, days, amount }, index) => {
      const entryDate = index === 0
        ? data.startDate
        : `${year}-${String(month).padStart(2, "0")}-01`;
      return {
        expenditure_name: `Insurance Premium — ${data.registrationNumber} (${monthShort(month)} ${year})`,
        amount: String(amount),
        entry_date: entryDate,
        note: `Policy: ${data.insuranceNumber} | ${days} days`,
        vehicle_id: data.vehicleId,
        branch_id: data.branchId,
        is_paid: true,
        paid_date: entryDate,
        is_insurance: true,
        insurance_id: insuranceId,
      };
    });

    const { error: expErr } = await supabaseAdmin
      .from("expenditures")
      .insert(expenditureRows as never);

    if (expErr) {
      await supabaseAdmin.from("vehicle_insurance").delete().eq("id", insuranceId);
      throw new Error(`Expenditure creation failed: ${expErr.message}`);
    }

    return { id: insuranceId, totalDays, monthCount: monthSlices.length };
  });

export const serverDeleteInsurance = createServerFn({ method: "POST" })
  .validator((data: { userId: string; insuranceId: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin(data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("expenditures").delete().eq("insurance_id", data.insuranceId);

    const { error } = await supabaseAdmin
      .from("vehicle_insurance")
      .delete()
      .eq("id", data.insuranceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Road Tax server functions ──────────────────────────────────────────────────

export const serverLoadRoadTax = createServerFn({ method: "POST" })
  .validator((data: { userId: string; vehicleId: string }) => data)
  .handler(async ({ data }): Promise<RoadTaxEntry[]> => {
    await requireAdmin(data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("vehicle_road_tax")
      .select("*")
      .eq("vehicle_id", data.vehicleId)
      .order("start_year", { ascending: false })
      .order("start_month", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as RoadTaxEntry[];
  });

export const serverSaveRoadTax = createServerFn({ method: "POST" })
  .validator((data: {
    userId: string;
    vehicleId: string;
    branchId: string | null;
    registrationNumber: string;
    startDate: string;   // YYYY-MM-DD
    endDate: string;     // YYYY-MM-DD
    totalAmount: number;
    state: string;
    paymentLedgerId: string;
  }) => data)
  .handler(async ({ data }) => {
    await requireAdmin(data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Derive month/year from dates (UTC-safe — no new Date() on YYYY-MM-DD strings)
    const startD = parseIsoDate(data.startDate);
    const endD   = parseIsoDate(data.endDate);
    const startMonth = startD.month;
    const startYear  = startD.year;
    const endMonth   = endD.month;
    const endYear    = endD.year;

    if (dateUtcMs(endD.year, endD.month, endD.day) < dateUtcMs(startD.year, startD.month, startD.day))
      throw new Error("End date must not be before start date.");

    const count = monthCount(startMonth, startYear, endMonth, endYear);
    if (count > 120) throw new Error("Period cannot exceed 10 years.");

    const { data: rt, error: rtErr } = await supabaseAdmin
      .from("vehicle_road_tax")
      .insert({
        vehicle_id: data.vehicleId,
        start_date: data.startDate,
        end_date: data.endDate,
        start_month: startMonth,
        start_year: startYear,
        end_month: endMonth,
        end_year: endYear,
        total_amount: data.totalAmount,
        state: data.state,
        paid_by_ledger_id: data.paymentLedgerId,
      } as never)
      .select("id")
      .single();

    if (rtErr) throw new Error(rtErr.message);

    const roadTaxId = (rt as { id: string }).id;

    const monthSlices = splitByMonth(data.startDate, data.endDate, data.totalAmount);
    const totalDays   = totalDaysBetween(data.startDate, data.endDate);

    const expenditureRows = monthSlices.map(({ month, year, days, amount }, index) => {
      const entryDate = index === 0
        ? data.startDate
        : `${year}-${String(month).padStart(2, "0")}-01`;
      return {
        expenditure_name: `Road Tax — ${data.registrationNumber} (${monthShort(month)} ${year})`,
        amount: String(amount),
        entry_date: entryDate,
        note: `State: ${data.state} | ${days} days`,
        vehicle_id: data.vehicleId,
        branch_id: data.branchId,
        is_paid: true,
        paid_date: entryDate,
        is_road_tax: true,
        road_tax_id: roadTaxId,
      };
    });

    const { error: expErr } = await supabaseAdmin
      .from("expenditures")
      .insert(expenditureRows as never);

    if (expErr) {
      await supabaseAdmin.from("vehicle_road_tax").delete().eq("id", roadTaxId);
      throw new Error(`Expenditure creation failed: ${expErr.message}`);
    }

    return { id: roadTaxId, totalDays, monthCount: monthSlices.length };
  });

export const serverDeleteRoadTax = createServerFn({ method: "POST" })
  .validator((data: { userId: string; roadTaxId: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin(data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("expenditures").delete().eq("road_tax_id", data.roadTaxId);

    const { error } = await supabaseAdmin
      .from("vehicle_road_tax")
      .delete()
      .eq("id", data.roadTaxId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Insurance lookup for Trip Note PDF ────────────────────────────────────────

export const serverFetchInsuranceForMonth = createServerFn({ method: "POST" })
  .validator((data: { userId: string; vehicleId: string; month: number; year: number }) => data)
  .handler(async ({ data }): Promise<string | null> => {
    await requireAdmin(data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("vehicle_insurance")
      .select("insurance_number,start_month,start_year,end_month,end_year")
      .eq("vehicle_id", data.vehicleId);

    if (error || !rows) return null;

    const tripIndex = data.year * 12 + data.month;
    for (const row of rows) {
      const startIndex = (row.start_year as number) * 12 + (row.start_month as number);
      const endIndex   = (row.end_year as number)   * 12 + (row.end_month as number);
      if (tripIndex >= startIndex && tripIndex <= endIndex) {
        return row.insurance_number as string;
      }
    }
    return null;
  });
