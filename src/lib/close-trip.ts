import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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

    const { data: updated, error } = await db
      .from("trips")
      .update({ closed: true })
      .eq("id", data.tripId)
      .eq("closed", false)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Could not close trip: ${error.message}`);
    if (!updated) throw new Error("Trip is already closed or no longer available.");
    return String(updated.id);
  });
