/**
 * pnl.ts — Profit & Loss data fetching and computation helpers.
 * Server functions fetch raw data; client helpers compute metrics.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  num,
  manifestCharges,
  manifestChargeDetails,
  findEntry,
  type ContractLite,
  type EntryLite,
} from "./trip-calc";
import { financialYearRange } from "./financial-year";
import { isDriverActive } from "./drivers";

// ── Types ──────────────────────────────────────────────────────────────────────

export type PnLClosedTrip = {
  id: string;
  trip_code: string;
  branch_id: string | null;
  branch_name: string;
  vehicle_id: string | null;
  driver_id: string | null;
  transporter_id: string | null;
  total_income: number;
  total_expense: number;
  net_income: number;
  closed_at: string;
};

export type ManifestDetail = {
  manifest_date: string;
  manifest_number: string;
  from_location: string;
  from_pin_code: string;
  to_location: string;
  to_pin_code: string;
  weight_kg: number;
  quantity: number;
  freight_income: number;
  loading_income: number;
  manifest_income: number; // freight + loading + fixed from manifest_lines
  source_used: string;
  freight_rate_type: "fixed" | "variable" | "—";
  freight_rate_value: number;
  loading_rate_type: "fixed" | "variable" | "—";
  loading_rate_value: number;
};

export type TripAveragesRow = {
  id: string;
  trip_code: string;
  branch_id: string | null;
  branch_name: string;
  total_income: number;
  total_expense: number;
  net_income: number;
  total_weight: number;
  total_quantity: number;
  closed_at: string;
  start_date: string;
  end_date: string;
  ownership: string;
  vehicle_number: string;
  distance_travelled: number | null;
  manifests: ManifestDetail[];
};

export type TripAveragesIncomeRow = {
  branch_id: string | null;
  amount: number;
};

export type TripAveragesData = {
  trips: TripAveragesRow[];
  otherIncome: number;
  totalExpenditure: number;
  fixedIncome: number;
  otherNetPnL: number;
  year: number;
  month: number;
  financialYearStart?: number;
  /** Raw income rows with branch_id for per-branch distribution */
  incomeRows: TripAveragesIncomeRow[];
  /** Raw expenditure rows with branch_id for per-branch distribution */
  expenditureRows: TripAveragesIncomeRow[];
};

export type PnLIncomeRow = {
  id: string;
  branch_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  transporter_id: string | null;
  amount: string;
  entry_date: string;
};

export type PnLExpenditureRow = {
  id: string;
  branch_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  transporter_id: string | null;
  amount: string;
  entry_date: string;
};

export type PnLContractRow = {
  id: string;
  contract_name: string;
  fixed_monthly_charge: number;
  fixed_yearly_charge: number;
  fixed_monthly_charge_note: string;
  fixed_yearly_charge_note: string;
};

export type PnLBranch = {
  id: string;
  branch_name: string;
};

export type PnLVehicle = {
  id: string;
  label: string; // registration_number + nickname
  registration_number: string;
};

export type PnLDriver = {
  id: string;
  label: string; // full_name + driver_code
  full_name: string;
};

export type PnLTransporter = {
  id: string;
  label: string; // transporter_name
};

export type PnLRawData = {
  closedTrips: PnLClosedTrip[];
  incomes: PnLIncomeRow[];
  expenditures: PnLExpenditureRow[];
  contracts: PnLContractRow[];
  branches: PnLBranch[];
  vehicles: PnLVehicle[];
  drivers: PnLDriver[];
  transporters: PnLTransporter[];
  year: number;
  financialYearStart?: number;
  periodMonths: number;
};

export type PnLStats = {
  tripIncome: number;
  tripExpense: number;
  tripGrossProfit: number;
  otherIncome: number;
  fixedIncome: number;
  totalExpenditure: number;
  totalIncome: number;
  totalExpense: number;
  netPnL: number;
  tripCount: number;
};

export type EntityKind = "vehicle" | "driver" | "transporter";
export type PeriodSpec = { year?: number; month?: number; financialYearStart?: number };

// ── Helpers ────────────────────────────────────────────────────────────────────

function mapTrip(r: Record<string, unknown>): PnLClosedTrip {
  // vehicle_id/driver_id/transporter_id were not columns in the original
  // closed_trips schema. For older records they live in snapshot.trip;
  // for newer records (after close-trip.ts was updated) they are top-level.
  const snap = r.snapshot as Record<string, unknown> | null | undefined;
  const snapTrip = snap?.trip as Record<string, unknown> | null | undefined;
  return {
    id: r.id as string,
    trip_code: String(r.trip_code ?? ""),
    branch_id: (r.branch_id as string) ?? null,
    branch_name: String(r.branch_name ?? ""),
    vehicle_id: (r.vehicle_id as string) ?? (snapTrip?.vehicle_id as string) ?? null,
    driver_id: (r.driver_id as string) ?? (snapTrip?.driver_id as string) ?? null,
    transporter_id: (r.transporter_id as string) ?? (snapTrip?.transporter_id as string) ?? null,
    total_income: Number(r.total_income ?? 0),
    total_expense: Number(r.total_expense ?? 0),
    net_income: Number(r.net_income ?? 0),
    closed_at: r.closed_at as string,
  };
}

