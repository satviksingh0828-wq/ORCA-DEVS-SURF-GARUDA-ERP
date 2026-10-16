/* eslint-disable @typescript-eslint/no-explicit-any -- newer LTMS billing tables are not yet in generated Supabase types. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// Some LTMS billing tables were introduced after the generated database types.
const db = supabase as any;
type Branch = { id: string; branch_name: string };
type Metric = { key: string; label: string; value: number; description: string };
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
const n = (value: unknown) => Number(value ?? 0) || 0;
const monthRange = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return { from: `${value}-01`, to: new Date(year, month, 0).toISOString().slice(0, 10) };
};
const monthNow = () => new Date().toISOString().slice(0, 7);

export function LtmsDashboard() {
  const [month, setMonth] = useState(monthNow);
  const [branchId, setBranchId] = useState("all");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [system, setSystem] = useState<Metric[]>([]);
  const [posted, setPosted] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = monthRange(month);
      const branchQuery = db.from("branches").select("id,branch_name").order("branch_name");
      const branchResult = await branchQuery;
      if (branchResult.error) throw branchResult.error;
      setBranches(branchResult.data ?? []);
      const applyBranch = (query: any) =>
        branchId === "all" ? query : query.eq("branch_id", branchId);
      const [sourceResult, transporterResult, workmenResult, receiptResult, tripResult] =
        await Promise.all([
          applyBranch(
            db
              .from("ltms_source_bills")
              .select("branch_id,bill_date,total_freight,total_loading,journal_entry_id,deleted_at")
              .gte("bill_date", from)
              .lte("bill_date", to)
              .is("deleted_at", null),
          ),
          applyBranch(
            db
              .from("ltms_transporter_bills")
              .select(
                "branch_id,system_date,total_freight,total_loading,journal_entry_id,deleted_at",
              )
              .gte("system_date", from)
              .lte("system_date", to)
              .is("deleted_at", null),
          ),
          applyBranch(
            db
              .from("workmen_bills")
              .select("branch_id,bill_date,grand_total,journal_entry_id")
              .gte("bill_date", from)
              .lte("bill_date", to),
          ),
          applyBranch(
            db
              .from("stock_inward_receipts")
              .select(
                "branch_id,receipt_date,unloading_amount_received,unloading_received_journal_entry_id",
              )
              .gte("receipt_date", from)
              .lte("receipt_date", to),
          ),
          applyBranch(
            db
              .from("trips")
              .select("id,branch_id,start_date,posted_journal_entry_id")
              .gte("start_date", from)
              .lte("start_date", to),
          ),
        ]);
      for (const result of [
        sourceResult,
        transporterResult,
        workmenResult,
        receiptResult,
        tripResult,
      ])
        if (result.error) throw result.error;
      const trips = tripResult.data ?? [];
      const tripIds = trips.map((trip: any) => trip.id);
      const [expenses, otherIncome] = await Promise.all([
        tripIds.length
          ? db.from("trip_expenses").select("trip_id,amount").in("trip_id", tripIds)
          : Promise.resolve({ data: [], error: null }),
        tripIds.length
          ? db.from("trip_other_income").select("trip_id,amount").in("trip_id", tripIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (expenses.error) throw expenses.error;
      if (otherIncome.error) throw otherIncome.error;
      const tripAdj = new Map<string, number>();
      for (const row of expenses.data ?? [])
        tripAdj.set(row.trip_id, (tripAdj.get(row.trip_id) ?? 0) + n(row.amount));
      for (const row of otherIncome.data ?? [])
        tripAdj.set(row.trip_id, (tripAdj.get(row.trip_id) ?? 0) - n(row.amount));
      const tripValue = (trip: any) => tripAdj.get(trip.id) ?? 0;
      const sources = sourceResult.data ?? [];
      const transporters = transporterResult.data ?? [];
      const workmen = workmenResult.data ?? [];
      const receipts = receiptResult.data ?? [];
      const calc = (
        rows: any[],
        amount: (row: any) => number,
        isPosted: (row: any) => boolean,
      ) => ({
        all: rows.reduce((sum, row) => sum + amount(row), 0),
        posted: rows.filter(isPosted).reduce((sum, row) => sum + amount(row), 0),
      });
      const source = calc(
        sources,
        (row) => n(row.total_freight) + n(row.total_loading),
        (row) => Boolean(row.journal_entry_id),
      );
      const transporter = calc(
        transporters,
        (row) => n(row.total_freight) + n(row.total_loading),
        (row) => Boolean(row.journal_entry_id),
      );
      const loading = calc(
        workmen,
        (row) => n(row.grand_total),
        (row) => Boolean(row.journal_entry_id),
      );
      const unloading = calc(
        receipts,
        (row) => n(row.unloading_amount_received),
        (row) => Boolean(row.unloading_received_journal_entry_id),
      );
      const trip = calc(trips, tripValue, (row) => Boolean(row.posted_journal_entry_id));
      const systemValues = [
        trip.all,
        loading.all,
        transporter.all,
        unloading.all,
        source.all,
        source.all + unloading.all - trip.all - loading.all - transporter.all,
      ];
      const postedValues = [
        trip.posted,
        loading.posted,
        transporter.posted,
        unloading.posted,
        source.posted,
        source.posted + unloading.posted - trip.posted - loading.posted - transporter.posted,
      ];
      const labels = [
        "Trip Expenditure",
        "Workmen Charges",
        "Transporter Expenditure",
        "Unloading Income",
        "Consignment Income",
        "Consignment Net",
      ];
      setSystem(
        labels.map((label, index) => ({
          key: label,
          label,
          value: systemValues[index],
          description: "All matching records in LTMS",
        })),
      );
      setPosted(
        labels.map((label, index) => ({
          key: label,
          label,
          value: postedValues[index],
          description: "Only records with a posted journal entry",
        })),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load LTMS dashboard");
    } finally {
      setLoading(false);
    }
  }, [branchId, month]);
  useEffect(() => {
    void load();
  }, [load]);
  const monthLabel = useMemo(
    () =>
      new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
      }),
    [month],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Period
            <input
              aria-label="Dashboard period"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Branch
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <span className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-4" />
            {monthLabel}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <MetricGroup
          title="IN SYSTEM"
          subtitle="Includes records whether or not their journal entry has been posted"
          metrics={system}
          loading={loading}
        />
        <MetricGroup
          title="IN SYSTEM AND POSTED"
          subtitle="Includes only records with a linked posted journal entry"
          metrics={posted}
          loading={loading}
        />
      </div>
    </div>
  );
}
function MetricGroup({
  title,
  subtitle,
  metrics,
  loading,
}: {
  title: string;
  subtitle: string;
  metrics: Metric[];
  loading: boolean;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-4 border-b pb-3">
        <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <article key={metric.key} className="min-w-0 rounded-lg border bg-background p-3">
            <p className="min-h-9 text-xs font-medium text-muted-foreground">{metric.label}</p>
            <p
              className="mt-2 truncate text-lg font-semibold tabular-nums"
              title={money(metric.value)}
            >
              {loading ? "Loading…" : money(metric.value)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{metric.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
