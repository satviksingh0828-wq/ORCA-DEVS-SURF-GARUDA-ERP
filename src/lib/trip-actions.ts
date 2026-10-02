import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "./user-auth";

export const serverSaveTripLines = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(1),
      tripId: z.string().uuid(),
      income: z.array(
        z.object({
          income_name: z.string(),
          amount: z.string(),
          note: z.string(),
          payment_ledger_id: z.string().uuid().nullable(),
        }),
      ),
      expenses: z.array(
        z.object({
          expense_name: z.string(),
          amount: z.string(),
          note: z.string(),
          payment_ledger_id: z.string().uuid().nullable(),
          sort_order: z.number().int(),
        }),
      ),
      approval: z
        .object({
          trip_code: z.string(),
          rental_id: z.string().uuid(),
          advance: z.number(),
          balance: z.number(),
        })
        .nullable(),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const { data: user, error: userError } = await db
      .from("app_users")
      .select("id,role,is_active")
      .eq("id", session.uid)
      .maybeSingle();
    if (userError || !user?.is_active || user.role !== session.role || user.role === "viewer") {
      throw new Error("Forbidden: active editor access is required.");
    }

    const { data: trip, error: tripError } = await db
      .from("trips")
      .select("branch_id,closed,vehicle_id,trip_code")
      .eq("id", data.tripId)
      .maybeSingle();
    if (tripError || !trip) throw new Error("Trip is no longer open.");
    if (trip.closed === true)
      throw new Error("Closed trips are read-only. Reopen the trip before editing.");
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

    const { error } = await db.rpc("replace_trip_lines_atomic", {
      p_trip_id: data.tripId,
      p_income: data.income,
      p_expenses: data.expenses,
      p_approval: data.approval,
    });
    if (error) throw new Error(error.message);

    // Regular Toll Charges are informational for accounting, but they must
    // still reduce the live Fastag balance of the trip's vehicle. Replace the
    // trip-scoped deduction so edits and clearing the amount never duplicate it.
    const tollCharges = data.expenses
      .filter((row) => row.expense_name.trim().toLowerCase() === "toll charges")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const { error: deleteFastagError } = await db
      .from("fastag_transactions")
      .delete()
      .eq("trip_id", data.tripId)
      .eq("transaction_type", "deduction");
    if (deleteFastagError) throw new Error(deleteFastagError.message);
    if (trip.vehicle_id && tollCharges > 0) {
      const { error: insertFastagError } = await db.from("fastag_transactions").insert({
        vehicle_id: trip.vehicle_id,
        trip_id: data.tripId,
        transaction_type: "deduction",
        amount: Math.round(tollCharges * 100) / 100,
        transaction_date: new Date().toISOString().slice(0, 10),
        note: `Toll Charges (Trip ${trip.trip_code})`,
        trip_code: trip.trip_code,
      });
      if (insertFastagError) throw new Error(insertFastagError.message);
    }
  });

export const serverDeleteTrip = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string().min(1), tripId: z.string().uuid() }))
  .handler(async ({ data }): Promise<void> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const { data: user, error: userError } = await db
      .from("app_users")
      .select("id,role,is_active")
      .eq("id", session.uid)
      .maybeSingle();
    if (userError || !user?.is_active || user.role !== session.role || user.role !== "admin") {
      throw new Error("Only active administrators can delete trips.");
    }

    const { data: lockedTrip, error: lockedTripError } = await db
      .from("trips")
      .select("part_b_locked_at")
      .eq("id", data.tripId)
      .maybeSingle();
    if (lockedTripError) throw new Error(lockedTripError.message);
    if (!lockedTrip) throw new Error("Trip not found");
    if (lockedTrip.part_b_locked_at)
      throw new Error("This trip cannot be deleted because Part-B has been updated.");
    const { error: approvalError } = await db
      .from("approval_charge_advances")
      .delete()
      .eq("trip_id", data.tripId);
    if (approvalError) throw new Error(`Approval advance delete failed: ${approvalError.message}`);

    const { error: tripError } = await db.from("trips").delete().eq("id", data.tripId);
    if (tripError) throw new Error(`Trip delete failed: ${tripError.message}`);
  });

