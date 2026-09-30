import { useEffect, useMemo, useState } from "react";
import { Eye, ReceiptText, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { inr, num } from "@/lib/trip-calc";
import { useBranches } from "@/lib/use-branches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DetailRow = Record<string, unknown>;
type BillingTrip = {
  id: string;
  trip_code: string;
  branch_id: string | null;
  branch_name: string | null;
  start_date: string | null;
  end_date: string | null;
  closed_at: string;
  total_income: number;
  total_expense: number;
  net_income: number;
  snapshot: Record<string, unknown>;
};

function snapshotTotals(snapshot: Record<string, unknown>) {
  const totals = (snapshot.totals ?? {}) as Record<string, unknown>;
  return {
    income: num(totals.total_income),
    expense: num(totals.total_expense),
    net: num(totals.net_income),
  };
}

function toBillingTrip(row: Record<string, unknown>): BillingTrip {
  const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
  const fallback = snapshotTotals(snapshot);
  const income = row.total_income == null ? fallback.income : num(row.total_income);
  const expense = row.total_expense == null ? fallback.expense : num(row.total_expense);
  return {
    id: String(row.id),
    trip_code: String(row.trip_code ?? "—"),
    branch_id: (row.branch_id as string | null) ?? null,
    branch_name: (row.branch_name as string | null) ?? null,
    start_date: (row.start_date as string | null) ?? null,
    end_date: (row.end_date as string | null) ?? null,
    closed_at: String(row.closed_at ?? ""),
    total_income: income,
    total_expense: expense,
    net_income: row.net_income == null ? income - expense : num(row.net_income),
    snapshot,
  };
}

function currentMonthRange() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`,
  };
}

export function TripBilling() {
  const branches = useBranches();
  const defaults = currentMonthRange();
  const [rows, setRows] = useState<BillingTrip[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BillingTrip | null>(null);
  const [branchId, setBranchId] = useState("all");
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);

  async function load() {
    setLoading(true);
    try {
      // The generated Supabase types predate the `closed` column migration.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let activeQuery = (supabase as any)
        .from("trips")
        .select(
          "id,trip_code,branch_id,start_date,end_date,updated_at,branch:branches(branch_name)",
        )
        .eq("closed", true)
        .gte("end_date", fromDate)
        .lte("end_date", toDate)
        .order("end_date", { ascending: false });
      if (branchId !== "all") activeQuery = activeQuery.eq("branch_id", branchId);

      const active = await fetchAll<Record<string, unknown>>(() => activeQuery);

      const activeIds = active.map((row) => String(row.id));
      const [activeIncome, activeExpenses] = await Promise.all([
        activeIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as any)
                .from("trip_other_income")
                .select("id,trip_id,income_name,amount,note")
                .in("trip_id", activeIds),
            )
          : Promise.resolve([]),
        activeIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as any)
                .from("trip_expenses")
                .select("id,trip_id,expense_name,amount,note")
                .in("trip_id", activeIds),
            )
          : Promise.resolve([]),
      ]);
      const incomeByTrip = new Map<string, Record<string, unknown>[]>();
      const expensesByTrip = new Map<string, Record<string, unknown>[]>();
      for (const row of activeIncome) {
        const key = String(row.trip_id);
        incomeByTrip.set(key, [...(incomeByTrip.get(key) ?? []), row]);
      }
      for (const row of activeExpenses) {
        const key = String(row.trip_id);
        expensesByTrip.set(key, [...(expensesByTrip.get(key) ?? []), row]);
      }
      const activeBilling = active.map((row) => {
        const id = String(row.id);
        const income = incomeByTrip.get(id) ?? [];
        const expenses = expensesByTrip.get(id) ?? [];
        const totalIncome = income.reduce((sum, item) => sum + num(item.amount), 0);
        const totalExpense = expenses.reduce((sum, item) => sum + num(item.amount), 0);
        const branch = row.branch as Record<string, unknown> | null;
        return toBillingTrip({
          id: `active-${id}`,
          trip_code: row.trip_code,
          branch_id: row.branch_id,
          branch_name: branch?.branch_name ?? null,
          start_date: row.start_date,
          end_date: row.end_date,
          closed_at: row.updated_at,
          total_income: totalIncome,
          total_expense: totalExpense,
          net_income: totalIncome - totalExpense,
          snapshot: { other_income: income, expenses },
        });
      });
      setRows(
        activeBilling.sort((a, b) =>
          String(b.end_date ?? b.closed_at).localeCompare(String(a.end_date ?? a.closed_at)),
        ),
      );
    } catch (error) {
      toast.error(
        `Could not load trip billing: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // `load` intentionally follows the filter values rather than being memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, fromDate, toDate]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.trip_code, row.branch_name, row.start_date, row.end_date]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rows, search]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (result, row) => ({
          income: result.income + row.total_income,
          expense: result.expense + row.total_expense,
          net: result.net + row.net_income,
        }),
        { income: 0, expense: 0, net: 0 },
      ),
    [visible],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search trip or branch…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="h-9 w-full sm:w-52">
            <SelectValue placeholder="All Branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.branch_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="From date"
          className="h-9 w-full sm:w-40"
          type="date"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
        <Input
          aria-label="To date"
          className="h-9 w-full sm:w-40"
          type="date"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />
        <Button
          className="ml-auto h-9"
          variant="ghost"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="px-4 py-3 text-left">Trip</th>
              <th className="px-4 py-3 text-left">Branch</th>
              <th className="px-4 py-3 text-left">Closed Date</th>
              <th className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                Total Income
              </th>
              <th className="px-4 py-3 text-right text-red-700 dark:text-red-400">
                Total Expenditure
              </th>
              <th className="px-4 py-3 text-right">Net Income / Expenditure</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  {loading ? "Loading closed trips…" : "No closed trips found."}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{row.trip_code}</td>
                  <td className="px-4 py-3">{row.branch_name || "—"}</td>
                  <td className="px-4 py-3">{row.end_date || row.start_date || "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-700 dark:text-emerald-400">
                    {inr(row.total_income)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-red-700 dark:text-red-400">
                    {inr(row.total_expense)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${row.net_income >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
                  >
                    {inr(row.net_income)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Button variant="outline" size="sm" onClick={() => setSelected(row)}>
                      <Eye className="mr-1.5 size-3.5" />
                      View
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="px-4 py-3" colSpan={3}>
                  Total ({visible.length} trips)
                </td>
                <td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                  {inr(totals.income)}
                </td>
                <td className="px-4 py-3 text-right text-red-700 dark:text-red-400">
                  {inr(totals.expense)}
                </td>
                <td
                  className={`px-4 py-3 text-right ${totals.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
                >
                  {inr(totals.net)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <BillingDetailsDialog trip={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BillingDetailsDialog({
  trip,
  onClose,
}: {
  trip: BillingTrip | null;
  onClose: () => void;
}) {
  const snapshot = trip?.snapshot ?? {};
  const income = Array.isArray(snapshot.other_income) ? (snapshot.other_income as DetailRow[]) : [];
  const expenses = Array.isArray(snapshot.expenses) ? (snapshot.expenses as DetailRow[]) : [];

  return (
    <Dialog open={Boolean(trip)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="size-5 text-primary" />
            {trip?.trip_code} — Billing Details
          </DialogTitle>
          <DialogDescription>
            Read-only view of Other Income and Expenses from the closed trip.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 pt-2">
          <ReadOnlyLines
            title="Other Income"
            rows={income}
            nameKey="income_name"
            total={trip?.total_income ?? 0}
          />
          <ReadOnlyLines
            title="Expenses"
            rows={expenses}
            nameKey="expense_name"
            total={trip?.total_expense ?? 0}
            expense
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReadOnlyLines({
  title,
  rows,
  nameKey,
  total,
  expense = false,
}: {
  title: string;
  rows: DetailRow[];
  nameKey: string;
  total: number;
  expense?: boolean;
}) {
  const filled = rows.filter((row) => String(row[nameKey] ?? "").trim() !== "");
  return (
    <section className="space-y-3">
      <h3
        className={`text-sm font-semibold tracking-tight ${expense ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        {title}
      </h3>
      {filled.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {title.toLowerCase()} recorded.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filled.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  <td className="px-3 py-2">{String(row[nameKey] ?? "")}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${expense ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    {inr(num(row.amount))}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {String(row.note ?? "") || "—"}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3 py-3">Total</td>
                <td
                  className={`px-3 py-3 text-right ${expense ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
                >
                  {inr(total)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
