import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, Eye, ReceiptText, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { inr, num } from "@/lib/trip-calc";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { serverPostTripBilling } from "@/lib/trip-actions";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DetailRow = Record<string, unknown>;
type PaymentLedger = { id: string; account_name: string; ledger_type: "cash" | "bank" };
type PostingStatus = "not_posted" | "posted" | "all";
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
  posted_at: string | null;
  posted_journal_entry_id: string | null;
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
    posted_at: (row.posted_at as string | null) ?? null,
    posted_journal_entry_id: (row.posted_journal_entry_id as string | null) ?? null,
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
  const [postingTrip, setPostingTrip] = useState<BillingTrip | null>(null);
  const [branchId, setBranchId] = useState("all");
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [postingStatus, setPostingStatus] = useState<PostingStatus>("not_posted");

  async function load() {
    setLoading(true);
    try {
      // The generated Supabase types predate the LTMS posting columns.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase as any)
        .from("trips")
        .select(
          "id,trip_code,branch_id,start_date,end_date,updated_at,posted_at,posted_journal_entry_id,branch:branches(branch_name)",
        )
        .eq("closed", true)
        .gte("end_date", fromDate)
        .lte("end_date", toDate)
        .order("end_date", { ascending: false });
      if (branchId !== "all") query = query.eq("branch_id", branchId);
      if (postingStatus === "posted") query = query.not("posted_journal_entry_id", "is", null);
      if (postingStatus === "not_posted") query = query.is("posted_journal_entry_id", null);

      const active = await fetchAll<Record<string, unknown>>(() => query);
      const activeIds = active.map((row) => String(row.id));
      const [activeIncome, activeExpenses, activeApprovals] = await Promise.all([
        activeIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as any)
                .from("trip_other_income")
                .select("id,trip_id,income_name,amount,note,payment_ledger_id")
                .in("trip_id", activeIds),
            )
          : Promise.resolve([]),
        activeIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as any)
                .from("trip_expenses")
                .select("id,trip_id,expense_name,amount,note,payment_ledger_id,sort_order")
                .in("trip_id", activeIds),
            )
          : Promise.resolve([]),
        activeIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as any)
                .from("approval_charge_advances")
                .select("trip_id,trip_code,rental_id,advance,balance")
                .in("trip_id", activeIds),
            )
          : Promise.resolve([]),
      ]);
      const incomeByTrip = new Map<string, Record<string, unknown>[]>();
      const expensesByTrip = new Map<string, Record<string, unknown>[]>();
      const approvalByTrip = new Map<string, Record<string, unknown>>();
      for (const row of activeIncome) {
        const key = String(row.trip_id);
        incomeByTrip.set(key, [...(incomeByTrip.get(key) ?? []), row]);
      }
      for (const row of activeExpenses) {
        const key = String(row.trip_id);
        expensesByTrip.set(key, [...(expensesByTrip.get(key) ?? []), row]);
      }
      for (const row of activeApprovals) approvalByTrip.set(String(row.trip_id), row);

      setRows(
        active
          .map((row) => {
            const id = String(row.id);
            const income = incomeByTrip.get(id) ?? [];
            const expenses = expensesByTrip.get(id) ?? [];
            const totalIncome = income.reduce((sum, item) => sum + num(item.amount), 0);
            const totalExpense = expenses.reduce((sum, item) => sum + num(item.amount), 0);
            const branch = row.branch as Record<string, unknown> | null;
            return toBillingTrip({
              id,
              trip_code: row.trip_code,
              branch_id: row.branch_id,
              branch_name: branch?.branch_name ?? null,
              start_date: row.start_date,
              end_date: row.end_date,
              closed_at: row.updated_at,
              posted_at: row.posted_at,
              posted_journal_entry_id: row.posted_journal_entry_id,
              total_income: totalIncome,
              total_expense: totalExpense,
              net_income: totalIncome - totalExpense,
              snapshot: {
                other_income: income,
                expenses,
                approval_charge_advance: approvalByTrip.get(id) ?? null,
              },
            });
          })
          .sort((a, b) =>
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
  }, [branchId, fromDate, toDate, postingStatus]);

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
        <Select
          value={postingStatus}
          onValueChange={(value) => setPostingStatus(value as PostingStatus)}
        >
          <SelectTrigger className="h-9 w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_posted">Not Posted</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
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
        <table className="w-full min-w-[900px] text-sm">
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
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted-foreground">
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
                    <span
                      className={
                        row.posted_journal_entry_id
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {row.posted_journal_entry_id ? "Posted" : "Not Posted"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSelected(row)}>
                        <Eye className="mr-1.5 size-3.5" />
                        View
                      </Button>
                      {!row.posted_journal_entry_id ? (
                        <Button size="sm" onClick={() => setPostingTrip(row)}>
                          <BookOpenCheck className="mr-1.5 size-3.5" />
                          Post Entry
                        </Button>
                      ) : null}
                    </div>
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
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <BillingDetailsDialog trip={selected} onClose={() => setSelected(null)} />
      <PostEntryDialog
        trip={postingTrip}
        onClose={() => setPostingTrip(null)}
        onPosted={() => {
          setPostingTrip(null);
          void load();
        }}
      />
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
  const approvalAdvance = (snapshot.approval_charge_advance as DetailRow | null) ?? null;
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
            total={income.reduce((sum, row) => sum + num(row.amount), 0)}
          />
          <ReadOnlyLines
            title="Expenses"
            rows={expenses}
            nameKey="expense_name"
            total={trip?.total_expense ?? 0}
            approvalAdvance={approvalAdvance}
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
  approvalAdvance = null,
  expense = false,
}: {
  title: string;
  rows: DetailRow[];
  nameKey: string;
  total: number;
  approvalAdvance?: DetailRow | null;
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
                {approvalAdvance ? (
                  <>
                    <th className="px-3 py-2 text-right">PAID AMOUNT</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </>
                ) : null}
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
                  {approvalAdvance ? (
                    <>
                      <td className="px-3 py-2 text-right text-blue-600">
                        {String(row[nameKey] ?? "")
                          .trim()
                          .toLowerCase() === "hire charges"
                          ? inr(num(approvalAdvance.advance))
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-600">
                        {String(row[nameKey] ?? "")
                          .trim()
                          .toLowerCase() === "hire charges"
                          ? inr(num(approvalAdvance.balance))
                          : "—"}
                      </td>
                    </>
                  ) : null}
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
                {approvalAdvance ? (
                  <>
                    <td />
                    <td />
                  </>
                ) : null}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type PostingLine = {
  id?: string;
  name: string;
  amount: string;
  note: string;
  paymentLedgerId: string;
  advance: string;
};

function PostEntryDialog({
  trip,
  onClose,
  onPosted,
}: {
  trip: BillingTrip | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const { user } = useSession();
  const [ledgers, setLedgers] = useState<PaymentLedger[]>([]);
  const [income, setIncome] = useState<PostingLine[]>([]);
  const [expenses, setExpenses] = useState<PostingLine[]>([]);
  const [approval, setApproval] = useState<DetailRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trip) return;
    const incomeRows = Array.isArray(trip.snapshot.other_income)
      ? (trip.snapshot.other_income as DetailRow[])
      : [];
    const expenseRows = Array.isArray(trip.snapshot.expenses)
      ? (trip.snapshot.expenses as DetailRow[])
      : [];
    const approvalRow = (trip.snapshot.approval_charge_advance as DetailRow | null) ?? null;
    setIncome(
      incomeRows.map((row) => ({
        id: String(row.id ?? ""),
        name: String(row.income_name ?? ""),
        amount: String(row.amount ?? ""),
        note: String(row.note ?? ""),
        paymentLedgerId: String(row.payment_ledger_id ?? ""),
        advance: "",
      })),
    );
    setExpenses(
      expenseRows.map((row) => ({
        id: String(row.id ?? ""),
        name: String(row.expense_name ?? ""),
        amount: String(row.amount ?? ""),
        note: String(row.note ?? ""),
        paymentLedgerId: String(row.payment_ledger_id ?? ""),
        advance:
          String(row.expense_name ?? "")
            .trim()
            .toLowerCase() === "hire charges"
            ? String(approvalRow?.advance ?? "")
            : "",
      })),
    );
    setApproval(approvalRow);
    setLoading(false);
  }, [trip]);

  useEffect(() => {
    if (!trip?.branch_id) return;
    let cancelled = false;
    void (async () => {
      // The generated Supabase types predate the Accounts tables.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("ledger_accounts")
        .select("id,account_name,ledger_type")
        .eq("branch_id", trip.branch_id)
        .eq("is_active", true)
        .in("ledger_type", ["cash", "bank"])
        .order("account_name");
      if (!cancelled) {
        if (error) toast.error(`Could not load payment accounts: ${error.message}`);
        setLedgers((data ?? []) as PaymentLedger[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trip?.branch_id]);

  const updateLine = (kind: "income" | "expenses", index: number, patch: Partial<PostingLine>) => {
    const setter = kind === "income" ? setIncome : setExpenses;
    setter((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  };
  const hireRow = expenses.find((row) => row.name.trim().toLowerCase() === "hire charges");
  const hireAmount = num(hireRow?.amount);
  const advance = num(hireRow?.advance || approval?.advance);
  const balance = Math.max(0, hireAmount - advance);

  async function post() {
    if (!trip || !user?.sessionToken) return;
    const missingIncomeAccount = income.find((row) => num(row.amount) > 0 && !row.paymentLedgerId);
    if (missingIncomeAccount) {
      toast.error(`Select a Cash / Bank Account for ${missingIncomeAccount.name}`);
      return;
    }
    const missingExpenseAccount = expenses.find((row) => {
      const name = row.name.trim().toLowerCase();
      if (num(row.amount) <= 0 || name === "toll charges") return false;
      if (name === "hire charges")
        return num(row.advance || approval?.advance) > 0 && !row.paymentLedgerId;
      return !row.paymentLedgerId;
    });
    if (missingExpenseAccount) {
      const name =
        missingExpenseAccount.name.trim().toLowerCase() === "hire charges"
          ? "Hire Charges advance"
          : missingExpenseAccount.name;
      toast.error(`Select a Cash / Bank Account for ${name}`);
      return;
    }
    setLoading(true);
    try {
      const entryId = await serverPostTripBilling({
        data: {
          sessionToken: user.sessionToken,
          tripId: trip.id,
          income: income.map((row) => ({
            name: row.name,
            amount: row.amount,
            note: row.note,
            payment_ledger_id: row.paymentLedgerId || null,
            advance: null,
          })),
          expenses: expenses.map((row) => ({
            name: row.name,
            amount: row.amount,
            note: row.note,
            payment_ledger_id: row.paymentLedgerId || null,
            advance:
              row.name.trim().toLowerCase() === "hire charges"
                ? row.advance || String(advance)
                : null,
          })),
          approval: approval
            ? {
                trip_code: trip.trip_code,
                rental_id: (approval.rental_id as string | null) ?? null,
                advance,
                balance,
              }
            : null,
        },
      });
      toast.success(`Trip posted. Journal entry ${entryId} created.`);
      onPosted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={Boolean(trip)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{trip?.trip_code} — Post Entry</DialogTitle>
          <DialogDescription>
            Edit amounts and payment accounts. Posting saves the changes and creates one combined
            journal entry. Regular Toll Charges are excluded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <PostingSection
            title="Other Income"
            rows={income}
            kind="income"
            ledgers={ledgers}
            onUpdate={updateLine}
          />
          <PostingSection
            title="Expenses"
            rows={expenses}
            kind="expenses"
            ledgers={ledgers}
            onUpdate={updateLine}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => void post()} disabled={loading || !trip}>
            {loading ? "Posting…" : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostingSection({
  title,
  rows,
  kind,
  ledgers,
  onUpdate,
}: {
  title: string;
  rows: PostingLine[];
  kind: "income" | "expenses";
  ledgers: PaymentLedger[];
  onUpdate: (kind: "income" | "expenses", index: number, patch: Partial<PostingLine>) => void;
}) {
  const expense = kind === "expenses";
  return (
    <section className="space-y-3">
      <h3
        className={`text-sm font-semibold ${expense ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        {title}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Amount</th>
              {expense ? <th className="px-3 py-2">Hire Advance</th> : null}
              <th className="px-3 py-2">Cash / Bank Account</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows
              .filter((row) => row.name.trim())
              .map((row, index) => {
                const toll = row.name.trim().toLowerCase() === "toll charges";
                const hire = row.name.trim().toLowerCase() === "hire charges";
                return (
                  <tr key={row.id || `${row.name}-${index}`}>
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2">
                      <Input
                        className="h-9 w-32"
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.amount}
                        onChange={(event) => onUpdate(kind, index, { amount: event.target.value })}
                      />
                    </td>
                    {expense ? (
                      <td className="px-3 py-2">
                        {hire ? (
                          <Input
                            className="h-9 w-32"
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.advance}
                            onChange={(event) =>
                              onUpdate(kind, index, { advance: event.target.value })
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      {toll ? (
                        <span className="text-xs text-muted-foreground">Not used in journal</span>
                      ) : (
                        <Select
                          value={row.paymentLedgerId || "__none__"}
                          onValueChange={(value) =>
                            onUpdate(kind, index, {
                              paymentLedgerId: value === "__none__" ? "" : value,
                            })
                          }
                        >
                          <SelectTrigger className="h-9 w-56">
                            <SelectValue
                              placeholder={hire ? "Advance account" : "Select account"}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select account</SelectItem>
                            {ledgers.map((ledger) => (
                              <SelectItem key={ledger.id} value={ledger.id}>
                                {ledger.account_name} ({ledger.ledger_type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.note || "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
