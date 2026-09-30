import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inr } from "@/lib/trip-calc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAll } from "@/lib/fetch-all";
import { downloadCsv, toCsv } from "@/lib/csv";
import { financialYearRange } from "@/lib/financial-year";
import { useReportFilters } from "@/lib/report-filters";
import { useSession } from "@/lib/session";
import { serverSettleRentalBalance } from "@/lib/trip-actions";

interface RentalRow {
  rental_id: string;
  rental_name: string;
  total_paid: number;
  total_balance: number;
  trip_count: number;
}

interface AdvanceLog {
  id: string;
  trip_id: string;
  trip_code: string | null;
  rental_id: string | null;
  created_at: string;
  advance: number;
  balance: number;
  branch_id: string | null;
  posted_journal_entry_id: string | null;
  payment_ledger_id: string | null;
}

interface PaymentLedger {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: string;
}

function formatDateInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    start: formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function nextDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return formatDateInput(d);
}

function logTripLabel(log: AdvanceLog) {
  return log.trip_code?.trim() || log.trip_id;
}

export function ApprovalChargeAdvanceReport() {
  const { branchId, financialYear } = useReportFilters();
  const { user } = useSession();
  const defaults = currentMonthRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [month, setMonth] = useState(defaults.start.slice(0, 7));
  const [rows, setRows] = useState<RentalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<AdvanceLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedTripIds, setSelectedTripIds] = useState<string[]>([]);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);
  const [accountSelections, setAccountSelections] = useState<Record<string, string>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);

  function range() {
    if (financialYear !== "none") {
      const selected = financialYearRange(Number(financialYear));
      return { start: selected.start, endExclusive: selected.end };
    }
    return { start: startDate, endExclusive: nextDate(endDate) };
  }

  async function loadData() {
    setLoading(true);
    try {
      const { start, endExclusive } = range();
      let liveTripsQuery = supabase
        .from("trips")
        .select("id,trip_code,rental_id,branch_id,posted_journal_entry_id")
        .not("rental_id", "is", null);
      if (branchId !== "all") liveTripsQuery = liveTripsQuery.eq("branch_id", branchId);
      const liveTrips = await fetchAll<Record<string, unknown>>(() => liveTripsQuery);
      const liveTripIds = liveTrips.map((trip) => String(trip.id));
      const rentalIds = Array.from(
        new Set(liveTrips.map((trip) => String(trip.rental_id ?? "")).filter(Boolean)),
      );
      const [rentals, allLogs, hireRows, ledgers] = await Promise.all([
        rentalIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              supabase.from("rentals").select("id,rental_name").in("id", rentalIds),
            )
          : Promise.resolve([]),
        liveTripIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              supabase
                .from("approval_charge_advances" as never)
                .select("id,trip_id,trip_code,rental_id,advance,balance,created_at")
                .in("trip_id", liveTripIds)
                .gte("created_at", start)
                .lt("created_at", endExclusive),
            )
          : Promise.resolve([]),
        liveTripIds.length
          ? fetchAll<Record<string, unknown>>(() =>
              supabase
                .from("trip_expenses" as never)
                .select("trip_id,expense_name,payment_ledger_id")
                .in("trip_id", liveTripIds),
            )
          : Promise.resolve([]),
        fetchAll<PaymentLedger>(() =>
          supabase
            .from("ledger_accounts" as never)
            .select("id,branch_id,account_name,ledger_type")
            .eq("is_active", true)
            .in("ledger_type", ["cash", "bank"])
            .order("account_name"),
        ),
      ]);
      setPaymentLedgers(ledgers);
      const tripById = new Map(liveTrips.map((trip) => [String(trip.id), trip]));
      const hireAccountByTrip = new Map(
        hireRows
          .filter(
            (row) =>
              String(row.expense_name ?? "")
                .trim()
                .toLowerCase() === "hire charges",
          )
          .map((row) => [String(row.trip_id), String(row.payment_ledger_id ?? "")]),
      );
      const logs = allLogs.map((log) => {
        const trip = tripById.get(String(log.trip_id));
        return {
          ...log,
          rental_id: String(log.rental_id ?? trip?.rental_id ?? "") || null,
          branch_id: String(trip?.branch_id ?? "") || null,
          posted_journal_entry_id: String(trip?.posted_journal_entry_id ?? "") || null,
          payment_ledger_id: hireAccountByTrip.get(String(log.trip_id)) || null,
        };
      });

      const agg: Record<string, { paid: number; balance: number; trips: number }> = {};
      rentals.forEach((t) => {
        agg[String(t.id)] = { paid: 0, balance: 0, trips: 0 };
      });
      logs.forEach((l) => {
        const rentalId = String(l.rental_id ?? "");
        if (!rentalId || !agg[rentalId]) return;
        agg[rentalId].paid += Number(l.advance ?? 0);
        agg[rentalId].balance += Number(l.balance ?? 0);
        agg[rentalId].trips += 1;
      });

      setRows(
        rentals.map((t) => ({
          rental_id: String(t.id),
          rental_name: String(t.rental_name ?? "—"),
          total_paid: agg[String(t.id)]?.paid ?? 0,
          total_balance: agg[String(t.id)]?.balance ?? 0,
          trip_count: agg[String(t.id)]?.trips ?? 0,
        })),
      );
      setAccountSelections(
        Object.fromEntries(
          logs.map((log) => [String(log.id), String(log.payment_ledger_id ?? "")]),
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to load Rental Advance report: " + message);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(rentalId: string) {
    setLoadingHistory(true);
    setSelectedId(rentalId);
    setSelectedTripIds([]);
    setPayAmount("");
    try {
      const { start, endExclusive } = range();
      let liveTripsQuery = supabase
        .from("trips")
        .select("id,trip_code,rental_id,branch_id,posted_journal_entry_id")
        .eq("rental_id", rentalId);
      if (branchId !== "all") liveTripsQuery = liveTripsQuery.eq("branch_id", branchId);
      const liveTrips = await fetchAll<Record<string, unknown>>(() => liveTripsQuery);
      const liveTripIds = liveTrips.map((trip) => String(trip.id));
      if (!liveTripIds.length) {
        setHistory([]);
        return;
      }
      const [advanceRows, hireRows] = await Promise.all([
        fetchAll<Record<string, unknown>>(() =>
          supabase
            .from("approval_charge_advances" as never)
            .select("*")
            .in("trip_id", liveTripIds)
            .gte("created_at", start)
            .lt("created_at", endExclusive)
            .order("created_at", { ascending: false }),
        ),
        fetchAll<Record<string, unknown>>(() =>
          supabase
            .from("trip_expenses" as never)
            .select("trip_id,expense_name,payment_ledger_id")
            .in("trip_id", liveTripIds),
        ),
      ]);
      const tripById = new Map(liveTrips.map((trip) => [String(trip.id), trip]));
      const hireAccountByTrip = new Map(
        hireRows
          .filter(
            (row) =>
              String(row.expense_name ?? "")
                .trim()
                .toLowerCase() === "hire charges",
          )
          .map((row) => [String(row.trip_id), String(row.payment_ledger_id ?? "")]),
      );
      const rows = advanceRows.map((row) => {
        const trip = tripById.get(String(row.trip_id));
        return {
          ...row,
          rental_id: String(row.rental_id ?? trip?.rental_id ?? "") || null,
          branch_id: String(trip?.branch_id ?? "") || null,
          posted_journal_entry_id: String(trip?.posted_journal_entry_id ?? "") || null,
          payment_ledger_id: hireAccountByTrip.get(String(row.trip_id)) || null,
        } as AdvanceLog;
      });
      setHistory(rows);
      setAccountSelections((current) => ({
        ...current,
        ...Object.fromEntries(rows.map((row) => [row.id, row.payment_ledger_id ?? ""])),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to load history: " + message);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [startDate, endDate, financialYear, branchId]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter((r) => (r.rental_name ?? "").toLowerCase().includes(s));
  }, [rows, search]);
  const visible = filtered.filter((r) => r.trip_count > 0);
  const payableHistory = history.filter((h) => Number(h.balance ?? 0) > 0);
  const selectedLogs = history.filter((h) => selectedTripIds.includes(h.id));
  const selectedPaidTotal = selectedLogs.reduce((sum, h) => sum + Number(h.advance ?? 0), 0);
  const selectedBalanceTotal = selectedLogs.reduce((sum, h) => sum + Number(h.balance ?? 0), 0);

  function toggleTrip(id: string) {
    setSelectedTripIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleAllTrips() {
    if (selectedTripIds.length === payableHistory.length) {
      setSelectedTripIds([]);
      return;
    }
    setSelectedTripIds(payableHistory.map((h) => h.id));
  }

  async function saveAccount(log: AdvanceLog) {
    const paymentLedgerId = accountSelections[log.id] ?? "";
    if (!log.posted_journal_entry_id) {
      toast.error("Post the trip in Trip Billing before changing its Cash / Bank Account");
      return;
    }
    if (!paymentLedgerId) return toast.error("Select a Cash / Bank Account first");
    if (!user?.sessionToken) return toast.error("Your session has expired. Please sign in again.");

    setSavingAccountId(log.id);
    try {
      const entryId = await serverSettleRentalBalance({
        data: {
          sessionToken: user.sessionToken,
          advanceId: log.id,
          paymentLedgerId,
        },
      });
      toast.success(
        entryId
          ? "Rental account updated and remaining balance journal posted"
          : "Rental account updated; no balance remained to post",
      );
      await loadData();
      if (selectedId) await loadHistory(selectedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update rental account");
    } finally {
      setSavingAccountId(null);
    }
  }

  async function handlePay() {
    const amount = Number(payAmount);
    if (selectedLogs.length === 0) return toast.error("Select at least one trip to pay");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Enter a valid paid amount");
    if (amount > selectedBalanceTotal)
      return toast.error("Paid amount cannot exceed selected balance");

    setPaying(true);
    try {
      let remaining = amount;
      for (const log of selectedLogs) {
        if (remaining <= 0) break;
        const balance = Number(log.balance ?? 0);
        if (balance <= 0) continue;
        const applied = Math.min(balance, remaining);
        remaining -= applied;
        const { error } = await supabase
          .from("approval_charge_advances" as never)
          .update({
            advance: Number(log.advance ?? 0) + applied,
            balance: balance - applied,
          })
          .eq("id", log.id);
        if (error) throw error;
      }
      toast.success("Paid amount updated");
      setPayAmount("");
      setSelectedTripIds([]);
      await loadData();
      if (selectedId) await loadHistory(selectedId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Could not update paid amount: " + message);
    } finally {
      setPaying(false);
    }
  }

  function handleExport() {
    const csv = toCsv(
      visible.map((r) => ({
        Rental: r.rental_name,
        Trips: r.trip_count,
        "PAID AMOUNT (₹)": r.total_paid,
        "Balance (₹)": r.total_balance,
      })),
      ["Rental", "Trips", "PAID AMOUNT (₹)", "Balance (₹)"],
    );
    const period =
      financialYear !== "none"
        ? `FY-${financialYear}-${Number(financialYear) + 1}`
        : `${startDate}_to_${endDate}`;
    downloadCsv(csv, `rental_advance_${period}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search rental…"
            className="h-9 pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Input
          aria-label="Month"
          className="h-9 w-40"
          type="month"
          value={month}
          onChange={(e) => {
            const value = e.target.value;
            setMonth(value);
            if (!value) return;
            const [year, monthNumber] = value.split("-").map(Number);
            setStartDate(`${value}-01`);
            setEndDate(formatDateInput(new Date(year, monthNumber, 0)));
            setSelectedId(null);
          }}
        />
        <Input
          className="h-9 w-40"
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            setSelectedId(null);
          }}
        />
        <Input
          className="h-9 w-40"
          type="date"
          value={endDate}
          onChange={(e) => {
            setEndDate(e.target.value);
            setSelectedId(null);
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} className="h-9 gap-2">
            <Download className="size-4" /> Export
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadData}
            disabled={loading}
            className="h-9 w-9"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Rental</th>
                <th className="px-4 py-3 text-right">Trips</th>
                <th className="px-4 py-3 text-right">PAID AMOUNT</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" />
                    Loading…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground">
                    No Rental Advance entries found for this period.
                  </td>
                </tr>
              ) : (
                <>
                  {visible.map((row) => {
                    const isExpanded = selectedId === row.rental_id;
                    return (
                      <Fragment key={row.rental_id}>
                        <tr className="transition-colors hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium">{row.rental_name}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {row.trip_count}
                          </td>
                          <td className="px-4 py-3 text-right text-blue-600 font-medium">
                            {row.total_paid > 0 ? inr(row.total_paid) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-600 font-medium">
                            {row.total_balance > 0 ? inr(row.total_balance) : "—"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs"
                              onClick={() =>
                                isExpanded ? setSelectedId(null) : loadHistory(row.rental_id)
                              }
                            >
                              {isExpanded ? (
                                <ChevronDown className="size-3" />
                              ) : (
                                <ChevronRight className="size-3" />
                              )}
                              {isExpanded ? "Hide" : "Select Trips"}
                            </Button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-muted/10 border-b border-border">
                            <td colSpan={5} className="p-0">
                              <div className="space-y-4 p-4">
                                <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
                                  <div>
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                      Total paid amount selected
                                    </p>
                                    <p className="font-semibold">{inr(selectedPaidTotal)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                      Total balance to pay
                                    </p>
                                    <p className="font-semibold">{inr(selectedBalanceTotal)}</p>
                                  </div>
                                  <Input
                                    className="h-9 w-40"
                                    type="number"
                                    placeholder="Pay amount"
                                    value={payAmount}
                                    onChange={(e) => setPayAmount(e.target.value)}
                                  />
                                  <Button size="sm" onClick={handlePay} disabled={paying}>
                                    {paying ? "Paying…" : "Pay"}
                                  </Button>
                                </div>
                                {loadingHistory ? (
                                  <div className="py-4 text-center text-muted-foreground">
                                    Loading…
                                  </div>
                                ) : history.length === 0 ? (
                                  <div className="py-4 text-center text-muted-foreground">
                                    No entries in this period.
                                  </div>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-muted-foreground border-b border-border">
                                        <th className="pb-2 text-left font-semibold">
                                          <button
                                            type="button"
                                            className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                                            onClick={toggleAllTrips}
                                            disabled={payableHistory.length === 0}
                                          >
                                            {selectedTripIds.length === payableHistory.length &&
                                            payableHistory.length > 0
                                              ? "Clear all"
                                              : "Select all"}
                                          </button>
                                        </th>
                                        <th className="pb-2 text-left font-semibold">Saved Date</th>
                                        <th className="pb-2 text-left font-semibold">Trip ID</th>
                                        <th className="pb-2 text-right font-semibold">
                                          PAID AMOUNT
                                        </th>
                                        <th className="pb-2 text-right font-semibold">Balance</th>
                                        <th className="pb-2 text-left font-semibold">
                                          Cash / Bank Account
                                        </th>
                                        <th className="pb-2 text-right font-semibold">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                      {history.map((h) => {
                                        const balance = Number(h.balance ?? 0);
                                        return (
                                          <tr key={h.id}>
                                            <td className="py-2">
                                              <input
                                                type="checkbox"
                                                checked={selectedTripIds.includes(h.id)}
                                                disabled={balance <= 0}
                                                onChange={() => toggleTrip(h.id)}
                                              />
                                            </td>
                                            <td className="py-2">
                                              {String(h.created_at).slice(0, 10)}
                                            </td>
                                            <td className="py-2 font-medium">{logTripLabel(h)}</td>
                                            <td className="py-2 text-right text-blue-600">
                                              {Number(h.advance) > 0 ? inr(Number(h.advance)) : "—"}
                                            </td>
                                            <td className="py-2 text-right text-emerald-600">
                                              {balance > 0 ? inr(balance) : "—"}
                                            </td>
                                            <td className="py-2 pr-2">
                                              <Select
                                                value={accountSelections[h.id] || "none"}
                                                onValueChange={(value) =>
                                                  setAccountSelections((current) => ({
                                                    ...current,
                                                    [h.id]: value === "none" ? "" : value,
                                                  }))
                                                }
                                                disabled={!h.posted_journal_entry_id}
                                              >
                                                <SelectTrigger className="h-8 min-w-44 text-xs">
                                                  <SelectValue placeholder="Select account" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="none">Not selected</SelectItem>
                                                  {paymentLedgers
                                                    .filter(
                                                      (ledger) => ledger.branch_id === h.branch_id,
                                                    )
                                                    .map((ledger) => (
                                                      <SelectItem key={ledger.id} value={ledger.id}>
                                                        {ledger.account_name} ({ledger.ledger_type})
                                                      </SelectItem>
                                                    ))}
                                                </SelectContent>
                                              </Select>
                                              {!h.posted_journal_entry_id && (
                                                <p className="mt-1 text-[10px] text-muted-foreground">
                                                  Locked until posted
                                                </p>
                                              )}
                                            </td>
                                            <td className="py-2 text-right">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs"
                                                disabled={
                                                  !h.posted_journal_entry_id ||
                                                  !accountSelections[h.id] ||
                                                  savingAccountId === h.id
                                                }
                                                onClick={() => void saveAccount(h)}
                                              >
                                                {savingAccountId === h.id ? "Saving…" : "Save"}
                                              </Button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  <tr className="bg-muted/50 font-bold border-t-2 border-border">
                    <td className="px-4 py-3">GRAND TOTAL</td>
                    <td className="px-4 py-3 text-right">
                      {visible.reduce((acc, r) => acc + r.trip_count, 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-700">
                      {inr(visible.reduce((acc, r) => acc + r.total_paid, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700">
                      {inr(visible.reduce((acc, r) => acc + r.total_balance, 0))}
                    </td>
                    <td className="px-4 py-3 text-center">—</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