export const serverReopenMarkedTrip = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string().min(1), tripId: z.string().uuid() }))
  .handler(async ({ data }): Promise<void> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const { data: user, error: userError } = await db
      .from("app_users")
      .select("id,role,is_active")
      .eq("id", session.uid)
      .maybeSingle();
    if (userError || !user?.is_active || user.role !== session.role || user.role === "viewer") {
      throw new Error("Forbidden: active editor access is required.");
    }

    const { data: trip, error: tripError } = await db
      .from("trips")
      .select("id,branch_id,closed,posted_journal_entry_id")
      .eq("id", data.tripId)
      .maybeSingle();
    if (tripError) throw new Error(tripError.message);
    if (!trip) throw new Error("Trip not found");
    if (trip.posted_journal_entry_id) throw new Error("A posted trip cannot be reopened.");
    if (trip.closed !== true) throw new Error("Trip is already open.");

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

    const { error } = await db
      .from("trips")
      .update({ closed: false, reopened_at: new Date().toISOString() })
      .eq("id", data.tripId)
      .eq("closed", true)
      .is("posted_journal_entry_id", null);
    if (error) throw new Error(error.message);
  });

const billingLineSchema = z.object({
  name: z.string(),
  amount: z.string(),
  note: z.string(),
  payment_ledger_id: z.string().uuid().nullable(),
  advance: z.string().nullable().optional(),
});

export const serverPostTripBilling = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(1),
      tripId: z.string().uuid(),
      income: z.array(billingLineSchema),
      expenses: z.array(billingLineSchema),
      approval: z
        .object({
          trip_code: z.string(),
          rental_id: z.string().uuid().nullable(),
          advance: z.number(),
          balance: z.number(),
        })
        .nullable(),
    }),
  )
  .handler(async ({ data }): Promise<string> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const { data: user, error: userError } = await db
      .from("app_users")
      .select("id,role,is_active")
      .eq("id", session.uid)
      .maybeSingle();
    if (userError || !user?.is_active || user.role !== session.role || user.role === "viewer") {
      throw new Error("Forbidden: active editor access is required.");
    }

    const { data: trip, error: tripError } = await db
      .from("trips")
      .select("branch_id")
      .eq("id", data.tripId)
      .maybeSingle();
    if (tripError || !trip) throw new Error("Trip not found");
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

    const { data: entryId, error } = await db.rpc("post_trip_billing_atomic", {
      p_trip_id: data.tripId,
      p_income: data.income,
      p_expenses: data.expenses,
      p_approval: data.approval,
      p_posted_by: session.uid,
    });
    if (error || !entryId) throw new Error(error?.message ?? "Could not post trip billing");
    return String(entryId);
  });

export const serverSettleRentalBalance = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(1),
      advanceId: z.string().uuid(),
      paymentLedgerId: z.string().uuid(),
      amount: z.number().positive().optional(),
    }),
  )
  .handler(async ({ data }): Promise<string | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const { data: user, error: userError } = await db
      .from("app_users")
      .select("id,role,is_active")
      .eq("id", session.uid)
      .maybeSingle();
    if (userError || !user?.is_active || user.role !== session.role || user.role === "viewer") {
      throw new Error("Forbidden: active editor access is required.");
    }

    const { data: advance, error: advanceError } = await db
      .from("approval_charge_advances")
      .select("trip_id")
      .eq("id", data.advanceId)
      .maybeSingle();
    if (advanceError || !advance) throw new Error("Rental advance was not found");

    const { data: trip, error: tripError } = await db
      .from("trips")
      .select("branch_id")
      .eq("id", advance.trip_id)
      .maybeSingle();
    if (tripError || !trip) throw new Error("Live trip was not found");
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

    const { data: entryId, error } = await db.rpc("settle_rental_balance_atomic", {
      p_advance_id: data.advanceId,
      p_payment_ledger_id: data.paymentLedgerId,
      p_user_id: session.uid,
      p_amount: data.amount ?? null,
    });
    if (error) throw new Error(error.message);
    return entryId ? String(entryId) : null;
  });

export const serverRecordUnpostedRentalAdvancePayment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(1),
      advanceId: z.string().uuid(),
      amount: z.number().positive(),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const { data: user, error: userError } = await db
      .from("app_users")
      .select("id,role,is_active")
      .eq("id", session.uid)
      .maybeSingle();
    if (userError || !user?.is_active || user.role !== session.role || user.role === "viewer") {
      throw new Error("Forbidden: active editor access is required.");
    }

    const { data: advance, error: advanceError } = await db
      .from("approval_charge_advances")
      .select("trip_id")
      .eq("id", data.advanceId)
      .maybeSingle();
    if (advanceError || !advance) throw new Error("Rental advance was not found");

    const { data: trip, error: tripError } = await db
      .from("trips")
      .select("branch_id")
      .eq("id", advance.trip_id)
      .maybeSingle();
    if (tripError || !trip) throw new Error("Trip was not found");
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

    const { error } = await db.rpc("record_unposted_rental_advance_payment_atomic", {
      p_advance_id: data.advanceId,
      p_amount: data.amount,
      p_user_id: session.uid,
    });
    if (error) throw new Error(error.message);
  });