function extractWeightQty(snapshot: unknown): { weight: number; quantity: number } {
  try {
    const s = snapshot as Record<string, unknown>;
    const manifests = (s?.manifests as Record<string, unknown>[]) ?? [];
    let weight = 0;
    let quantity = 0;
    for (const m of manifests) {
      weight += Number(m.weight_kg ?? 0);
      quantity += Number(m.quantity ?? 0);
    }
    return { weight, quantity };
  } catch {
    return { weight: 0, quantity: 0 };
  }
}

function mapIncome(r: Record<string, unknown>): PnLIncomeRow {
  return {
    id: r.id as string,
    branch_id: (r.branch_id as string) ?? null,
    vehicle_id: (r.vehicle_id as string) ?? null,
    driver_id: (r.driver_id as string) ?? null,
    transporter_id: (r.transporter_id as string) ?? null,
    amount: String(r.amount ?? "0"),
    entry_date: String(r.entry_date ?? ""),
  };
}

function mapExpenditure(r: Record<string, unknown>): PnLExpenditureRow {
  return {
    id: r.id as string,
    branch_id: (r.branch_id as string) ?? null,
    vehicle_id: (r.vehicle_id as string) ?? null,
    driver_id: (r.driver_id as string) ?? null,
    transporter_id: (r.transporter_id as string) ?? null,
    amount: String(r.amount ?? "0"),
    entry_date: String(r.entry_date ?? ""),
  };
}

function mapContract(c: Record<string, unknown>): PnLContractRow {
  return {
    id: c.id as string,
    contract_name: String(c.contract_name ?? ""),
    fixed_monthly_charge: Number(c.fixed_monthly_charge ?? 0),
    fixed_yearly_charge: Number(c.fixed_yearly_charge ?? 0),
    fixed_monthly_charge_note: String(c.fixed_monthly_charge_note ?? ""),
    fixed_yearly_charge_note: String(c.fixed_yearly_charge_note ?? ""),
  };
}

