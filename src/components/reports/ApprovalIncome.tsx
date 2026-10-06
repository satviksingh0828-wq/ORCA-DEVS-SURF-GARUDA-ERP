/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CircleDollarSign, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { serverPostStockInwardApprovalIncome } from "@/lib/approval-income-actions";
import { useSession } from "@/lib/session";
import { useBranches } from "@/lib/use-branches";

const db = supabase as any;

type IncomeStatus = "pending" | "posted" | "all";
type PaymentLedger = {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: "cash" | "bank";
  is_active: boolean;
};
type SourceLink = { source_id: string; source?: { contract_name?: string | null } | null };
type ApprovalIncomeReceipt = {
  id: string;
  receipt_number: string | null;
  receipt_date: string;
  unloading_date: string;
  branch_id: string;
  additional_income_mode: "approval" | "source" | "both" | "none";
  approval_amount: number | string;
  approval_income_payment_ledger_id: string | null;
  approval_income_journal_entry_id: string | null;
  branch?: { branch_name?: string | null } | null;
  stock_inward_sources?: SourceLink[];
};
type Branch = { id: string; branch_name: string };

function amount(value: unknown) {
  return Number(value ?? 0) || 0;
}

function money(value: unknown) {
  return amount(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB");
}

export function ApprovalIncome() {
  const { user } = useSession();
  const branches = useBranches() as Branch[];
  const [rows, setRows] = useState<ApprovalIncomeReceipt[]>([]);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);
  const [voucherNumbers, setVoucherNumbers] = useState<Record<string, string>>({});
  const [selectedLedgers, setSelectedLedgers] = useState<Record<string, string>>({});
  const [postingIds, setPostingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    branch: "all",
    from: "",
    to: "",
    status: "pending" as IncomeStatus,
  });

  const visibleBranches = useMemo(() => {
    if (user?.role !== "basic") return branches;
    const allowed = new Set(user.branchIds ?? []);
    return branches.filter((branch) => allowed.has(branch.id));
  }, [branches, user?.branchIds, user?.role]);
  const allowedBranchIds = useMemo(
    () => visibleBranches.map((branch) => branch.id),
    [visibleBranches],
  );
  const canPost = Boolean(user && user.role !== "viewer" && user.sessionToken);

  const loadPaymentLedgers = useCallback(async () => {
    if (!allowedBranchIds.length) {
      setPaymentLedgers([]);
      return;
    }
    const { data, error } = await db
      .from("ledger_accounts")
      .select("id,branch_id,account_name,ledger_type,is_active")
      .in("branch_id", allowedBranchIds)
      .eq("is_active", true)
      .in("ledger_type", ["cash", "bank"])
      .order("account_name");
    if (error) {
      toast.error(`Could not load Cash / Bank accounts: ${error.message}`);
      return;
    }
    setPaymentLedgers((data ?? []) as PaymentLedger[]);
  }, [allowedBranchIds]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      if (user?.role === "basic" && !allowedBranchIds.length) {
        setRows([]);
        setSelectedLedgers({});
        setVoucherNumbers({});
        return;
      }
      let query = db
        .from("stock_inward_receipts")
        .select(
          "id,receipt_number,receipt_date,unloading_date,branch_id,additional_income_mode,approval_amount,approval_income_payment_ledger_id,approval_income_journal_entry_id,branch:branches(branch_name),stock_inward_sources(source_id,source:contracts(contract_name))",
        )
        .gt("approval_amount", 0)
        .in("additional_income_mode", ["approval", "both"])
        .order("unloading_date", { ascending: false })
        .order("receipt_date", { ascending: false });
      if (user?.role === "basic") query = query.in("branch_id", allowedBranchIds);
      if (filters.branch !== "all") query = query.eq("branch_id", filters.branch);
      if (filters.from) query = query.gte("unloading_date", filters.from);
      if (filters.to) query = query.lte("unloading_date", filters.to);
      if (filters.status === "pending") query = query.is("approval_income_journal_entry_id", null);
      if (filters.status === "posted")
        query = query.not("approval_income_journal_entry_id", "is", null);

      const receiptRows = await fetchAll<ApprovalIncomeReceipt>(() => query);
      setRows(receiptRows);
      setSelectedLedgers(
        Object.fromEntries(
          receiptRows.map((row) => [row.id, row.approval_income_payment_ledger_id ?? ""]),
        ),
      );

      const journalIds = receiptRows
        .map((row) => row.approval_income_journal_entry_id)
        .filter((id): id is string => Boolean(id));
      if (!journalIds.length) {
        setVoucherNumbers({});
      } else {
        const { data: journalRows, error: journalError } = await db
          .from("journal_entries")
          .select("id,voucher_number")
          .in("id", journalIds);
        if (journalError)
          toast.error(`Could not load Approval Income vouchers: ${journalError.message}`);
        else
          setVoucherNumbers(
            Object.fromEntries(
              ((journalRows ?? []) as Array<{ id: string; voucher_number: string }>).map((row) => [
                row.id,
                row.voucher_number,
              ]),
            ),
          );
      }
    } catch (error) {
      toast.error(
        `Could not load Approval Income: ${error instanceof Error ? error.message : String(error)}`,
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [allowedBranchIds, filters.branch, filters.from, filters.status, filters.to, user?.role]);

  useEffect(() => {
    void loadPaymentLedgers();
  }, [loadPaymentLedgers]);
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (summary, row) => {
          const value = amount(row.approval_amount);
          if (row.approval_income_journal_entry_id) {
            summary.posted += value;
            summary.postedCount += 1;
          } else {
            summary.pending += value;
            summary.pendingCount += 1;
          }
          return summary;
        },
        { pending: 0, posted: 0, pendingCount: 0, postedCount: 0 },
      ),
    [rows],
  );

  async function postIncome(row: ApprovalIncomeReceipt) {
    const paymentLedgerId = selectedLedgers[row.id] || row.approval_income_payment_ledger_id || "";
    if (!paymentLedgerId) {
      toast.error("Select a Cash / Bank account before posting this Approval Income");
      return;
    }
    if (!user?.sessionToken) {
      toast.error("Your session has expired. Sign in again to post this income.");
      return;
    }
    setPostingIds((current) => [...current, row.id]);
    try {
      const journalId = await serverPostStockInwardApprovalIncome({
        data: {
          sessionToken: user.sessionToken,
          receiptId: row.id,
          paymentLedgerId,
        },
      });
      const account = paymentLedgers.find((item) => item.id === paymentLedgerId);
      toast.success(
        `Approval Income posted to ${account?.account_name ?? "Cash / Bank"} (Journal ${journalId.slice(0, 8)})`,
      );
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post Approval Income");
    } finally {
      setPostingIds((current) => current.filter((id) => id !== row.id));
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <CircleDollarSign className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Approval Income</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Review Stock Inward Approval Amounts, choose a branch Cash / Bank account, and post
                each amount against the branch’s mapped Approval Charge Income ledger.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadRows()}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Pending to post</p>
          <p className="mt-1 text-xl font-semibold">₹ {money(totals.pending)}</p>
          <p className="text-xs text-muted-foreground">{totals.pendingCount} receipt(s)</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Posted in current view</p>
          <p className="mt-1 text-xl font-semibold">₹ {money(totals.posted)}</p>
          <p className="text-xs text-muted-foreground">{totals.postedCount} receipt(s)</p>
        </div>
      </div>

      <section className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label>Branch</Label>
          <Select
            value={filters.branch}
            onValueChange={(branch) => setFilters((current) => ({ ...current, branch }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {visibleBranches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Unloading date from</Label>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
          />
        </div>
        <div>
          <Label>Unloading date to</Label>
          <Input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
          />
        </div>
        <div>
          <Label>Status</Label>
          <Select
            value={filters.status}
            onValueChange={(status: IncomeStatus) =>
              setFilters((current) => ({ ...current, status }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading approval income…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <CircleDollarSign className="mx-auto size-8 text-muted-foreground/60" />
            <p className="mt-3 font-medium">No Approval Income found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filters.status === "pending"
                ? "Stock Inward receipts with Approval Amount will appear here until posted."
                : "Try changing the branch, date, or status filters."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-3">Receipt / Date</th>
                  <th className="px-3 py-3">Branch / Source</th>
                  <th className="px-3 py-3 text-right">Approval Amount</th>
                  <th className="px-3 py-3">Cash / Bank Account</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const posted = Boolean(row.approval_income_journal_entry_id);
                  const accountOptions = paymentLedgers.filter(
                    (ledger) => ledger.branch_id === row.branch_id && ledger.is_active,
                  );
                  const accountId =
                    selectedLedgers[row.id] || row.approval_income_payment_ledger_id || "";
                  const selectedAccount = paymentLedgers.find((ledger) => ledger.id === accountId);
                  const sourceNames = (row.stock_inward_sources ?? [])
                    .map((item) => item.source?.contract_name)
                    .filter((name): name is string => Boolean(name));
                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="px-3 py-3">
                        <p className="font-medium">{row.receipt_number ?? "Stock Inward"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Unloading {displayDate(row.unloading_date)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Receipt {displayDate(row.receipt_date)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{row.branch?.branch_name ?? "—"}</p>
                        <p className="mt-1 max-w-64 text-xs text-muted-foreground">
                          {sourceNames.join(", ") || "No linked source"}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">
                        ₹ {money(row.approval_amount)}
                      </td>
                      <td className="px-3 py-3">
                        {posted ? (
                          <p className="font-medium">
                            {selectedAccount?.account_name ?? "Cash / Bank"}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              ({selectedAccount?.ledger_type ?? "cash/bank"})
                            </span>
                          </p>
                        ) : (
                          <div className="min-w-56">
                            <Select
                              value={accountId}
                              onValueChange={(value) =>
                                setSelectedLedgers((current) => ({ ...current, [row.id]: value }))
                              }
                              disabled={!canPost || postingIds.includes(row.id)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select Cash / Bank" />
                              </SelectTrigger>
                              <SelectContent>
                                {accountOptions.map((ledger) => (
                                  <SelectItem key={ledger.id} value={ledger.id}>
                                    {ledger.account_name} ({ledger.ledger_type})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!accountOptions.length && (
                              <p className="mt-1 text-xs text-destructive">
                                No active Cash / Bank accounts for this branch.
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {posted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            <BookOpenCheck className="size-3.5" /> Posted
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                            Pending
                          </span>
                        )}
                        {posted && row.approval_income_journal_entry_id && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Voucher{" "}
                            {voucherNumbers[row.approval_income_journal_entry_id] ??
                              row.approval_income_journal_entry_id.slice(0, 8)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {posted ? (
                          <span className="text-xs text-muted-foreground">Completed</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void postIncome(row)}
                            disabled={!canPost || !accountId || postingIds.includes(row.id)}
                          >
                            {postingIds.includes(row.id) ? "Posting…" : "Post income"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Posting debits the selected branch Cash / Bank ledger and credits the branch’s mapped
        Approval Charge Income ledger. Cash / Bank selection and journal posting are handled here,
        not in the Stock Inward form.
      </p>
    </div>
  );
}
