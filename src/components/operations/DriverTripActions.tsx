import { useState } from "react";
import { AlertTriangle, Loader2, Map, MapPin, Play, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TripRow } from "./TripForm";
import { DriverRouteMap } from "./DriverRouteMap";
import { serverGetDriverTripLocationTrace, type DriverRouteTrace } from "@/lib/driver-location-trace";
import { useSession } from "@/lib/session";

type LiveLocation = { latitude?: number; longitude?: number; accuracy_m?: number | null; recorded_at?: string; active?: boolean } | null;
type TrackingConflict = { tripId: string; tripCode: string };
const TRACKING_ENDPOINT = (import.meta.env.VITE_DRIVER_TRACKING_ENDPOINT as string | undefined) || "/gps/api";

function formatTime(value?: string) {
  if (!value) return "No location received yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function DriverTripActions({ trip }: { trip: TripRow }) {
  const [locationOpen, setLocationOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [location, setLocation] = useState<LiveLocation>(null);
  const [routeTrace, setRouteTrace] = useState<DriverRouteTrace | null>(null);
  const [trackingConflict, setTrackingConflict] = useState<TrackingConflict | null>(null);
  const { user } = useSession();
  const ownTrip = trip.ownership === "own" && Boolean(trip.id);
  const closed = trip.closed === true;

  async function loadLocation() {
    if (!ownTrip || !trip.id) return;
    setLoading(true);
    try {
      const { data: latest, error: latestError } = await supabase.from("driver_gps_locations" as never).select("latitude,longitude,accuracy_m,recorded_at").eq("trip_id", trip.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
      if (latestError) throw latestError;
      const { data: status, error: statusError } = await supabase.rpc("get_driver_gps_tracking_status" as never, { p_trip_id: trip.id } as never);
      if (statusError) throw statusError;
      const row = latest as { latitude?: number; longitude?: number; accuracy_m?: number | null; recorded_at?: string } | null;
      const active = Boolean((status as { active?: boolean } | null)?.active);
      setRecording(active);
      setLocation(row ? { ...row, active } : null);
      if (user?.sessionToken) setRouteTrace(await serverGetDriverTripLocationTrace({ data: { sessionToken: user.sessionToken, tripId: trip.id } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load GPS tracking");
    } finally { setLoading(false); }
  }

  async function setRecordingState(next: "start" | "stop", endExisting = false) {
    if (!trip.id) return;
    setLoading(true);
    try {
      if (next === "start") {
        const { data, error } = await supabase.rpc("start_driver_gps_tracking" as never, { p_trip_id: trip.id, p_end_existing: endExisting } as never);
        if (error) throw error;
        const result = data as { ok?: boolean; conflict?: boolean; active_trip_id?: string; active_trip_code?: string } | null;
        if (result?.conflict && result.active_trip_id && result.active_trip_code) {
          setTrackingConflict({ tripId: result.active_trip_id, tripCode: result.active_trip_code });
          return;
        }
      } else {
        const { error } = await supabase.rpc("stop_driver_gps_tracking" as never, { p_trip_id: trip.id } as never);
        if (error) throw error;
      }
      setRecording(next === "start");
      toast.success(next === "start" ? "GPS recording started" : "GPS recording stopped");
      await loadLocation();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not change GPS recording state"); }
    finally { setLoading(false); }
  }

  if (!ownTrip) return null;
  return <>
    <div className="flex items-center gap-1">
      {!closed ? <Button variant="ghost" size="sm" onClick={() => void setRecordingState(recording ? "stop" : "start")} disabled={loading} title={recording ? "Stop GPS recording" : "Start GPS recording"} aria-label={`${recording ? "Stop" : "Start"} GPS recording for ${trip.trip_code}`}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : recording ? <Square className="size-4 text-destructive" /> : <Play className="size-4 text-emerald-600" />}
      </Button> : null}
      <Button variant="ghost" size="sm" onClick={() => { setLocationOpen(true); void loadLocation(); }} title="View GPS route" aria-label={`View GPS route for ${trip.trip_code}`}><MapPin className="size-4" /></Button>
    </div>
    <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100dvw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:w-full">
        <DialogHeader className="shrink-0 px-5 pb-3 pt-6 pr-12 sm:px-7 sm:pt-7">
          <DialogTitle className="flex items-center gap-2"><MapPin className="size-5 text-primary" /> Driver GPS tracking</DialogTitle>
          <DialogDescription>{closed ? "Closed trip history is read-only; its recorded GPS route remains available." : "Start recording before the driver app sends points. Points sent without an assigned driver and active recording session are not saved."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-5 sm:px-7 sm:pb-7">
          {loading ? <div className="flex min-h-52 items-center justify-center gap-2 rounded-2xl bg-muted/50 p-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading GPS data…</div> : routeTrace?.points.length ? <DriverRouteMap points={routeTrace.points} tripCode={trip.trip_code} totalStoredPoints={routeTrace.totalStoredPoints} /> : location?.latitude != null && location.longitude != null ? <div className="overflow-hidden rounded-2xl border border-border bg-muted/30 p-1.5"><iframe title={`GPS map for trip ${trip.trip_code}`} className="h-72 w-full rounded-xl border-0 bg-muted" loading="lazy" src={`https://www.openstreetmap.org/export/embed.html?bbox=${location.longitude - .01}%2C${location.latitude - .01}%2C${location.longitude + .01}%2C${location.latitude + .01}&layer=mapnik&marker=${location.latitude}%2C${location.longitude}`} /></div> : <div className="flex min-h-52 items-center justify-center rounded-2xl bg-muted/50 p-8 text-center text-sm text-muted-foreground">No GPS location has been saved for this trip yet.</div>}
          {location ? <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm"><p className="font-medium">{location.active ? "Recording active" : "Recording stopped"}</p><p className="mt-1 text-muted-foreground">Last GPS update: {formatTime(location.recorded_at)}</p><p className="mt-2 break-all font-mono text-xs">{location.latitude?.toFixed(6)}, {location.longitude?.toFixed(6)}</p></div> : null}
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm"><p className="font-medium">Driver app endpoint</p><p className="mt-1 break-all font-mono text-xs">{TRACKING_ENDPOINT}</p><p className="mt-2 text-muted-foreground">Use the Driver Master Tracking App ID and Tracking App Password with Basic Auth. Send GPS points by POST; only the assigned driver’s active trip recording is accepted.</p></div>
          <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => void loadLocation()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>{!closed ? <Button className="flex-1" onClick={() => void setRecordingState(recording ? "stop" : "start")} disabled={loading}>{recording ? <><Square className="size-4" /> Stop recording</> : <><Play className="size-4" /> Start recording</>}</Button> : null}</div>
          {location?.latitude != null && location.longitude != null ? <a className="flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-medium text-primary hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`} target="_blank" rel="noreferrer"><Map className="size-3.5" /> Open in Google Maps</a> : null}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(trackingConflict)} onOpenChange={(open) => { if (!open) setTrackingConflict(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" /> Driver already recording</DialogTitle>
          <DialogDescription>
            This driver’s GPS location is currently being recorded for trip <strong>{trackingConflict?.tripCode}</strong>. Do you want to end that recording and start it for trip <strong>{trip.trip_code}</strong>?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setTrackingConflict(null)}>Keep existing trip</Button>
          <Button onClick={() => { setTrackingConflict(null); void setRecordingState("start", true); }}>End existing &amp; start here</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
