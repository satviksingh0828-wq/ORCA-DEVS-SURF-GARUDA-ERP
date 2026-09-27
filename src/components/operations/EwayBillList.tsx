import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, FileSearch, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { serverFetchEwayBills } from "@/lib/ewaybill-fetch";

type Snapshot = {
  id: string;
  branch_id: string;
  snapshot_date: string;
  ewb_number: string;
  invoice_number: string | null;
  total_invoice_value: number | null;
  generated_by: string | null;
  destination: string | null;
  valid_until: string | null;
  status: string | null;
  fetched_at: string;
};

function indiaYesterday(): string {
  const now = new Date();
  const india = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  india.setDate(india.getDate() - 1);
  return `${india.getFullYear()}-${String(india.getMonth() + 1).padStart(2, "0")}-${String(india.getDate()).padStart(2, "0")}`;
}

export function EwayBillList() {
  const { user } = useSession();
  const branches = useBranches();
  const allowed = user?.role === "basic" ? (user.branchIds ?? []) : null;
  const [branchId, setBranchId] = useState("all");
  const [snapshotDate, setSnapshotDate] = useState(indiaYesterday());
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [shipmentNumbers, setShipmentNumbers] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const db = supabase as any;
  const visibleBranches = useMemo(
    () => (allowed === null ? branches : branches.filter((branch) => allowed.includes(branch.id))),
    [allowed, branches],
  );

  async function load() {
    setLoading(true);
    try {
      const branchIds =
        branchId === "all" ? visibleBranches.map((branch) => branch.id) : [branchId];
      if (!branchIds.length) {
        setRows([]);
        setLoading(false);
        return;
      }
      const [{ data, error }, { data: shipments, error: shipmentError }, { data: runs }] =
        await Promise.all([
          db
            .from("eway_bill_daily_snapshots")
            .select(
              "id,branch_id,snapshot_date,ewb_number,invoice_number,total_invoice_value,generated_by,destination,valid_until,status,fetched_at",
            )
            .eq("snapshot_date", snapshotDate)
            .in("branch_id", branchIds)
            .order("ewb_number"),
          db.from("shipments").select("branch_id,eway_bill_number").in("branch_id", branchIds),
          db
            .from("eway_bill_fetch_runs")
            .select("fetched_at,status")
            .eq("snapshot_date", snapshotDate)
            .in("branch_id", branchIds)
            .eq("status", "completed")
            .order("fetched_at", { ascending: false })
            .limit(1),
        ]);
      if (error || shipmentError) throw error ?? shipmentError;
      setRows((data ?? []) as Snapshot[]);
      setShipmentNumbers(
        new Set(
          ((shipments ?? []) as Array<{ eway_bill_number: string }>).map(
            (shipment) => shipment.eway_bill_number,
          ),
        ),
      );
      setFetchedAt((runs?.[0] as { fetched_at?: string } | undefined)?.fetched_at ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load saved E-Way Bills");
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [branchId, snapshotDate, visibleBranches.length]);

  async function fetchForDate() {
    if (!user?.sessionToken) return toast.error("Your session has expired. Please sign in again.");
    if (fetchedAt) return toast.error("E-Way Bills were already fetched for this date.");
    setFetching(true);
    try {
      const result = await serverFetchEwayBills({
        data: {
          sessionToken: user.sessionToken,
          snapshotDate,
          branchId: branchId === "all" ? null : branchId,
        },
      });
      const failed = result.branches.filter((branch) => branch.failed);
      if (failed.length) toast.error(String(failed[0].error ?? "Could not fetch E-Way Bills"));
      else toast.success(`E-Way Bills fetched for ${snapshotDate}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not fetch E-Way Bills");
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Saved date</label>
          <Input
            type="date"
            value={snapshotDate}
            onChange={(event) => setSnapshotDate(event.target.value)}
          />
        </div>
        <div className="min-w-56 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Branch</label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All permitted branches</SelectItem>
              {visibleBranches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void load()}
          disabled={loading || fetching}
        >
          <CalendarDays className="mr-2 size-4" />
          {loading ? "Loading…" : "Reload saved data"}
        </Button>
        <Button
          type="button"
          onClick={() => void fetchForDate()}
          disabled={loading || fetching || Boolean(fetchedAt)}
        >
          {fetching ? "Fetching…" : fetchedAt ? "Already fetched" : "Fetch for this date"}
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          Saved snapshots only. No PeriOne API call is made here.
          {fetchedAt
            ? ` Last fetched ${new Date(fetchedAt).toLocaleString("en-IN")}.`
            : " No completed fetch found for this date."}
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">EWB No.</th>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Total Invoice Value</th>
              <th className="px-4 py-3">Generated By</th>
              <th className="px-4 py-3">Destination</th>
              <th className="px-4 py-3">Valid Until</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Shipment</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <FileSearch className="mx-auto mb-2 size-8 opacity-50" />
                  No saved E-Way Bill data for {snapshotDate}.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const made = shipmentNumbers.has(row.ewb_number);
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3 font-semibold">{row.ewb_number}</td>
                    <td className="px-4 py-3">{row.invoice_number || "—"}</td>
                    <td className="px-4 py-3">
                      {row.total_invoice_value == null
                        ? "—"
                        : `₹${Number(row.total_invoice_value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </td>
                    <td className="px-4 py-3">{row.generated_by || "—"}</td>
                    <td className="px-4 py-3">{row.destination || "—"}</td>
                    <td className="px-4 py-3">{row.valid_until || "—"}</td>
                    <td className="px-4 py-3">{row.status || "—"}</td>
                    <td className="px-4 py-3">
                      {made ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="size-4" /> Made
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <XCircle className="size-4" /> Not made
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
