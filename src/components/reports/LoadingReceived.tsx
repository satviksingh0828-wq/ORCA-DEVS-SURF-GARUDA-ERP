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
import { serverPostStockOutwardLoadingReceived } from "@/lib/loading-received-actions";
import { useSession } from "@/lib/session";
import { useBranches } from "@/lib/use-branches";

const db = supabase as any;
type ReceiptStatus = "pending" | "posted" | "all";
type PaymentLedger = {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: "cash" | "bank";
  is_active: boolean;
};
type Receipt = {
  id: string;
  outward_number: string | null;
  loading_date: string;
  branch_id: string;
  loading_amount_received: number | string;
  loading_received_payment_ledger_id: string | null;
  loading_received_journal_entry_id: string | null;
  branch?: { branch_name?: string | null } | null;
};
type Branch = { id: string; branch_name: string };
const amount = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: unknown) =>
  amount(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const displayDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB");
};

export function LoadingReceived() {
  const { user } = useSession();
  const branches = useBranches() as Branch[];
  const [rows, setRows] = useState<Receipt[]>([]);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);
  const [voucherNumbers, setVoucherNumbers] = useState<Record<string, string>>({});
  const [selectedLedgers, setSelectedLedgers] = useState<Record<string, string>>({});
  const [postingIds, setPostingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    branch: "all",
    from: "",
    to: "",
    status: "pending" as ReceiptStatus,
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
        .from("stock_outward_receipts")
        .select(
          "id,outward_number,loading_date,branch_id,loading_amount_received,loading_received_payment_ledger_id,loading_received_journal_entry_id,branch:branches(branch_name)",
        )
        .gt("loading_amount_received", 0)
        .order("loading_date", { ascending: false });
      if (user?.role === "basic") query = query.in("branch_id", allowedBranchIds);
      if (filters.branch !== "all") query = query.eq("branch_id", filters.branch);
      if (filters.from) query = query.gte("loading_date", filters.from);
      if (filters.to) query = query.lte("loading_date", filters.to);
      if (filters.status === "pending") query = query.is("loading_received_journal_entry_id", null);
      if (filters.status === "posted")
        query = query.not("loading_received_journal_entry_id", "is", null);
      const receiptRows = await fetchAll<Receipt>(() => query);
      setRows(receiptRows);
      setSelectedLedgers(
        Object.fromEntries(
          receiptRows.map((row) => [row.id, row.loading_received_payment_ledger_id ?? ""]),
        ),
      );
      const journalIds = receiptRows
        .map((row) => row.loading_received_journal_entry_id)
        .filter((id): id is string => Boolean(id));
      if (!journalIds.length) setVoucherNumbers({});
      else {
        const { data, error } = await db
          .from("journal_entries")
          .select("id,voucher_number")
          .in("id", journalIds);
        if (error) toast.error(`Could not load receipt vouchers: ${error.message}`);
        else
          setVoucherNumbers(
            Object.fromEntries(
              ((data ?? []) as Array<{ id: string; voucher_number: string }>).map((row) => [
                row.id,
                row.voucher_number,
              ]),
            ),
          );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load loading receipts");
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
          if (row.loading_received_journal_entry_id) {
            summary.posted += amount(row.loading_amount_received);
            summary.postedCount++;
          } else {
            summary.pending += amount(row.loading_amount_received);
            summary.pendingCount++;
          }
          return summary;
        },
        { pending: 0, posted: 0, pendingCount: 0, postedCount: 0 },
      ),
    [rows],
  );

  async function postReceipt(row: Receipt) {
    const paymentLedgerId = selectedLedgers[row.id] || row.loading_received_payment_ledger_id || "";
    if (!paymentLedgerId) {
      toast.error("Select a Cash / Bank account before posting this receipt");
      return;
    }
    if (!user?.sessionToken) {
      toast.error("Your session has expired. Sign in again to post this receipt.");
      return;
    }
    setPostingIds((current) => [...current, row.id]);
    try {
      const journalId = await serverPostStockOutwardLoadingReceived({
        data: { sessionToken: user.sessionToken, receiptId: row.id, paymentLedgerId },
      });
      const account = paymentLedgers.find((item) => item.id === paymentLedgerId);
      toast.success(
        `Loading receipt posted to ${account?.account_name ?? "Cash / Bank"} (Journal ${journalId.slice(0, 8)})`,
      );
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post loading receipt");
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
              <h2 className="font-semibold">Stock Outward Loading Received</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Review the loading amount captured for each Stock Outward receipt, choose its branch
                Cash / Bank account, and post the receipt journal.
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
          <Label>Loading date from</Label>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
          />
        </div>
        <div>
          <Label>Loading date to</Label>
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
            onValueChange={(status: ReceiptStatus) =>
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
          <p className="p-8 text-center text-sm text-muted-foreground">Loading outward receipts…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <CircleDollarSign className="mx-auto size-8 text-muted-foreground/60" />
            <p className="mt-3 font-medium">No loading receipts found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filters.status === "pending"
                ? "Stock Outward receipts with a captured loading amount will appear here until posted."
                : "Try changing the branch, date, or status filters."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-3">Outward / Date</th>
                  <th className="px-3 py-3">Branch</th>
                  <th className="px-3 py-3 text-right">Loading Amount Received</th>
                  <th className="px-3 py-3">Cash / Bank Account</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const posted = Boolean(row.loading_received_journal_entry_id);
                  const accountOptions = paymentLedgers.filter(
                    (ledger) => ledger.branch_id === row.branch_id && ledger.is_active,
                  );
                  const accountId =
                    selectedLedgers[row.id] || row.loading_received_payment_ledger_id || "";
                  const selectedAccount = paymentLedgers.find((ledger) => ledger.id === accountId);
                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="px-3 py-3">
                        <p className="font-medium">{row.outward_number ?? "Stock Outward"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Loading {displayDate(row.loading_date)}
                        </p>
                      </td>
                      <td className="px-3 py-3 font-medium">{row.branch?.branch_name ?? "—"}</td>
                      <td className="px-3 py-3 text-right font-semibold">
                        ₹ {money(row.loading_amount_received)}
                      </td>
                      <td className="px-3 py-3">
                        {posted ? (
                          <p className="font-medium">
                            {selectedAccount?.account_name ?? "Account"}
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
                          <>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              <BookOpenCheck className="size-3.5" /> Posted
                            </span>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Voucher{" "}
                              {voucherNumbers[row.loading_received_journal_entry_id!] ??
                                row.loading_received_journal_entry_id!.slice(0, 8)}
                            </p>
                          </>
                        ) : (
                          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {posted ? (
                          <span className="text-xs text-muted-foreground">Completed</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void postReceipt(row)}
                            disabled={!canPost || !accountId || postingIds.includes(row.id)}
                          >
                            {postingIds.includes(row.id) ? "Posting…" : "Post receipt"}
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
        Posting debits the selected branch Cash / Bank ledger and credits the mapped Loading Income
        ledger. The amount posted is the loading amount captured on the Stock Outward receipt.
      </p>
    </div>
  );
}
