import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { verifyAppToken } from "@/lib/user-auth";
import { downsampleRouteTrace, type DriverRoutePoint } from "@/lib/driver-route-utils";

const MAX_STORED_POINTS = 50_000;

export type { DriverRoutePoint } from "@/lib/driver-route-utils";
export type DriverRouteTrace = { points: DriverRoutePoint[]; totalStoredPoints: number; truncated: boolean };

async function requireTripTraceAccess(sessionToken: string, tripId: string) {
  const session = await verifyAppToken(sessionToken);
  if (!session) throw new Error("Your session has expired. Please sign in again.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: user, error: userError } = await db.from("app_users").select("role,is_active").eq("id", session.uid).maybeSingle();
  if (userError || !user?.is_active || user.role !== session.role) throw new Error("Forbidden: active user access is required.");
  const { data: trip, error: tripError } = await db.from("trips").select("id,branch_id").eq("id", tripId).maybeSingle();
  if (tripError || !trip) throw new Error("Trip was not found.");
  if (user.role === "basic") {
    const { data: accessRows, error: accessError } = await db.from("user_branch_access").select("branch_id").eq("user_id", session.uid);
    if (accessError || !accessRows?.some((row: { branch_id: string }) => row.branch_id === trip.branch_id)) throw new Error("Forbidden: your account does not have access to this trip.");
  }
  return db;
}

export const serverGetDriverTripLocationTrace = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string().min(1), tripId: z.string().uuid() }))
  .handler(async ({ data }): Promise<DriverRouteTrace> => {
    const db = await requireTripTraceAccess(data.sessionToken, data.tripId);
    const [{ count, error: countError }, { data: locationRows, error: locationError }] = await Promise.all([
      db.from("driver_gps_locations").select("id", { count: "exact", head: true }).eq("trip_id", data.tripId),
      db.from("driver_gps_locations").select("latitude,longitude,accuracy_m,recorded_at").eq("trip_id", data.tripId).order("recorded_at", { ascending: false }).limit(MAX_STORED_POINTS),
    ]);
    if (countError) throw new Error(`Could not count GPS points: ${countError.message}`);
    if (locationError) throw new Error(`Could not load GPS points: ${locationError.message}`);
    const storedPoints = (locationRows ?? []).map((row: { latitude: unknown; longitude: unknown; accuracy_m: unknown; recorded_at: unknown }) => ({ latitude: Number(row.latitude), longitude: Number(row.longitude), accuracyM: row.accuracy_m == null ? null : Number(row.accuracy_m), recordedAt: String(row.recorded_at) })).filter((point: DriverRoutePoint) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)).reverse();
    return { points: downsampleRouteTrace(storedPoints), totalStoredPoints: count ?? storedPoints.length, truncated: (count ?? 0) > MAX_STORED_POINTS };
  });