// ── Server-side paginated fetch (mirrors client fetchAll for admin client) ────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllAdmin<T>(buildQuery: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const HARD_CAP = 500_000;
  while (from < HARD_CAP) {
    const to = from + pageSize - 1;
    const res = await buildQuery().range(from, to);
    if (res.error) throw new Error(res.error.message);
    const batch: T[] = res.data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ── Active-trip helper ─────────────────────────────────────────────────────────

/**
 * Fetch active (non-closed) trips in a date range and compute their P&L from
 * raw trip data (manifests × contract rates + other income − expenses).
 * Uses `created_at` for date-range filtering since active trips have no closed_at.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchActiveTrips(db: any, start: string, end: string): Promise<PnLClosedTrip[]> {
  const tripsRes = await db
    .from("trips")
    .select("id,trip_code,branch_id,vehicle_id,driver_id,transporter_id,contract_id,created_at")
    .gte("created_at", start)
    .lt("created_at", end);

  const trips: Record<string, unknown>[] = tripsRes.data ?? [];
  if (trips.length === 0) return [];

  const tripIds = trips.map((t) => t.id as string);
  const contractIds = [...new Set(trips.map((t) => t.contract_id as string).filter(Boolean))];
  const branchIds = [...new Set(trips.map((t) => t.branch_id as string).filter(Boolean))];

  const [manifRes, incRes, expRes, branchRes, contractRes, entryRes] = await Promise.all([
    db
      .from("trip_manifests")
      .select(
        "trip_id,weight_kg,quantity,from_location_id,to_location_id,from_pin_code,to_pin_code",
      )
      .in("trip_id", tripIds),
    db.from("trip_other_income").select("trip_id,amount").in("trip_id", tripIds),
    db.from("trip_expenses").select("trip_id,amount").in("trip_id", tripIds),
    branchIds.length > 0
      ? db.from("branches").select("id,branch_name").in("id", branchIds)
      : Promise.resolve({ data: [] }),
    contractIds.length > 0
      ? db
          .from("contracts")
          .select("id,contract_name,company_name,gstin,fixed_monthly_charge,fixed_yearly_charge")
          .in("id", contractIds)
      : Promise.resolve({ data: [] }),
    contractIds.length > 0
      ? db
          .from("contract_entries")
          .select(
            "contract_id,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges,per_manifest_amount",
          )
          .in("contract_id", contractIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Build lookup maps
  const manifestsByTrip = new Map<string, Record<string, unknown>[]>();
  for (const m of manifRes.data ?? []) {
    const tid = m.trip_id as string;
    if (!manifestsByTrip.has(tid)) manifestsByTrip.set(tid, []);
    manifestsByTrip.get(tid)!.push(m);
  }
  const incomeByTrip = new Map<string, Record<string, unknown>[]>();
  for (const i of incRes.data ?? []) {
    const tid = i.trip_id as string;
    if (!incomeByTrip.has(tid)) incomeByTrip.set(tid, []);
    incomeByTrip.get(tid)!.push(i);
  }
  const expenseByTrip = new Map<string, Record<string, unknown>[]>();
  for (const e of expRes.data ?? []) {
    const tid = e.trip_id as string;
    if (!expenseByTrip.has(tid)) expenseByTrip.set(tid, []);
    expenseByTrip.get(tid)!.push(e);
  }
  const branchNameMap = new Map<string, string>();
  for (const b of branchRes.data ?? [])
    branchNameMap.set(b.id as string, String(b.branch_name ?? ""));

  const contractMap = new Map<string, ContractLite>();
  for (const c of contractRes.data ?? []) contractMap.set(c.id as string, c as ContractLite);

  const entriesByContract = new Map<string, EntryLite[]>();
  for (const e of entryRes.data ?? []) {
    const cid = e.contract_id as string;
    if (!entriesByContract.has(cid)) entriesByContract.set(cid, []);
    entriesByContract.get(cid)!.push(e as EntryLite);
  }

  return trips.map((t): PnLClosedTrip => {
    const manifests = manifestsByTrip.get(t.id as string) ?? [];
    const otherIncs = incomeByTrip.get(t.id as string) ?? [];
    const expenses = expenseByTrip.get(t.id as string) ?? [];
    const contract = t.contract_id ? contractMap.get(t.contract_id as string) : undefined;
    const entries = t.contract_id ? (entriesByContract.get(t.contract_id as string) ?? []) : [];

    const manifestIncome = manifests.reduce((s, m) => {
      const ch = manifestCharges(contract, findEntry(entries, m as never), m as never);
      return s + ch.freight + ch.loading + ch.fixed;
    }, 0);
    const otherIncomeTotal = otherIncs.reduce((s, r) => s + num(r.amount), 0);
    const expenseTotal = expenses.reduce((s, r) => s + num(r.amount), 0);
    const totalIncome = manifestIncome + otherIncomeTotal;

    return {
      id: t.id as string,
      trip_code: String(t.trip_code ?? ""),
      branch_id: (t.branch_id as string) ?? null,
      branch_name: t.branch_id ? (branchNameMap.get(t.branch_id as string) ?? "") : "",
      vehicle_id: (t.vehicle_id as string) ?? null,
      driver_id: (t.driver_id as string) ?? null,
      transporter_id: (t.transporter_id as string) ?? null,
      total_income: totalIncome,
      total_expense: expenseTotal,
      net_income: totalIncome - expenseTotal,
      closed_at: t.created_at as string, // use creation date as proxy for period filtering
    };
  });
}

// ── Server functions ───────────────────────────────────────────────────────────

export const serverFetchPnLYear = createServerFn({ method: "POST" })
  .validator((input: { year: number }) => input)
  .handler(async ({ data }): Promise<PnLRawData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const y = data.year;
    const start = `${y}-01-01`;
    const end = `${y + 1}-01-01`;

    const [
      closedTripsRows,
      activeTrips,
      incomesRows,
      expendituresRows,
      contractsRes,
      branchesRes,
      vehiclesRes,
      driversRes,
      transportersRes,
    ] = await Promise.all([
      // fetchAllAdmin so >1000 trips/year are never silently truncated
      fetchAllAdmin<Record<string, unknown>>(() =>
        db
          .from("closed_trips")
          .select(
            "id,trip_code,branch_id,branch_name,vehicle_id,driver_id,transporter_id,total_income,total_expense,net_income,closed_at,snapshot",
          )
          .gte("closed_at", start)
          .lt("closed_at", end),
      ),
      fetchActiveTrips(db, start, end),
      fetchAllAdmin<Record<string, unknown>>(() =>
        db
          .from("incomes")
          .select("id,branch_id,vehicle_id,driver_id,transporter_id,amount,entry_date")
          .eq("is_fixed_income", false)
          .gte("entry_date", start)
          .lt("entry_date", end),
      ),
      fetchAllAdmin<Record<string, unknown>>(() =>
        db
          .from("expenditures")
          .select("id,branch_id,vehicle_id,driver_id,transporter_id,amount,entry_date")
          .gte("entry_date", start)
          .lt("entry_date", end),
      ),
      db
        .from("contracts")
        .select(
          "id,contract_name,fixed_monthly_charge,fixed_yearly_charge,fixed_monthly_charge_note,fixed_yearly_charge_note",
        )
        .eq("status", "active"),
      db.from("branches").select("id,branch_name"),
      db.from("vehicles").select("id,registration_number,nickname").order("registration_number"),
      db.from("drivers").select("id,full_name,driver_code,ending_date").order("full_name"),
      db.from("transporters").select("id,transporter_name").order("transporter_name"),
    ]);

    return {
      closedTrips: [...closedTripsRows.map(mapTrip), ...activeTrips],
      incomes: incomesRows.map(mapIncome),
      expenditures: expendituresRows.map(mapExpenditure),
      contracts: (contractsRes.data ?? []).map(mapContract),
      branches: (branchesRes.data ?? []).map((b: Record<string, unknown>) => ({
        id: b.id as string,
        branch_name: String(b.branch_name ?? ""),
      })),
      vehicles: (vehiclesRes.data ?? []).map((v: Record<string, unknown>) => ({
        id: v.id as string,
        registration_number: String(v.registration_number ?? ""),
        label: [v.registration_number, v.nickname].filter(Boolean).join(" — "),
      })),
      drivers: (driversRes.data ?? [])
        .filter((d) => isDriverActive(d))
        .map((d: Record<string, unknown>) => ({
          id: d.id as string,
          full_name: String(d.full_name ?? ""),
          label:
            [d.full_name, d.driver_code].filter(Boolean).join(" (") + (d.driver_code ? ")" : ""),
        })),
      transporters: (transportersRes.data ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        label: String(t.transporter_name ?? ""),
      })),
      year: y,
      periodMonths: 12,
    };
  });

export const serverFetchPnLPeriod = createServerFn({ method: "POST" })
  .validator((input: { period: PeriodSpec }) => input)
  .handler(async ({ data }): Promise<PnLRawData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { year, month, financialYearStart } = data.period;
    let start: string;
    let end: string;
    let outputYear = year ?? financialYearStart ?? new Date().getFullYear();

    if (financialYearStart !== undefined) {
      ({ start, end } = financialYearRange(financialYearStart));
      outputYear = financialYearStart;
    } else if (year !== undefined && month !== undefined) {
      const m = String(month).padStart(2, "0");
      start = `${year}-${m}-01`;
      end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    } else if (year !== undefined) {
      start = `${year}-01-01`;
      end = `${year + 1}-01-01`;
    } else {
      throw new Error("Select a calendar year or financial year.");
    }

    const months = month !== undefined ? 1 : 12;

    const [
      closedTripsRows,
      activeTrips,
      incomesRows,
      expendituresRows,
      contractsRes,
      branchesRes,
      vehiclesRes,
      driversRes,
      transportersRes,
    ] = await Promise.all([
      fetchAllAdmin<Record<string, unknown>>(() =>
        db
          .from("closed_trips")
          .select(
            "id,trip_code,branch_id,branch_name,vehicle_id,driver_id,transporter_id,total_income,total_expense,net_income,closed_at,snapshot",
          )
          .gte("closed_at", start)
          .lt("closed_at", end),
      ),
      fetchActiveTrips(db, start, end),
      fetchAllAdmin<Record<string, unknown>>(() =>
        db
          .from("incomes")
          .select("id,branch_id,vehicle_id,driver_id,transporter_id,amount,entry_date")
          .eq("is_fixed_income", false)
          .gte("entry_date", start)
          .lt("entry_date", end),
      ),
      fetchAllAdmin<Record<string, unknown>>(() =>
        db
          .from("expenditures")
          .select("id,branch_id,vehicle_id,driver_id,transporter_id,amount,entry_date")
          .gte("entry_date", start)
          .lt("entry_date", end),
      ),
      db
        .from("contracts")
        .select(
          "id,contract_name,fixed_monthly_charge,fixed_yearly_charge,fixed_monthly_charge_note,fixed_yearly_charge_note",
        )
        .eq("status", "active"),
      db.from("branches").select("id,branch_name"),
      db.from("vehicles").select("id,registration_number,nickname").order("registration_number"),
      db.from("drivers").select("id,full_name,driver_code,ending_date").order("full_name"),
      db.from("transporters").select("id,transporter_name").order("transporter_name"),
    ]);

    return {
      closedTrips: [...closedTripsRows.map(mapTrip), ...activeTrips],
      incomes: incomesRows.map(mapIncome),
      expenditures: expendituresRows.map(mapExpenditure),
      contracts: (contractsRes.data ?? []).map(mapContract),
      branches: (branchesRes.data ?? []).map((b: Record<string, unknown>) => ({
        id: b.id as string,
        branch_name: String(b.branch_name ?? ""),
      })),
      vehicles: (vehiclesRes.data ?? []).map((v: Record<string, unknown>) => ({
        id: v.id as string,
        registration_number: String(v.registration_number ?? ""),
        label: [v.registration_number, v.nickname].filter(Boolean).join(" — "),
      })),
      drivers: (driversRes.data ?? [])
        .filter((d) => isDriverActive(d))
        .map((d: Record<string, unknown>) => ({
          id: d.id as string,
          full_name: String(d.full_name ?? ""),
          label:
            [d.full_name, d.driver_code].filter(Boolean).join(" (") + (d.driver_code ? ")" : ""),
        })),
      transporters: (transportersRes.data ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        label: String(t.transporter_name ?? ""),
      })),
      year: outputYear,
      financialYearStart,
      periodMonths: months,
    };
  });

async function fetchTripAveragesData(
  data: { year?: number; month?: number; financialYearStart?: number },
  allowedBranchIds?: string[],
): Promise<TripAveragesData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const { financialYearStart } = data;
  const year = data.year ?? financialYearStart ?? new Date().getFullYear();
  const month = data.month ?? 1;
  let start: string;
  let end: string;
  const months = financialYearStart !== undefined ? 12 : 1;
  if (financialYearStart !== undefined) {
    ({ start, end } = financialYearRange(financialYearStart));
  } else {
    const m = String(month).padStart(2, "0");
    start = `${year}-${m}-01`;
    end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  }

  const [
    tripsRows,
    incomesRows,
    rawExpenditureRows,
    emiInstallmentRows,
    contractsRes,
    locationsRes,
  ] = await Promise.all([
    fetchAllAdmin<Record<string, unknown>>(() =>
      db
        .from("closed_trips")
        .select(
          "id,trip_code,branch_id,branch_name,vehicle_id,total_income,total_expense,net_income,closed_at,snapshot",
        )
        .gte("closed_at", start)
        .lt("closed_at", end)
        .order("closed_at"),
    ),
    fetchAllAdmin<Record<string, unknown>>(() =>
      db
        .from("incomes")
        .select("branch_id,amount,entry_date")
        .eq("is_fixed_income", false)
        .gte("entry_date", start)
        .lt("entry_date", end),
    ),
    fetchAllAdmin<Record<string, unknown>>(() =>
      db
        .from("expenditures")
        .select("id,branch_id,amount,entry_date,is_emi,emi_installment_id,paid_date")
        .gte("entry_date", start)
        .lt("entry_date", end),
    ),
    fetchAllAdmin<Record<string, unknown>>(() =>
      db
        .from("emi_installments")
        .select("id,expenditure_id,due_date")
        .gte("due_date", start)
        .lt("due_date", end),
    ),
    db.from("contracts").select("fixed_monthly_charge,fixed_yearly_charge").eq("status", "active"),
    db.from("locations").select("id,location_name,pin_code"),
  ]);

  const vehicleIds = [
    ...new Set(
      tripsRows
        .map((row: Record<string, unknown>) => row.vehicle_id as string | null)
        .filter(Boolean) as string[],
    ),
  ];
  const { data: vehicleRows } = vehicleIds.length
    ? await db.from("vehicles").select("id,registration_number").in("id", vehicleIds)
    : { data: [] };
  const vehicleMap = new Map<string, string>(
    (vehicleRows ?? []).map((row: Record<string, unknown>) => [
      String(row.id),
      String(row.registration_number ?? ""),
    ]),
  );

  // Build location id → name map
  const locMap = new Map<string, { name: string; pin: string }>();
  for (const l of locationsRes.data ?? []) {
    locMap.set(String(l.id), {
      name: String(l.location_name ?? l.pin_code ?? ""),
      pin: String(l.pin_code ?? ""),
    });
  }

  function resolveLocation(id: unknown, pin: unknown): { name: string; pin: string } {
    if (id && locMap.has(String(id))) return locMap.get(String(id))!;
    const fallbackPin = String(pin ?? "").trim();
    return { name: fallbackPin || "—", pin: fallbackPin };
  }

  function extractManifests(snapshot: unknown): ManifestDetail[] {
    try {
      const s = snapshot as Record<string, unknown>;
      const rawManifests = (s?.manifests as Record<string, unknown>[]) ?? [];
      const manifestLines = (s?.manifest_lines as Record<string, unknown>[]) ?? [];
      const trip = (s?.trip ?? {}) as Record<string, unknown>;
      const sources = (s?.sources ?? {}) as Record<string, ContractLite>;
      const sourceEntries = (s?.source_entries as EntryLite[]) ?? [];
      return rawManifests.map((m, i) => {
        const line = manifestLines[i] as Record<string, unknown> | undefined;
        const freightIncome = Number(line?.freight ?? 0);
        const loadingIncome = Number(line?.loading ?? 0);
        const income = freightIncome + loadingIncome + Number(line?.fixed ?? 0);
        const sourceId = String(m.source_id ?? trip.contract_id ?? "").trim();
        const source = sources[sourceId];
        const entry = findEntry(
          sourceEntries.filter((item) => item.contract_id === sourceId),
          m as never,
        );
        const rateDetails = manifestChargeDetails(source, entry, m as never);
        const from = resolveLocation(m.from_location_id, m.from_pin_code);
        const to = resolveLocation(m.to_location_id, m.to_pin_code);
        return {
          manifest_date: String(m.manifest_date ?? ""),
          manifest_number: String(m.manifest_number ?? ""),
          from_location: from.name,
          from_pin_code: from.pin,
          to_location: to.name,
          to_pin_code: to.pin,
          weight_kg: Number(m.weight_kg ?? 0),
          quantity: Number(m.quantity ?? 0),
          freight_income: freightIncome,
          loading_income: loadingIncome,
          manifest_income: income,
          source_used: String(source?.contract_name ?? "—"),
          freight_rate_type: rateDetails.freight.type,
          freight_rate_value: rateDetails.freight.value,
          loading_rate_type: rateDetails.loading.type,
          loading_rate_value: rateDetails.loading.value,
        };
      });
    } catch {
      return [];
    }
  }

  const allTrips: TripAveragesRow[] = tripsRows.map((r: Record<string, unknown>) => {
    const { weight, quantity } = extractWeightQty(r.snapshot);
    const snapshot = (r.snapshot ?? {}) as Record<string, unknown>;
    const tripSnapshot = (snapshot.trip ?? snapshot) as Record<string, unknown>;
    const vehicleSnapshot = (snapshot.vehicle ?? {}) as Record<string, unknown>;
    const ownership = String(tripSnapshot.ownership ?? "");
    const vehicleNumber =
      ownership === "third_party"
        ? String(tripSnapshot.third_party_vehicle_number ?? "")
        : String(
            vehicleSnapshot.registration_number ?? vehicleMap.get(String(r.vehicle_id ?? "")) ?? "",
          );
    const hasOdometerReadings =
      String(tripSnapshot.odometer_start ?? "").trim() !== "" &&
      String(tripSnapshot.odometer_end ?? "").trim() !== "";
    const odometerStart = Number(tripSnapshot.odometer_start);
    const odometerEnd = Number(tripSnapshot.odometer_end);
    const recordedDistance = Number(
      tripSnapshot.distance_travelled ?? tripSnapshot.distance_traveled ?? tripSnapshot.distance,
    );
    const distanceTravelled =
      hasOdometerReadings &&
      Number.isFinite(odometerStart) &&
      Number.isFinite(odometerEnd) &&
      odometerEnd >= odometerStart
        ? odometerEnd - odometerStart
        : Number.isFinite(recordedDistance) && recordedDistance >= 0
          ? recordedDistance
          : null;
    return {
      id: r.id as string,
      trip_code: String(r.trip_code ?? ""),
      branch_id: (r.branch_id as string) ?? null,
      branch_name: String(r.branch_name ?? ""),
      total_income: Number(r.total_income ?? 0),
      total_expense: Number(r.total_expense ?? 0),
      net_income: Number(r.net_income ?? 0),
      total_weight: weight,
      total_quantity: quantity,
      closed_at: r.closed_at as string,
      start_date: String(tripSnapshot.start_date ?? ""),
      end_date: String(tripSnapshot.end_date ?? ""),
      ownership,
      vehicle_number: vehicleNumber,
      distance_travelled: distanceTravelled,
      manifests: extractManifests(r.snapshot),
    };
  });

  // Basic users are scoped on the server, not just in the UI. Unassigned
  // branch pools are excluded because they cannot be safely attributed to an
  // assigned branch.
  const scopedTrips =
    allowedBranchIds === undefined
      ? allTrips
      : allTrips.filter(
          (trip) => trip.branch_id !== null && allowedBranchIds.includes(trip.branch_id),
        );
  const trips =
    allowedBranchIds === undefined
      ? scopedTrips
      : scopedTrips.map((trip) => ({
          ...trip,
          total_income: 0,
          // Basic users are allowed to see trip expense and its allocated
          // expense distribution, but not income or profit figures.
          net_income: 0,
          manifests: trip.manifests.map((manifest) => ({
            ...manifest,
            freight_income: 0,
            loading_income: 0,
            manifest_income: 0,
          })),
        }));
  const scopedIncomeRows =
    allowedBranchIds === undefined
      ? incomesRows
      : incomesRows.filter((r: Record<string, unknown>) => {
          const branchId = (r.branch_id as string | null) ?? null;
          return branchId !== null && allowedBranchIds.includes(branchId);
        });
  // Report expenses on their accounting date. EMI rows are always anchored to
  // the installment due date; paid_date is cash-flow metadata and must not move
  // an EMI into the month in which someone happened to pay it.
  const dueDateByExpenditureId = new Map<string, string>();
  for (const installment of emiInstallmentRows) {
    if (installment.expenditure_id && installment.due_date) {
      dueDateByExpenditureId.set(String(installment.expenditure_id), String(installment.due_date));
    }
  }
  const expenditureById = new Map<string, Record<string, unknown>>();
  for (const row of rawExpenditureRows) expenditureById.set(String(row.id), row);
  for (const installment of emiInstallmentRows) {
    const id = installment.expenditure_id ? String(installment.expenditure_id) : "";
    if (id && !expenditureById.has(id)) {
      const linked = await db
        .from("expenditures")
        .select("id,branch_id,amount,entry_date,is_emi,emi_installment_id,paid_date")
        .eq("id", id)
        .maybeSingle();
      if (linked.data) expenditureById.set(id, linked.data as Record<string, unknown>);
    }
  }
  const accountingExpenditureRows = Array.from(expenditureById.values()).filter((row) => {
    const reportDate = dueDateByExpenditureId.get(String(row.id)) ?? String(row.entry_date ?? "");
    return reportDate >= start && reportDate < end;
  });
  const scopedExpenditureRows =
    allowedBranchIds === undefined
      ? accountingExpenditureRows
      : accountingExpenditureRows.filter((r: Record<string, unknown>) => {
          const branchId = (r.branch_id as string | null) ?? null;
          return branchId !== null && allowedBranchIds.includes(branchId);
        });

  const otherIncome = scopedIncomeRows.reduce(
    (s: number, r: Record<string, unknown>) => s + Number(r.amount ?? 0),
    0,
  );
  const totalExpenditure = scopedExpenditureRows.reduce(
    (s: number, r: Record<string, unknown>) => s + Number(r.amount ?? 0),
    0,
  );
  const fixedIncome =
    allowedBranchIds === undefined
      ? (contractsRes.data ?? []).reduce((s: number, c: Record<string, unknown>) => {
          return (
            s +
            (Number(c.fixed_monthly_charge ?? 0) + Number(c.fixed_yearly_charge ?? 0) / 12) * months
          );
        }, 0)
      : 0;
  const otherNetPnL = otherIncome + fixedIncome - totalExpenditure;

  const incomeRows = scopedIncomeRows.map((r: Record<string, unknown>) => ({
    branch_id: (r.branch_id as string) ?? null,
    amount: Number(r.amount ?? 0),
  }));
  const expenditureRows = scopedExpenditureRows.map((r: Record<string, unknown>) => ({
    branch_id: (r.branch_id as string) ?? null,
    amount: Number(r.amount ?? 0),
  }));

  return {
    trips,
    otherIncome,
    totalExpenditure,
    fixedIncome,
    otherNetPnL,
    year,
    month,
    financialYearStart,
    incomeRows,
    expenditureRows,
  };
}

export const serverFetchTripAverages = createServerFn({ method: "POST" })
  .validator((input: { year?: number; month?: number; financialYearStart?: number }) => input)
  .handler(async ({ data }): Promise<TripAveragesData> => fetchTripAveragesData(data));

/**
 * Trip Details is available to every signed-in role. Basic users are scoped
 * from the server to their assigned branches; admin and manager/viewer users
 * receive the complete period dataset.
 */
export const serverFetchTripDetails = createServerFn({ method: "POST" })
  .validator(
    (input: { year?: number; month?: number; financialYearStart?: number; sessionToken: string }) =>
      input,
  )
  .handler(async ({ data }): Promise<TripAveragesData> => {
    const token = data.sessionToken;
    const lastColon = token.lastIndexOf(":");
    if (lastColon === -1) throw new Error("Forbidden: invalid session.");

    const payload = token.slice(0, lastColon);
    const suppliedSig = token.slice(lastColon + 1);
    const parts = payload.split(":");
    if (parts.length !== 3) throw new Error("Forbidden: invalid session.");
    const [uid, role, expiresStr] = parts;
    const expiresMs = Number(expiresStr);
    if (!uid || !Number.isFinite(expiresMs) || Date.now() > expiresMs) {
      throw new Error("Forbidden: session expired.");
    }

    const { createHmac, timingSafeEqual } = await import("crypto");
    const secret = process.env.SESSION_SECRET ?? "dev-fallback-secret";
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (suppliedSig.length !== expected.length) throw new Error("Forbidden: invalid session.");
    if (!timingSafeEqual(Buffer.from(suppliedSig), Buffer.from(expected))) {
      throw new Error("Forbidden: invalid session.");
    }
    if (role !== "admin" && role !== "semi_admin" && role !== "viewer" && role !== "basic") {
      throw new Error("Forbidden: invalid role.");
    }

    let allowedBranchIds: string[] | undefined;
    if (role === "basic") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const accessQuery = supabaseAdmin
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", uid);
      const { data: accessRows, error } = await accessQuery;
      if (error) throw new Error(`Could not load branch access: ${error.message}`);
      allowedBranchIds = ((accessRows ?? []) as { branch_id: string }[]).map(
        (row) => row.branch_id,
      );
    }

    return fetchTripAveragesData(data, allowedBranchIds);
  });

