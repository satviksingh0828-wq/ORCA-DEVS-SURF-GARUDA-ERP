import { useEffect, useState, useMemo } from "react";
import { Building2, Plus, Search, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { serverDeleteTrip } from "@/lib/trip-actions";
import { fetchAll } from "@/lib/fetch-all";
import { logAction } from "@/lib/log-actions";
import { ItemLogsButton } from "@/components/shared/ItemLogsDrawer";
import { TripForm, emptyTrip, type TripRow } from "./TripForm";
import { DriverTripActions } from "./DriverTripActions";

type BranchOption = { id: string; name: string };

export function Trips({
  onSidebarVisibilityChange,
}: { onSidebarVisibilityChange?: (visible: boolean) => void } = {}) {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TripRow | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [branches, setBranches] = useState<BranchOption[]>([]);

  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const isBasic = user?.role === "basic";
  const isViewer = user?.role === "viewer";
  useEffect(() => {
    onSidebarVisibilityChange?.(!editing);
  }, [editing, onSidebarVisibilityChange]);
  const allowedBranchIds = user?.role === "basic" ? (user?.branchIds ?? []) : null;

  async function load() {
    setLoading(true);
    try {
      // Basic user with no branches: show nothing
      if (allowedBranchIds !== null && allowedBranchIds.length === 0) {
        setTrips([]);
        setLoading(false);
        return;
      }

      const live = await fetchAll<TripRow>(() => {
        let q = supabase.from("trips").select("*").order("created_at", { ascending: false });
        if (allowedBranchIds !== null) q = q.in("branch_id", allowedBranchIds) as typeof q;
        return q;
      });
      setTrips(live);
    } catch {
      toast.error("Could not load trips");
    }
    setLoading(false);
  }

  // Fetch available branches for the filter (admin/viewer sees all; basic users see their allowed branches)
  useEffect(() => {
    async function loadBranches() {
      let q = supabase.from("branches").select("id,branch_name").order("branch_name");
      if (allowedBranchIds !== null && allowedBranchIds.length > 0) {
        q = q.in("id", allowedBranchIds) as typeof q;
      }
      const { data } = await q;
      if (data) {
        setBranches(
          (data as { id: string; branch_name: string }[]).map((b) => ({
            id: b.id,
            name: b.branch_name,
          })),
        );
      }
    }
    loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function remove(trip: TripRow) {
    if (!window.confirm("Delete this trip? This cannot be undone.")) return;
    try {
      if (!user?.sessionToken)
        throw new Error(
          "Your session has expired. Please sign in again before deleting this trip.",
        );
      await serverDeleteTrip({ data: { sessionToken: user.sessionToken, tripId: trip.id! } });
    } catch (err) {
      return toast.error(err instanceof Error ? err.message : "Could not delete trip");
    }
    logAction("deleted", "trip", { entityId: trip.id, entityLabel: trip.trip_code });
    toast.success("Trip removed");
    load();
  }

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const matchesTripSearch = (
    id: string | null | undefined,
    tripCode: string | null | undefined,
  ) => {
    if (!normalizedSearch) return true;
    return [id, tripCode].some((value) => (value ?? "").toLowerCase().includes(normalizedSearch));
  };

  const visibleTrips = useMemo(
    () =>
      trips.filter(
        (t) =>
          matchesTripSearch(t.id, t.trip_code) &&
          (branchFilter === "all" || t.branch_id === branchFilter),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trips, normalizedSearch, branchFilter],
  );
  // ── Inline detail views (replace the list) ────────────────────────────────

  if (editing)
    return (
      <TripForm
        initial={editing}
        onBack={() => {
          setEditing(null);
          load();
        }}
        onSaved={load}
      />
    );

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!isViewer ? (
          <Button
            size="sm"
            className="w-fit"
            onClick={() => {
              const t = emptyTrip();
              // Auto-fill branch when user has exactly one allowed branch
              if (allowedBranchIds?.length === 1) t.branch_id = allowedBranchIds[0];
              setEditing(t);
            }}
          >
            <Plus className="size-4" />
            New trip
          </Button>
        ) : null}
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search trip ID or code"
            className="pl-9"
            aria-label="Search trips by trip ID or code"
          />
        </div>
        {/* Branch filter — shown when there are multiple branches available */}
        {branches.length > 1 && (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="h-9 w-44">
              <Building2 className="mr-1.5 size-3.5 text-muted-foreground" />
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visibleTrips.length === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          {isBasic && allowedBranchIds?.length === 0
            ? "No branches assigned to your account. Contact your administrator."
            : normalizedSearch
              ? "No live trips match your search."
              : "No trips yet. Create a trip to record manifests, income and expenses."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleTrips.map((t) => (
            <li
              key={t.id}
              className="surface-card flex flex-wrap items-center gap-3 p-4 transition-colors hover:bg-muted/40"
            >
              <Truck className="size-4 shrink-0 text-primary" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setEditing(t)}
              >
                <span className="block text-sm font-medium">{t.trip_code}</span>
                <span className="block text-xs text-muted-foreground">
                  {[t.ownership === "own" ? "Own vehicle" : "Rented", t.start_date, t.start_time]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
              {/* Admin-only: per-row logs */}
              {isAdmin && t.id ? (
                <ItemLogsButton entityType="trip" entityId={t.id} entityLabel={t.trip_code} />
              ) : null}
              {t.part_b_locked_at ? (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                  Part-B locked
                </span>
              ) : null}
              <DriverTripActions trip={t} />
              {!isViewer && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(t)}
                  disabled={Boolean(t.part_b_locked_at)}
                  title={
                    t.part_b_locked_at
                      ? "Trip cannot be deleted after Part-B update"
                      : "Delete trip"
                  }
                  aria-label="Delete trip"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
