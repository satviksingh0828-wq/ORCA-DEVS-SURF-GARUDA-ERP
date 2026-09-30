import { createFileRoute } from "@tanstack/react-router";

type Point = {
  latitude?: unknown;
  longitude?: unknown;
  lat?: unknown;
  lon?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  acc?: unknown;
  recorded_at?: unknown;
  tst?: unknown;
};

type RequestBody = Point & { locations?: unknown[] };

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private, max-age=0",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function credentials(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { id: decoded.slice(0, separator).trim(), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function point(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Point;
  const latitude = number(item.latitude ?? item.lat);
  const longitude = number(item.longitude ?? item.lon ?? item.lng);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const accuracy = number(item.accuracy ?? item.acc);
  const rawRecordedAt = item.recorded_at ?? item.tst;
  const recordedAt = typeof rawRecordedAt === "number"
    ? new Date(rawRecordedAt < 10_000_000_000 ? rawRecordedAt * 1000 : rawRecordedAt).toISOString()
    : typeof rawRecordedAt === "string" && !Number.isNaN(new Date(rawRecordedAt).getTime())
      ? new Date(rawRecordedAt).toISOString()
      : new Date().toISOString();
  return { latitude, longitude, accuracy, recorded_at: recordedAt };
}

export const Route = createFileRoute("/gps/api")({
  server: {
    handlers: {
      OPTIONS: async () => response({}, 204),
      POST: async ({ request }) => {
        const auth = credentials(request);
        if (!auth) return response({ error: "Tracking app ID and password are required" }, 401);
        let body: RequestBody;
        try {
          body = await request.json() as RequestBody;
        } catch {
          return response({ error: "Request body must be valid JSON" }, 400);
        }
        const rawPoints = body && Array.isArray(body.locations) ? body.locations.slice(0, 250) : [body];
        const points = rawPoints.map(point).filter((item): item is NonNullable<ReturnType<typeof point>> => Boolean(item));
        if (!points.length) return response({ error: "No valid GPS points supplied" }, 400);
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;
          const { data: driverId, error: authError } = await db.rpc("authenticate_driver_tracking_app", {
            p_tracking_app_id: auth.id,
            p_tracking_app_password: auth.password,
          });
          if (authError) throw authError;
          if (!driverId) return response({ error: "Invalid tracking app credentials" }, 401);
          const { data: session, error: sessionError } = await db
            .from("driver_gps_tracking_sessions")
            .select("id,trip_id,driver_id")
            .eq("driver_id", driverId)
            .is("ended_at", null)
            .maybeSingle();
          if (sessionError) throw sessionError;
          if (!session) return response({ accepted: 0, saved: false, reason: "Driver is not assigned to an actively recorded trip" }, 202);
          const { data: trip, error: tripError } = await db
            .from("trips")
            .select("id,driver_id,closed,ownership")
            .eq("id", session.trip_id)
            .maybeSingle();
          if (tripError) throw tripError;
          if (!trip || trip.driver_id !== driverId || trip.closed || trip.ownership !== "own") {
            return response({ accepted: 0, saved: false, reason: "Driver has no eligible assigned trip" }, 202);
          }
          const { error: insertError } = await db.from("driver_gps_locations").insert(points.map((item) => ({
            session_id: session.id,
            trip_id: session.trip_id,
            driver_id: driverId,
            latitude: item.latitude,
            longitude: item.longitude,
            accuracy_m: item.accuracy,
            recorded_at: item.recorded_at,
          })));
          if (insertError) throw insertError;
          return response({ accepted: points.length, saved: true, trip_id: session.trip_id });
        } catch (error) {
          console.error("GPS ingestion failed", error instanceof Error ? error.name : "unknown");
          return response({ error: "GPS service unavailable" }, 503);
        }
      },
    },
  },
});