// ── Client-side computation helpers ───────────────────────────────────────────

/** Filter trips/income/expenditure by branch. */
export function computePnL(data: PnLRawData, branchId: string | null): PnLStats {
  const filterBranch = <T extends { branch_id: string | null }>(arr: T[]) =>
    branchId ? arr.filter((r) => r.branch_id === branchId) : arr;

  const trips = filterBranch(data.closedTrips);
  const incomes = filterBranch(data.incomes);
  const expenditures = filterBranch(data.expenditures);

  const tripIncome = trips.reduce((s, t) => s + t.total_income, 0);
  const tripExpense = trips.reduce((s, t) => s + t.total_expense, 0);
  const tripGrossProfit = tripIncome - tripExpense;
  const otherIncome = incomes.reduce((s, r) => s + num(r.amount), 0);
  const totalExpenditure = expenditures.reduce((s, r) => s + num(r.amount), 0);

  const numBranches = Math.max(data.branches.length, 1);
  const fixedIncome = data.contracts.reduce((s, c) => {
    const monthly = c.fixed_monthly_charge;
    const yearlyMonthly = c.fixed_yearly_charge / 12;
    const total = monthly + yearlyMonthly;
    const periodTotal = total * data.periodMonths;
    return s + (branchId ? periodTotal / numBranches : periodTotal);
  }, 0);

  const totalIncome = tripIncome + otherIncome + fixedIncome;
  const totalExpense = tripExpense + totalExpenditure;
  const netPnL = totalIncome - totalExpense;

  return {
    tripIncome,
    tripExpense,
    tripGrossProfit,
    otherIncome,
    fixedIncome,
    totalExpenditure,
    totalIncome,
    totalExpense,
    netPnL,
    tripCount: trips.length,
  };
}

