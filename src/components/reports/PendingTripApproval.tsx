import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { inr } from "@/lib/trip-calc";
import { serverReceivePendingTripApproval } from "@/lib/trip-actions";

type PaymentLedger = { id: string; branch_id: string; account_name: string; ledger_type: string };
type PendingApproval = {
  id: string;
  trip_id: string;
  income_name: string;
  amount: number | string;
  note: string | null;
  trip_code: string;
  branch_id: string;
  branch_name: string;
  posted_at: string;
};

function dateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStart() {
  const now = new Date();
  return dateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

function nextDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day + 1);
}

function localStart(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toISOString();
}

export function PendingTripApproval() {
  const branches = useBranches();
  const { user } = useSession();
  const basic = user?.role === "basic";
  const allowedBranchIds = basic ? (user?.branchIds ?? []) : null;
  const [rows, setRows] = useState<PendingApproval[]>([]);
  const [ledgers, setLedgers] = useState<PaymentLedger[]>([]);
  const [branchId, setBranchId] = useState("all");
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(() => dateInput(new Date()));
  const [accountByIncome, setAccountByIncome] = useState<Record<string, string>>({});
  const [dateByIncome, setDateByIncome] = useState<Record<string, string>>({});
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (basic && branchId === "all" && branches[0]) setBranchId(branches[0].id);
  }, [basic, branchId, branches]);

  async function load() {
    if (!fromDate || !toDate || fromDate > toDate) {
      toast.error("Choose a valid from/to date range.");
      return;
    }
    setLoading(true);
    try {
      // This is a client-side read-only list. Receipt posting is performed by
      // a server action and revalidated by the atomic database function.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let tripQuery = (supabase as any)
        .from("trips")
        .select("id,trip_code,branch_id,posted_at,branch:branches(branch_name)")
        .not("posted_at", "is", null)
        .gte("posted_at", localStart(fromDate))
        .lt("posted_at", nextDay(toDate).toISOString())
        .order("posted_at", { ascending: false });
      if (branchId !== "all") tripQuery = tripQuery.eq("branch_id", branchId);
      if (allowedBranchIds !== null) {
        tripQuery = tripQuery.in(
          "branch_id",
          allowedBranchIds.length ? allowedBranchIds : ["00000000-0000-0000-0000-000000000000"],
        );
      }
      const trips = await fetchAll<Record<string, unknown>>(() => tripQuery);
      const tripIds = trips.map((trip) => String(trip.id));
      if (!tripIds.length) {
        setRows([]);
        setLedgers([]);
        return;
      }
      const [incomeRows, branchLedgers] = await Promise.all([
        fetchAll<Record<string, unknown>>(() =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("trip_other_income")
            .select("id,trip_id,income_name,amount,note,to_be_received,received_at")
            .in("trip_id", tripIds)
            .eq("to_be_received", true)
            .is("received_at", null)
            .ilike("income_name", "approval charge"),
        ),
        fetchAll<PaymentLedger>(() => {
          const ids = Array.from(
            new Set(trips.map((trip) => String(trip.branch_id ?? "")).filter(Boolean)),
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let query = (supabase as any)
            .from("ledger_accounts")
            .select("id,branch_id,account_name,ledger_type")
            .eq("is_active", true)
            .in("ledger_type", ["cash", "bank"])
            .order("account_name");
          if (ids.length) query = query.in("branch_id", ids);
          return query;
        }),
      ]);
      const tripById = new Map(trips.map((trip) => [String(trip.id), trip]));
      const pending = incomeRows.flatMap((income) => {
        const trip = tripById.get(String(income.trip_id));
        if (!trip) return [];
        const branch = trip.branch as Record<string, unknown> | null;
        return [
          {
            id: String(income.id),
            trip_id: String(trip.id),
            income_name: String(income.income_name ?? "Approval Charge"),
            amount: income.amount as number | string,
            note: (income.note as string | null) ?? null,
            trip_code: String(trip.trip_code ?? "—"),
            branch_id: String(trip.branch_id ?? ""),
            branch_name: String(branch?.branch_name ?? "—"),
            posted_at: String(trip.posted_at ?? ""),
          },
        ];
      });
      setRows(pending);
      setLedgers(branchLedgers);
      setAccountByIncome((current) => {
        const next = { ...current };
        for (const row of pending) if (!next[row.id]) next[row.id] = "";
        return next;
      });
      setDateByIncome((current) => {
        const today = dateInput(new Date());
        const next = { ...current };
        for (const row of pending) if (!next[row.id]) next[row.id] = today;
        return next;
      });
    } catch (error) {
      toast.error(
        `Could not load pending trip approvals: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // `load` intentionally follows the filters and the session branch grants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, fromDate, toDate, user?.id, allowedBranchIds?.join(",")]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), [rows]);

  async function receive(row: PendingApproval) {
    const paymentLedgerId = accountByIncome[row.id];
    if (!paymentLedgerId) return toast.error("Select a Cash / Bank Account first.");
    if (!user?.sessionToken) return toast.error("Your session has expired. Please sign in again.");
    if (user.role === "viewer") return toast.error("Viewer accounts cannot post receipts.");
    setReceivingId(row.id);
    try {
      const entryId = await serverReceivePendingTripApproval({
        data: {
          sessionToken: user.sessionToken,
          incomeId: row.id,
          paymentLedgerId,
          receivedOn: dateByIncome[row.id] || dateInput(new Date()),
        },
      });
      toast.success(`Approval received and posted. Journal entry ${entryId}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post trip approval receipt.");
    } finally {
      setReceivingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="h-9 w-full sm:w-56">
            <SelectValue placeholder="Branch" />
          </SelectTrigger>
          <SelectContent>
            {!basic ? <SelectItem value="all">All Branches</SelectItem> : null}
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
        <table className="w-full min-w-[1050px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="px-4 py-3 text-left">Trip Number</th>
              <th className="px-4 py-3 text-left">Branch</th>
              <th className="px-4 py-3 text-left">Billed On</th>
              <th className="px-4 py-3 text-right">Approval Amount</th>
              <th className="px-4 py-3 text-left">Receipt Date</th>
              <th className="px-4 py-3 text-left">Cash / Bank Account</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  {loading ? "Loading pending approvals…" : "No pending trip approvals found."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{row.trip_code}</td>
                  <td className="px-4 py-3">{row.branch_name}</td>
                  <td className="px-4 py-3">
                    {row.posted_at ? new Date(row.posted_at).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{inr(Number(row.amount))}</td>
                  <td className="px-4 py-3">
                    <Input
                      className="h-9 w-40"
                      type="date"
                      value={dateByIncome[row.id] ?? ""}
                      onChange={(event) =>
                        setDateByIncome((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={accountByIncome[row.id] || "__none__"}
                      onValueChange={(value) =>
                        setAccountByIncome((current) => ({
                          ...current,
                          [row.id]: value === "__none__" ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger className="h-9 w-64">
                        <SelectValue placeholder="Select Cash / Bank" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select account</SelectItem>
                        {ledgers
                          .filter((ledger) => ledger.branch_id === row.branch_id)
                          .map((ledger) => (
                            <SelectItem key={ledger.id} value={ledger.id}>
                              {ledger.account_name} ({ledger.ledger_type})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Button
                      size="sm"
                      onClick={() => void receive(row)}
                      disabled={receivingId === row.id || user?.role === "viewer"}
                    >
                      {receivingId === row.id ? "Posting…" : "Receive & Post"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td colSpan={3} className="px-4 py-3">
                  Pending total ({rows.length})
                </td>
                <td className="px-4 py-3 text-right">{inr(total)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Only trips already billed with Approval Charge marked “To be Received” appear here. Receipt
        posting debits the selected branch Cash / Bank account and credits the branch’s mapped
        Approval Charge income ledger.
      </p>
    </div>
  );
}
