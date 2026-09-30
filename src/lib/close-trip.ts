import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { manifestCharges, findEntry, num, type ContractLite, type EntryLite } from "./trip-calc";
import { verifyAppToken } from "./user-auth";

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required before closing the trip`);
  return text;
}

function validDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return parsed;
}

function validateTripForClose(trip: Record<string, unknown>) {
  const ownership = String(trip.ownership ?? "own");
  const startDate = requiredText(trip.start_date, "Start date");
  const endDate = requiredText(trip.end_date, "End date");
  requiredText(trip.start_time, "Start time");
  requiredText(trip.end_time, "End time");
  const start = validDate(startDate, "Start date");
  const end = validDate(endDate, "End date");
  if (end < start) throw new Error("End date cannot be before start date");
  if (endDate === startDate && String(trip.end_time) < String(trip.start_time)) {
    throw new Error("End time cannot be before start time on the same date");
  }

  if (ownership === "own" || ownership === "owned") {
    requiredText(trip.vehicle_id, "Vehicle");
    requiredText(trip.driver_id, "Driver");
    const startOdo = Number(String(trip.odometer_start ?? "").trim());
    const endOdo = Number(String(trip.odometer_end ?? "").trim());
    if (!Number.isFinite(startOdo) || startOdo < 0) {
      throw new Error("Odometer start must be a non-negative number");
    }
    if (!Number.isFinite(endOdo) || endOdo < 0) {
      throw new Error("Odometer end must be a non-negative number");
    }
    if (endOdo < startOdo) throw new Error("Odometer end cannot be less than odometer start");
  }

  if (ownership === "third_party") {
    requiredText(trip.rental_id, "Rental");
    requiredText(trip.third_party_vehicle_number, "Third-party vehicle number");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authorizedTrip(db: any, sessionToken: string, tripId: string) {
  const session = await verifyAppToken(sessionToken);
  if (!session) throw new Error("Your session has expired. Please sign in again.");

  const { data: user, error: userError } = await db
    .from("app_users")
    .select("id,role,is_active")
    .eq("id", session.uid)
    .maybeSingle();
  if (userError || !user?.is_active || user.role !== session.role) {
    throw new Error("Forbidden: active user access is required.");
  }
  if (user.role === "viewer") throw new Error("Viewers cannot close trips.");

  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError || !trip) throw new Error("Trip not found or no longer open.");

  if (user.role === "basic") {
    const { data: accessRows, error: accessError } = await db
      .from("user_branch_access")
      .select("branch_id")
      .eq("user_id", session.uid);
    if (
      accessError ||
      !accessRows?.some((row: { branch_id: string }) => row.branch_id === trip.branch_id)
    ) {
      throw new Error("Forbidden: your account does not have access to this trip.");
    }
  }
  return { trip: trip as Record<string, unknown>, user };
}

export const serverCloseTrip = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string().min(1), tripId: z.string().uuid() }))
  .handler(async ({ data }): Promise<string> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { trip } = await authorizedTrip(db, data.sessionToken, data.tripId);
    validateTripForClose(trip);

    const tripId = data.tripId;
    const read = async <T>(
      label: string,
      query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
    ) => {
      const result = await query;
      if (result.error) throw new Error(`${label}: ${result.error.message}`);
      return result.data;
    };

    const manifests = ((await read(
      "Trip manifests",
      db.from("trip_manifests").select("*").eq("trip_id", tripId).order("created_at"),
    )) ?? []) as Record<string, unknown>[];
    const otherIncome = ((await read(
      "Trip income",
      db.from("trip_other_income").select("*").eq("trip_id", tripId).order("created_at"),
    )) ?? []) as Record<string, unknown>[];
    const expenses = ((await read(
      "Trip expenses",
      db.from("trip_expenses").select("*").eq("trip_id", tripId).order("sort_order"),
    )) ?? []) as Record<string, unknown>[];
    const approvalAdvance = await read(
      "Approval advance",
      db.from("approval_charge_advances").select("*").eq("trip_id", tripId).maybeSingle(),
    );

    const loadMaster = async (table: string, id: unknown) => {
      if (!id) return null;
      return read(`${table} record`, db.from(table).select("*").eq("id", id).maybeSingle());
    };
    const [vehicle, driver, transporter, branch] = await Promise.all([
      loadMaster("vehicles", trip.vehicle_id),
      loadMaster("drivers", trip.driver_id),
      loadMaster("transporters", trip.transporter_id),
      loadMaster("branches", trip.branch_id),
    ]);

    const sourceIds = Array.from(
      new Set(manifests.map((manifest) => manifest.source_id).filter(Boolean)),
    ) as string[];
    const [sources, sourceEntries] = await Promise.all([
      sourceIds.length
        ? read("Contract sources", db.from("contracts").select("*").in("id", sourceIds))
        : Promise.resolve([]),
      sourceIds.length
        ? read(
            "Contract entries",
            db.from("contract_entries").select("*").in("contract_id", sourceIds),
          )
        : Promise.resolve([]),
    ]);
    const sourceMap = new Map<string, ContractLite>(
      ((sources ?? []) as unknown as ContractLite[]).map((source) => [source.id, source]),
    );
    const entries = (sourceEntries ?? []) as unknown as EntryLite[];
    const manifestLines = manifests.map((manifest) => {
      const sourceId = manifest.source_id as string | null;
      const contract = sourceId ? sourceMap.get(sourceId) : undefined;
      const contractEntries = sourceId
        ? entries.filter((entry) => entry.contract_id === sourceId)
        : [];
      const charges = manifestCharges(
        contract,
        findEntry(contractEntries, manifest as never),
        manifest as never,
      );
      return { manifest, ...charges, total: charges.freight + charges.loading + charges.fixed };
    });

    const manifestTotal = manifestLines.reduce((sum, line) => sum + line.total, 0);
    const otherIncomeTotal = otherIncome.reduce((sum, row) => sum + num(row.amount), 0);
    const expenseTotal = expenses.reduce((sum, row) => sum + num(row.amount), 0);
    const tripCode = requiredText(trip.trip_code, "Trip ID");
    const endDate = requiredText(trip.end_date, "End date");
    const tripDate = endDate;
    const expenseSum = (name: string) =>
      expenses
        .filter((row) => row.expense_name === name)
        .reduce((sum, row) => sum + num(row.amount), 0);
    const incomeSum = (name: string) =>
      otherIncome
        .filter((row) => row.income_name === name)
        .reduce((sum, row) => sum + num(row.amount), 0);

    const snapshot = {
      trip,
      manifests,
      manifest_lines: manifestLines,
      other_income: otherIncome,
      approval_charge_advance: approvalAdvance,
      expenses,
      sources: Object.fromEntries(sourceMap),
      source_entries: entries,
      vehicle,
      driver,
      transporter,
      branch,
      totals: {
        manifest_income: manifestTotal,
        other_income: otherIncomeTotal,
        total_income: manifestTotal + otherIncomeTotal,
        total_expense: expenseTotal,
        net_income: manifestTotal + otherIncomeTotal - expenseTotal,
        monthly_contract_charges: 0,
      },
      closed_at: new Date().toISOString(),
    };

    const vehicleId = (trip.vehicle_id as string | null) ?? null;
    const driverId = (trip.driver_id as string | null) ?? null;
    const transporterId = (trip.transporter_id as string | null) ?? null;
    const fastag =
      vehicleId && expenseSum("Toll Charges") > 0
        ? {
            vehicle_id: vehicleId,
            transaction_type: "deduction",
            amount: expenseSum("Toll Charges"),
            transaction_date: tripDate,
            note: `Toll Charges (Trip ${tripCode})`,
          }
        : null;

    const odoStart =
      trip.odometer_start != null && trip.odometer_start !== "" ? num(trip.odometer_start) : null;
    const odoEnd =
      trip.odometer_end != null && trip.odometer_end !== "" ? num(trip.odometer_end) : null;
    const vehicleLog =
      vehicleId &&
      (expenseSum("Fuel Expense") > 0 ||
        expenseSum("Parking Charges") > 0 ||
        odoStart != null ||
        odoEnd != null)
        ? {
            trip_code: tripCode,
            trip_id: tripId,
            vehicle_id: vehicleId,
            trip_date: tripDate,
            fuel_expense: expenseSum("Fuel Expense"),
            parking_charges: expenseSum("Parking Charges"),
            odometer_start: odoStart,
            odometer_end: odoEnd,
          }
        : null;
    const driverLog =
      driverId &&
      (expenseSum("Driver Bata") > 0 ||
        expenseSum("Morning Exp.") > 0 ||
        expenseSum("Night Exp.") > 0)
        ? {
            trip_code: tripCode,
            trip_id: tripId,
            driver_id: driverId,
            trip_date: tripDate,
            driver_bata: expenseSum("Driver Bata"),
            morning_exp: expenseSum("Morning Exp."),
            night_exp: expenseSum("Night Exp."),
          }
        : null;
    const hireCharges = expenseSum("Hire Charges");
    const approvalCharge = incomeSum("Approval Charge");
    const transporterLog =
      transporterId && (hireCharges > 0 || approvalCharge > 0)
        ? {
            trip_code: tripCode,
            trip_id: tripId,
            transporter_id: transporterId,
            trip_date: tripDate,
            hire_charges: hireCharges,
            approval_charge: approvalCharge,
          }
        : null;
    const knownExpenses = new Set([
      "Fuel Expense",
      "Toll Charges",
      "Driver Bata",
      "Morning Exp.",
      "Night Exp.",
      "Sunday",
      "Parking Charges",
      "Dala Charges",
      "Unloading",
      "Hire Charges",
      "Approval Charge",
    ]);
    const otherExps = expenses.filter((row) => !knownExpenses.has(String(row.expense_name ?? "")));
    const otherLog =
      expenseSum("Dala Charges") > 0 ||
      expenseSum("Unloading") > 0 ||
      expenseSum("Sunday") > 0 ||
      otherExps.length > 0
        ? {
            trip_code: tripCode,
            trip_id: tripId,
            trip_date: tripDate,
            dala_charges: expenseSum("Dala Charges"),
            unloading: expenseSum("Unloading"),
            sunday_exp: expenseSum("Sunday"),
            other_amount: otherExps.reduce((sum, row) => sum + num(row.amount), 0),
            other_details: otherExps.map((row) => ({
              name: row.expense_name,
              amount: num(row.amount),
            })),
          }
        : null;

    const { data: archiveId, error: closeError } = await db.rpc("close_trip_atomic", {
      p_trip_id: tripId,
      p_trip_snapshot: snapshot,
      p_trip_code: tripCode,
      p_branch_id: trip.branch_id ?? null,
      p_branch_name: String((branch as Record<string, unknown> | null)?.branch_name ?? ""),
      p_vehicle_id: vehicleId,
      p_driver_id: driverId,
      p_transporter_id: transporterId,
      p_third_party_vehicle_number: (trip.third_party_vehicle_number as string | null) ?? null,
      p_start_date: String(trip.start_date ?? ""),
      p_end_date: endDate,
      p_total_income: manifestTotal + otherIncomeTotal,
      p_total_expense: expenseTotal,
      p_net_income: manifestTotal + otherIncomeTotal - expenseTotal,
      p_fastag: fastag,
      p_vehicle_log: vehicleLog,
      p_driver_log: driverLog,
      p_transporter_log: transporterLog,
      p_other_log: otherLog,
    });
    if (closeError || !archiveId)
      throw new Error(closeError?.message ?? "Could not close trip atomically");
    return String(archiveId);
  });