/** Filter trips/income/expenditure by a specific entity (vehicle/driver/transporter).
 *  entityId=null means all entities combined. Fixed income is excluded from entity views. */
export function computePnLForEntity(
  data: PnLRawData,
  kind: EntityKind,
  entityId: string | null,
): PnLStats {
  const field =
    kind === "vehicle" ? "vehicle_id" : kind === "driver" ? "driver_id" : "transporter_id";

  const filterEntity = <
    T extends {
      vehicle_id: string | null;
      driver_id: string | null;
      transporter_id: string | null;
    },
  >(
    arr: T[],
  ) => (entityId ? arr.filter((r) => r[field] === entityId) : arr);

  const trips = filterEntity(data.closedTrips);
  const incomes = filterEntity(data.incomes);
  const expenditures = filterEntity(data.expenditures);

  const tripIncome = trips.reduce((s, t) => s + t.total_income, 0);
  const tripExpense = trips.reduce((s, t) => s + t.total_expense, 0);
  const tripGrossProfit = tripIncome - tripExpense;
  const otherIncome = incomes.reduce((s, r) => s + num(r.amount), 0);
  const totalExpenditure = expenditures.reduce((s, r) => s + num(r.amount), 0);

  const totalIncome = tripIncome + otherIncome; // no fixed income per entity
  const totalExpense = tripExpense + totalExpenditure;
  const netPnL = totalIncome - totalExpense;

  return {
    tripIncome,
    tripExpense,
    tripGrossProfit,
    otherIncome,
    fixedIncome: 0,
    totalExpenditure,
    totalIncome,
    totalExpense,
    netPnL,
    tripCount: trips.length,
  };
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Dashboard month buckets follow the selected accounting period. Financial
 * years start in April, rather than silently presenting January first. */
export function accountingMonths(data: Pick<PnLRawData, "year" | "financialYearStart">) {
  const isFinancialYear = data.financialYearStart !== undefined;
  const monthNumbers = isFinancialYear
    ? [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return monthNumbers.map((month) => ({
    label: SHORT_MONTHS[month - 1],
    prefix: `${month < 4 && isFinancialYear ? data.year + 1 : data.year}-${String(month).padStart(2, "0")}`,
  }));
}

/** Compute monthly P&L for a branch view (full-year dataset). */
export function computeMonthlyPnL(
  data: PnLRawData,
  branchId: string | null,
): Array<{
  month: string;
  tripIncome: number;
  otherIncome: number;
  fixedIncome: number;
  expenditures: number;
  netPnL: number;
}> {
  const numBranches = Math.max(data.branches.length, 1);
  const perMonthFixed = data.contracts.reduce((s, c) => {
    const total = c.fixed_monthly_charge + c.fixed_yearly_charge / 12;
    return s + (branchId ? total / numBranches : total);
  }, 0);

  return accountingMonths(data).map(({ label, prefix: monthStr }) => {
    const trips = data.closedTrips.filter(
      (t) => (!branchId || t.branch_id === branchId) && t.closed_at.startsWith(monthStr),
    );
    const incomes = data.incomes.filter(
      (r) => (!branchId || r.branch_id === branchId) && r.entry_date.startsWith(monthStr),
    );
    const expenditures = data.expenditures.filter(
      (r) => (!branchId || r.branch_id === branchId) && r.entry_date.startsWith(monthStr),
    );

    const tripIncome = trips.reduce((s, t) => s + t.total_income, 0);
    const tripExpense = trips.reduce((s, t) => s + t.total_expense, 0);
    const otherIncome = incomes.reduce((s, r) => s + num(r.amount), 0);
    const totalExpenditure = expenditures.reduce((s, r) => s + num(r.amount), 0);
    const fixedIncome = perMonthFixed;
    const netPnL = tripIncome + otherIncome + fixedIncome - tripExpense - totalExpenditure;

    return {
      month: label,
      tripIncome,
      otherIncome,
      fixedIncome,
      expenditures: tripExpense + totalExpenditure,
      netPnL,
    };
  });
}

/** Compute monthly P&L filtered by entity (no fixed income). */
export function computeMonthlyPnLForEntity(
  data: PnLRawData,
  kind: EntityKind,
  entityId: string | null,
): Array<{
  month: string;
  tripIncome: number;
  otherIncome: number;
  expenditures: number;
  netPnL: number;
}> {
  const field =
    kind === "vehicle" ? "vehicle_id" : kind === "driver" ? "driver_id" : "transporter_id";

  return accountingMonths(data).map(({ label, prefix: monthStr }) => {
    const filter = (r: Record<string, unknown>) =>
      (!entityId || r[field] === entityId) &&
      String(r.closed_at ?? r.entry_date ?? "").startsWith(monthStr);

    const trips = data.closedTrips.filter(
      (t) =>
        (!entityId || t[field as keyof typeof t] === entityId) && t.closed_at.startsWith(monthStr),
    );
    const incomes = data.incomes.filter(
      (r) =>
        (!entityId || r[field as keyof typeof r] === entityId) && r.entry_date.startsWith(monthStr),
    );
    const expenditures = data.expenditures.filter(
      (r) =>
        (!entityId || r[field as keyof typeof r] === entityId) && r.entry_date.startsWith(monthStr),
    );

    const tripIncome = trips.reduce((s, t) => s + t.total_income, 0);
    const tripExpense = trips.reduce((s, t) => s + t.total_expense, 0);
    const otherIncome = incomes.reduce((s, r) => s + num(r.amount), 0);
    const totalExpenditure = expenditures.reduce((s, r) => s + num(r.amount), 0);
    const netPnL = tripIncome + otherIncome - tripExpense - totalExpenditure;

    return {
      month: label,
      tripIncome,
      otherIncome,
      expenditures: tripExpense + totalExpenditure,
      netPnL,
    };
  });
}
