/**
 * Driver Payroll tab
 * – Both admin and basic users (branch-restricted) can use this.
 * – Select a driver → salary auto-fetched (editable).
 * – Payroll created as Unpaid → linked expenditure created for that month.
 * – Pay from here or from the Expenditure tab.
 * – Advance payments with auto-generated monthly deduction schedule.
 * – Changing a deduction on any payroll auto-recalculates future months.
 */

import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { fetchAll } from "@/lib/fetch-all";
import { isDriverActive } from "@/lib/drivers";
import { inr, num } from "@/lib/trip-calc";
import { downloadDriverPaymentReceipt } from "@/lib/driver-payment-pdf";

// ── Types ─────────────────────────────────────────────────────────────────────

type DriverRow = Record<string, unknown> & {
  id: string;
  full_name: string;
  driver_code: string;
  branch_id: string | null;
  salary_amount: string | null;
  salary_type: string | null;
  ending_date: string | null;
};

type Payroll = {
  id: string;
  driver_id: string;
  branch_id: string | null;
  month: string;
  salary_amount: number;
  advance_deduction: number;
  net_amount: number;
  is_paid: boolean;
  paid_date: string | null;
  expenditure_id: string | null;
  note: string | null;
  created_at: string;
};

type Advance = {
  id: string;
  driver_id: string;
  branch_id: string | null;
  amount: number;
  remaining_balance: number;
  payment_date: string;
  monthly_deduction: number;
  note: string | null;
  created_at: string;
};

type Deduction = {
  id: string;
  advance_id: string;
  driver_id: string;
  payroll_id: string | null;
  month: string;
  deduction_amount: number;
  is_applied: boolean;
};

type PaymentLedger = { id: string; account_name: string; ledger_type: "cash" | "bank" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[(parseInt(m) - 1) % 12]} ${y}`;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function nextMonthFrom(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function addMonths(ym: string, n: number): string {
  let result = ym;
  for (let i = 0; i < n; i++) result = nextMonthFrom(result);
  return result;
}

/** Generate future YYYY-MM strings starting from (but not including) fromMonth. */
function futureMonths(fromMonth: string, count: number): string[] {
  const result: string[] = [];
  let cur = fromMonth;
  for (let i = 0; i < count; i++) {
    cur = nextMonthFrom(cur);
    result.push(cur);
  }
  return result;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DriverPayroll() {
  const { user } = useSession();
  const allBranches = useBranches();
  const isAdmin = isAdminLike(user?.role);
  const isBasic = user?.role === "basic";
  const allowedBranchIds = isBasic ? (user?.branchIds ?? []) : null;

  // ── state ──────────────────────────────────────────────────────────────────
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);

  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [subTab, setSubTab] = useState<"payrolls" | "advances">("payrolls");

  // Filters
  const [filterYear, setFilterYear] = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "paid" | "unpaid">("all");

  // Dialogs
  const [showPayrollDialog, setShowPayrollDialog] = useState(false);
  const [showAdvanceDialog, setShowAdvanceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentPayroll, setPaymentPayroll] = useState<Payroll | null>(null);
  const [expandedAdvances, setExpandedAdvances] = useState<Set<string>>(new Set());

  // Payroll form
  const [pMonth, setPMonth] = useState(currentMonth());
  const [pSalary, setPSalary] = useState("");
  const [pDeduction, setPDeduction] = useState("");
  const [pNote, setPNote] = useState("");
  const [pSaving, setPSaving] = useState(false);

  // Advance form
  const [aAmount, setAAmount] = useState("");
  const [aDate, setADate] = useState(today());
  const [aMonthly, setAMonthly] = useState("");
  const [aNote, setANote] = useState("");
  const [aSaving, setASaving] = useState(false);
  const [aDisbursementLedgerId, setADisbursementLedgerId] = useState("");
  const [paymentLedgerId, setPaymentLedgerId] = useState("");

  // Paying
  const [payingId, setPayingId] = useState<string | null>(null);

  // ── derived ────────────────────────────────────────────────────────────────
  const selectedDriver = useMemo(
    () => drivers.find((d) => d.id === selectedDriverId) ?? null,
    [drivers, selectedDriverId],
  );

  const totalAdvanceBalance = useMemo(
    () => advances.reduce((s, a) => s + Number(a.remaining_balance), 0),
    [advances],
  );

  /** Sum of pending scheduled deductions for a given month. */
  const scheduledDeductionForMonth = (month: string) =>
    deductions
      .filter((d) => d.month === month && !d.is_applied)
      .reduce((s, d) => s + Number(d.deduction_amount), 0);

  const years = useMemo(() => {
    const set = new Set(payrolls.map((p) => p.month.slice(0, 4)));
    set.add(String(new Date().getFullYear()));
    return Array.from(set).sort().reverse();
  }, [payrolls]);

  const MONTHS_LIST = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const filteredPayrolls = payrolls.filter((p) => {
    if (filterYear !== "all" && p.month.slice(0, 4) !== filterYear) return false;
    if (filterMonth !== "all" && p.month.slice(5, 7) !== filterMonth) return false;
    if (filterStatus === "paid" && !p.is_paid) return false;
    if (filterStatus === "unpaid" && p.is_paid) return false;
    return true;
  });

  // Payroll months already generated (to prevent duplicates)
  const usedMonths = new Set(payrolls.map((p) => p.month));

  // Advance schedule preview (used in advance dialog)
  const advanceSchedulePreview = useMemo(() => {
    const amt = num(aAmount);
    const monthly = num(aMonthly);
    if (amt <= 0 || monthly <= 0) return [];
    const months = Math.ceil(amt / monthly);
    const result: { month: string; amount: number }[] = [];
    let rem = amt;
    const startMonth = currentMonth();
    for (let i = 0; i < months; i++) {
      const m = addMonths(startMonth, i);
      const d = Math.min(monthly, rem);
      result.push({ month: m, amount: d });
      rem -= d;
    }
    return result;
  }, [aAmount, aMonthly]);

  // Net payroll amount
  const pNet = Math.max(0, num(pSalary) - num(pDeduction));

  // ── load functions ─────────────────────────────────────────────────────────
  async function loadDrivers() {
    setLoadingDrivers(true);
    try {
      const data = await fetchAll<DriverRow>(() => {
        let q = supabase.from("drivers").select("*").order("full_name");
        if (allowedBranchIds !== null && allowedBranchIds.length > 0) {
          q = q.in("branch_id", allowedBranchIds) as typeof q;
        }
        return q;
      });
      setDrivers(data.filter(isDriverActive));
    } catch {
      toast.error("Could not load drivers");
    }
    setLoadingDrivers(false);
  }

  async function loadPayrollData(driverId: string) {
    setLoadingData(true);
    try {
      const [payrollData, advanceData, deductionData] = await Promise.all([
        fetchAll<Payroll>(() =>
          supabase
            .from("driver_payrolls")
            .select("*")
            .eq("driver_id", driverId)
            .order("month", { ascending: false }),
        ),
        fetchAll<Advance>(() =>
          supabase
            .from("driver_advances")
            .select("*")
            .eq("driver_id", driverId)
            .order("created_at", { ascending: false }),
        ),
        fetchAll<Deduction>(() =>
          supabase
            .from("driver_advance_deductions")
            .select("*")
            .eq("driver_id", driverId)
            .order("month"),
        ),
      ]);
      setPayrolls(payrollData);
      setAdvances(advanceData);
      setDeductions(deductionData);
      const branchId = drivers.find((driver) => driver.id === driverId)?.branch_id;
      if (branchId) {
        const { data: ledgerData, error: ledgerError } = await supabase
          .from("ledger_accounts")
          .select("id,account_name,ledger_type")
          .eq("branch_id", branchId)
          .eq("is_active", true)
          .in("ledger_type", ["cash", "bank"])
          .order("account_name");
        if (ledgerError) throw ledgerError;
        setPaymentLedgers((ledgerData ?? []) as PaymentLedger[]);
      } else setPaymentLedgers([]);
    } catch {
      toast.error("Could not load payroll data");
    }
    setLoadingData(false);
  }

  useEffect(() => {
    loadDrivers();
  }, [user?.id]);

  useEffect(() => {
    if (selectedDriverId) {
      loadPayrollData(selectedDriverId);
    } else {
      setPayrolls([]);
      setAdvances([]);
      setDeductions([]);
    }
  }, [selectedDriverId]);

  // Pre-fill salary when opening payroll dialog
  useEffect(() => {
    if (showPayrollDialog && selectedDriver) {
      const salAmt = num(selectedDriver.salary_amount ?? "0");
      setPSalary(salAmt > 0 ? String(salAmt) : "");
      const sched = scheduledDeductionForMonth(pMonth);
      setPDeduction(sched > 0 ? String(sched) : "");
    }
  }, [showPayrollDialog, selectedDriver, pMonth]);

  // Re-fill deduction when month changes in payroll dialog
  useEffect(() => {
    if (showPayrollDialog) {
      const sched = scheduledDeductionForMonth(pMonth);
      setPDeduction(sched > 0 ? String(sched) : "");
    }
  }, [pMonth, showPayrollDialog]);

  // ── create payroll ─────────────────────────────────────────────────────────
  async function createPayroll() {
    if (!selectedDriverId || !selectedDriver) return;
    if (!pMonth) {
      toast.error("Select a month");
      return;
    }
    if (usedMonths.has(pMonth)) {
      toast.error(`Payroll for ${monthLabel(pMonth)} already exists`);
      return;
    }
    const salary = num(pSalary);
    if (salary <= 0) {
      toast.error("Enter salary amount");
      return;
    }
    const deduction = Math.min(num(pDeduction), totalAdvanceBalance);
    const net = Math.max(0, salary - deduction);

    setPSaving(true);
    try {
      const driver = selectedDriver;

      // 1. Insert payroll (expenditure_id filled after)
      const { data: pr, error: prErr } = await supabase
        .from("driver_payrolls")
        .insert({
          driver_id: selectedDriverId,
          branch_id: driver.branch_id ?? null,
          month: pMonth,
          salary_amount: salary,
          advance_deduction: deduction,
          net_amount: net,
          is_paid: false,
          note: pNote || null,
        })
        .select("id")
        .single();
      if (prErr || !pr) throw prErr ?? new Error("Payroll insert failed");

      // 2. Insert expenditure
      const expName = `Payroll — ${driver.full_name} (${monthLabel(pMonth)})`;
      const { data: exp, error: expErr } = await supabase
        .from("expenditures")
        .insert({
          expenditure_name: expName,
          // Record the full salary as the expenditure. The advance deduction
          // remains tracked separately on payroll and reduces the net amount
          // payable to the driver.
          amount: String(salary),
          entry_date: `${pMonth}-01`,
          driver_id: selectedDriverId,
          branch_id: driver.branch_id ?? null,
          is_paid: false,
          is_payroll: true,
          payroll_id: pr.id,
          note: pNote || null,
        })
        .select("id")
        .single();
      if (expErr || !exp) throw expErr ?? new Error("Expenditure insert failed");

      // 3. Back-link
      await supabase.from("driver_payrolls").update({ expenditure_id: exp.id }).eq("id", pr.id);

      // 4. Apply advance deductions
      if (deduction > 0) {
        await applyDeductionAndRebuildSchedule(selectedDriverId, pMonth, deduction, pr.id);
      }

      toast.success(`Payroll for ${monthLabel(pMonth)} created`);
      setShowPayrollDialog(false);
      setPNote("");
      await loadPayrollData(selectedDriverId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create payroll");
    }
    setPSaving(false);
  }

  // ── apply deduction + rebuild schedule ────────────────────────────────────
  async function applyDeductionAndRebuildSchedule(
    driverId: string,
    month: string,
    totalDeduction: number,
    payrollId: string,
  ) {
    // Get advances with remaining balance (oldest first)
    const activeAdvances = advances
      .filter((a) => Number(a.remaining_balance) > 0)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    let rem = totalDeduction;

    for (const adv of activeAdvances) {
      if (rem <= 0) break;
      const take = Math.min(rem, Number(adv.remaining_balance));
      rem -= take;
      const newBal = Number(adv.remaining_balance) - take;

      // Update remaining balance
      await supabase.from("driver_advances").update({ remaining_balance: newBal }).eq("id", adv.id);

      // Delete any pending deduction for this advance this month (replace with actual)
      await supabase
        .from("driver_advance_deductions")
        .delete()
        .eq("advance_id", adv.id)
        .eq("month", month)
        .eq("is_applied", false);

      // Insert applied deduction record
      await supabase.from("driver_advance_deductions").insert({
        advance_id: adv.id,
        driver_id: driverId,
        month,
        deduction_amount: take,
        is_applied: true,
        payroll_id: payrollId,
      });

      // Rebuild future schedule for this advance
      await supabase
        .from("driver_advance_deductions")
        .delete()
        .eq("advance_id", adv.id)
        .eq("is_applied", false)
        .gt("month", month);

      if (newBal > 0) {
        const monthlyRate = Number(adv.monthly_deduction);
        const numFuture = Math.ceil(newBal / monthlyRate);
        const futMonths = futureMonths(month, numFuture);
        let remaining = newBal;
        for (const fm of futMonths) {
          const d = Math.min(monthlyRate, remaining);
          await supabase.from("driver_advance_deductions").insert({
            advance_id: adv.id,
            driver_id: driverId,
            month: fm,
            deduction_amount: d,
            is_applied: false,
          });
          remaining -= d;
          if (remaining <= 0) break;
        }
      }
    }
  }

  // ── give advance ───────────────────────────────────────────────────────────
  async function giveAdvance() {
    if (!selectedDriverId || !selectedDriver) return;
    const amount = num(aAmount);
    const monthly = num(aMonthly);
    if (amount <= 0) {
      toast.error("Enter advance amount");
      return;
    }
    if (monthly <= 0) {
      toast.error("Enter monthly deduction amount");
      return;
    }
    if (monthly > amount) {
      toast.error("Monthly deduction cannot exceed advance amount");
      return;
    }
    if (!aDate) {
      toast.error("Enter payment date");
      return;
    }
    if (!aDisbursementLedgerId) {
      toast.error("Select the cash or bank account used for the advance");
      return;
    }

    setASaving(true);
    try {
      const { data: adv, error: advErr } = await supabase
        .from("driver_advances")
        .insert({
          driver_id: selectedDriverId,
          branch_id: selectedDriver.branch_id ?? null,
          amount,
          remaining_balance: amount,
          payment_date: aDate,
          monthly_deduction: monthly,
          disbursement_ledger_id: aDisbursementLedgerId,
          note: aNote || null,
        })
        .select("id")
        .single();
      if (advErr || !adv) throw advErr ?? new Error("Advance insert failed");

      // Generate deduction schedule (starting NEXT month)
      const numMonths = Math.ceil(amount / monthly);
      const schedMonths = futureMonths(currentMonth(), numMonths);
      let rem = amount;
      for (const m of schedMonths) {
        const d = Math.min(monthly, rem);
        await supabase.from("driver_advance_deductions").insert({
          advance_id: adv.id,
          driver_id: selectedDriverId,
          month: m,
          deduction_amount: d,
          is_applied: false,
        });
        rem -= d;
        if (rem <= 0) break;
      }

      toast.success(`Advance of ${inr(amount)} recorded`);
      setShowAdvanceDialog(false);
      setAAmount("");
      setADate(today());
      setAMonthly("");
      setANote("");
      setADisbursementLedgerId("");
      await loadPayrollData(selectedDriverId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record advance");
    }
    setASaving(false);
  }

  // ── mark payroll paid ──────────────────────────────────────────────────────
  async function markPaid(p: Payroll) {
    if (!paymentLedgerId) {
      toast.error("Select the cash or bank account used for salary payment");
      return;
    }
    setPayingId(p.id);
    try {
      const { error } = await supabase.rpc("tms_record_driver_salary_payment", {
        p_payroll_id: p.id,
        p_payment_ledger_id: paymentLedgerId,
      });
      if (error) throw error;

      toast.success(`${monthLabel(p.month)} payroll marked as paid`);
      setShowPaymentDialog(false);
      setPaymentPayroll(null);
      setPaymentLedgerId("");
      await loadPayrollData(selectedDriverId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark as paid");
    }
    setPayingId(null);
  }

  // ── edit schedule entry ────────────────────────────────────────────────────
  async function updateScheduleEntry(d: Deduction, newAmount: number) {
    if (newAmount <= 0) return;
    const adv = advances.find((a) => a.id === d.advance_id);
    if (!adv) return;

    const oldAmount = Number(d.deduction_amount);
    const delta = newAmount - oldAmount;
    const newRemaining = Math.max(0, Number(adv.remaining_balance) - delta);

    try {
      await supabase
        .from("driver_advance_deductions")
        .update({ deduction_amount: newAmount })
        .eq("id", d.id);

      // Rebuild schedule for this advance from this month onward
      await supabase
        .from("driver_advance_deductions")
        .delete()
        .eq("advance_id", d.advance_id)
        .eq("is_applied", false)
        .gt("month", d.month);

      if (newRemaining > 0) {
        const monthlyRate = Number(adv.monthly_deduction);
        const numFut = Math.ceil(newRemaining / monthlyRate);
        const fMonths = futureMonths(d.month, numFut);
        let rem = newRemaining;
        for (const fm of fMonths) {
          const amount = Math.min(monthlyRate, rem);
          await supabase.from("driver_advance_deductions").insert({
            advance_id: d.advance_id,
            driver_id: d.driver_id,
            month: fm,
            deduction_amount: amount,
            is_applied: false,
          });
          rem -= amount;
          if (rem <= 0) break;
        }
      }

      toast.success("Schedule updated");
      await loadPayrollData(selectedDriverId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (loadingDrivers) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Driver selector ── */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[220px] max-w-xs space-y-1.5">
          <Label>Select Driver</Label>
          <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a driver…" />
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                  <span className="ml-1.5 text-xs text-muted-foreground">({d.driver_code})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedDriverId && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setShowPayrollDialog(true)} className="gap-1.5">
              <Plus className="size-3.5" /> Generate Payroll
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAdvanceDialog(true)}
              className="gap-1.5"
            >
              <Wallet className="size-3.5" /> Give Advance
            </Button>
          </div>
        )}
      </div>

      {!selectedDriverId && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 py-16 text-center text-muted-foreground">
          <BadgeDollarSign className="mx-auto mb-3 size-8 opacity-40" />
          <p className="text-sm">Select a driver to view payrolls and advances</p>
        </div>
      )}

      {selectedDriverId && loadingData && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {selectedDriverId && !loadingData && (
        <>
          {/* ── Balance card ── */}
          {totalAdvanceBalance > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <Wallet className="size-4 shrink-0 text-amber-600" />
              <span className="font-medium text-amber-800 dark:text-amber-300">
                Outstanding advance balance:&nbsp;
                <span className="font-bold">{inr(totalAdvanceBalance)}</span>
              </span>
            </div>
          )}

          {/* ── Sub-tabs ── */}
          <div className="flex gap-1 border-b border-border">
            {(["payrolls", "advances"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSubTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                  subTab === t
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "payrolls" ? "Payrolls" : "Advances & Balance"}
                {t === "payrolls" && payrolls.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                    {payrolls.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ══ Payrolls sub-tab ══ */}
          {subTab === "payrolls" && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <Select value={filterYear} onValueChange={setFilterYear}>
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All years</SelectItem>
                    {years.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterMonth} onValueChange={setFilterMonth}>
                  <SelectTrigger className="h-8 w-[110px] text-xs">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All months</SelectItem>
                    {MONTHS_LIST.map((m, i) => (
                      <SelectItem key={m} value={m}>
                        {MONTH_NAMES[i]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filterStatus}
                  onValueChange={(v) => setFilterStatus(v as "all" | "paid" | "unpaid")}
                >
                  <SelectTrigger className="h-8 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {filteredPayrolls.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                  No payrolls
                  {filterYear !== "all" || filterMonth !== "all" || filterStatus !== "all"
                    ? " matching filters"
                    : " yet"}
                  .
                  <br />
                  <button
                    className="mt-2 text-primary hover:underline"
                    onClick={() => setShowPayrollDialog(true)}
                  >
                    Generate first payroll →
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 text-left font-medium">Month</th>
                        <th className="px-4 py-2.5 text-right font-medium">Salary</th>
                        <th className="px-4 py-2.5 text-right font-medium">Adv. Deduction</th>
                        <th className="px-4 py-2.5 text-right font-medium">Net Paid</th>
                        <th className="px-4 py-2.5 text-left font-medium">Status</th>
                        <th className="px-4 py-2.5 text-left font-medium">Note</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayrolls.map((p) => (
                        <tr
                          key={p.id}
                          className="border-b border-border last:border-0 hover:bg-muted/20"
                        >
                          <td className="px-4 py-3 font-medium">
                            <span className="flex items-center gap-1.5">
                              <CalendarDays className="size-3.5 text-muted-foreground" />
                              {monthLabel(p.month)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {inr(p.salary_amount)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {p.advance_deduction > 0 ? (
                              <span className="text-amber-600">−{inr(p.advance_deduction)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {inr(p.net_amount)}
                          </td>
                          <td className="px-4 py-3">
                            {p.is_paid ? (
                              <Badge
                                variant="outline"
                                className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                              >
                                <Check className="size-3" /> Paid
                                {p.paid_date && (
                                  <span className="ml-0.5 opacity-70">{p.paid_date}</span>
                                )}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                              >
                                Unpaid
                              </Badge>
                            )}
                          </td>
                          <td className="max-w-[140px] truncate px-4 py-3 text-xs text-muted-foreground">
                            {p.note || "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mr-1 h-7 gap-1.5 text-xs"
                              title="Download salary receipt PDF"
                              onClick={() =>
                                selectedDriver &&
                                downloadDriverPaymentReceipt(selectedDriver, {
                                  kind: "Salary",
                                  amount: p.net_amount,
                                  salaryAmount: p.salary_amount,
                                  date: p.paid_date || p.created_at.slice(0, 10),
                                  month: monthLabel(p.month),
                                  advanceDeduction: p.advance_deduction,
                                  note: p.note,
                                })
                              }
                            >
                              <Download className="size-3" /> PDF
                            </Button>
                            {!p.is_paid && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1.5 text-xs"
                                disabled={payingId === p.id}
                                onClick={() => {
                                  setPaymentPayroll(p);
                                  setPaymentLedgerId("");
                                  setShowPaymentDialog(true);
                                }}
                              >
                                {payingId === p.id ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Check className="size-3" />
                                )}
                                Mark Paid
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/30 text-xs font-semibold">
                        <td className="px-4 py-2 text-muted-foreground">
                          {filteredPayrolls.length} payroll
                          {filteredPayrolls.length !== 1 ? "s" : ""}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {inr(filteredPayrolls.reduce((s, p) => s + p.salary_amount, 0))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-amber-600">
                          {filteredPayrolls.some((p) => p.advance_deduction > 0)
                            ? `−${inr(filteredPayrolls.reduce((s, p) => s + p.advance_deduction, 0))}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {inr(filteredPayrolls.reduce((s, p) => s + p.net_amount, 0))}
                        </td>
                        <td colSpan={3}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ══ Advances sub-tab ══ */}
          {subTab === "advances" && (
            <div className="space-y-4">
              {advances.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                  No advances recorded for this driver.
                  <br />
                  <button
                    className="mt-2 text-primary hover:underline"
                    onClick={() => setShowAdvanceDialog(true)}
                  >
                    Give first advance →
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {advances.map((adv) => {
                    const pendingDeds = deductions.filter((d) => d.advance_id === adv.id);
                    const isExpanded = expandedAdvances.has(adv.id);
                    return (
                      <div key={adv.id} className="rounded-xl border border-border bg-card">
                        {/* Advance summary row */}
                        <div className="flex w-full items-center gap-2 px-4 py-3">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-4 text-left"
                            onClick={() =>
                              setExpandedAdvances((prev) => {
                                const next = new Set(prev);
                                if (next.has(adv.id)) next.delete(adv.id);
                                else next.add(adv.id);
                                return next;
                              })
                            }
                          >
                            <div className="flex-1 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-3 text-sm">
                                <span className="font-semibold">{inr(adv.amount)}</span>
                                <span className="text-muted-foreground text-xs">
                                  given on {adv.payment_date}
                                </span>
                                {Number(adv.remaining_balance) > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-[10px]"
                                  >
                                    Balance: {inr(adv.remaining_balance)}
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px]"
                                  >
                                    <Check className="size-2.5 mr-0.5" /> Fully recovered
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {inr(adv.monthly_deduction)}/month
                                </span>
                              </div>
                              {adv.note && (
                                <p className="text-xs text-muted-foreground">{adv.note}</p>
                              )}
                            </div>
                            {isExpanded ? (
                              <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                            )}
                          </button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 gap-1.5 text-xs"
                            onClick={() =>
                              selectedDriver &&
                              downloadDriverPaymentReceipt(selectedDriver, {
                                kind: "Advance",
                                amount: adv.amount,
                                date: adv.payment_date,
                                monthlyDeduction: adv.monthly_deduction,
                                remainingBalance: adv.remaining_balance,
                                note: adv.note,
                              })
                            }
                          >
                            <Download className="size-3" /> PDF
                          </Button>
                        </div>

                        {/* Deduction schedule */}
                        {isExpanded && (
                          <div className="border-t border-border px-4 pb-3 pt-2">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Deduction Schedule
                            </p>
                            {pendingDeds.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No schedule entries.</p>
                            ) : (
                              <div className="space-y-1">
                                {pendingDeds.map((d) => (
                                  <ScheduleRow
                                    key={d.id}
                                    deduction={d}
                                    onUpdate={(newAmt) => updateScheduleEntry(d, newAmt)}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ══ Create Payroll Dialog ══ */}
      <Dialog open={showPayrollDialog} onOpenChange={setShowPayrollDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Payroll</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Driver:{" "}
              <span className="font-medium text-foreground">{selectedDriver?.full_name}</span>
            </div>

            {/* Month */}
            <div className="space-y-1.5">
              <Label>Month</Label>
              <Input type="month" value={pMonth} onChange={(e) => setPMonth(e.target.value)} />
              {usedMonths.has(pMonth) && (
                <p className="text-xs text-destructive">
                  Payroll for {monthLabel(pMonth)} already exists.
                </p>
              )}
            </div>

            {/* Salary */}
            <div className="space-y-1.5">
              <Label>
                Salary Amount
                {selectedDriver?.salary_type && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({selectedDriver.salary_type})
                  </span>
                )}
              </Label>
              <Input
                type="number"
                min="0"
                placeholder="0.00"
                value={pSalary}
                onChange={(e) => setPSalary(e.target.value)}
              />
            </div>

            {/* Advance info */}
            {totalAdvanceBalance > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Outstanding advance: {inr(totalAdvanceBalance)}
                </p>
                {scheduledDeductionForMonth(pMonth) > 0 && (
                  <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                    Scheduled deduction for {monthLabel(pMonth)}:{" "}
                    {inr(scheduledDeductionForMonth(pMonth))}
                  </p>
                )}
              </div>
            )}

            {/* Advance deduction */}
            <div className="space-y-1.5">
              <Label>Advance Deduction (optional)</Label>
              <Input
                type="number"
                min="0"
                max={totalAdvanceBalance}
                placeholder="0.00"
                value={pDeduction}
                onChange={(e) => setPDeduction(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Max: {inr(totalAdvanceBalance)}. Capped automatically.
              </p>
            </div>

            {/* Net */}
            <div className="flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Net amount to pay</span>
              <span className="text-lg font-bold text-primary">{inr(pNet)}</span>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Input
                placeholder="Add a note…"
                value={pNote}
                onChange={(e) => setPNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayrollDialog(false)}>
              Cancel
            </Button>
            <Button onClick={createPayroll} disabled={pSaving || usedMonths.has(pMonth)}>
              {pSaving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Generate Payroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ Salary Payment Dialog ══ */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Pay Driver Salary</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {paymentPayroll && <><span className="font-medium text-foreground">{monthLabel(paymentPayroll.month)}</span> · Payable {inr(paymentPayroll.net_amount)}</>}
            </div>
            <div className="space-y-1.5">
              <Label>Pay From Cash/Bank Account</Label>
              <Select value={paymentLedgerId} onValueChange={setPaymentLedgerId}>
                <SelectTrigger><SelectValue placeholder="Select cash or bank account" /></SelectTrigger>
                <SelectContent>{paymentLedgers.map((ledger) => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.ledger_type})</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
            <Button onClick={() => paymentPayroll && void markPaid(paymentPayroll)} disabled={!paymentPayroll || !!payingId}>
              {payingId && <Loader2 className="mr-1.5 size-3.5 animate-spin" />} Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ Give Advance Dialog ══ */}
      <Dialog open={showAdvanceDialog} onOpenChange={setShowAdvanceDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Give Advance</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Driver:{" "}
              <span className="font-medium text-foreground">{selectedDriver?.full_name}</span>
            </div>

            <div className="space-y-1.5">
              <Label>Advance Amount</Label>
              <Input
                type="number"
                min="0"
                placeholder="0.00"
                value={aAmount}
                onChange={(e) => setAAmount(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Payment Date</Label>
              <Input type="date" value={aDate} onChange={(e) => setADate(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Pay From Cash/Bank Account</Label>
              <Select value={aDisbursementLedgerId} onValueChange={setADisbursementLedgerId}>
                <SelectTrigger><SelectValue placeholder="Select cash or bank account" /></SelectTrigger>
                <SelectContent>{paymentLedgers.map((ledger) => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.ledger_type})</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Monthly Deduction Amount</Label>
              <Input
                type="number"
                min="0"
                placeholder="0.00"
                value={aMonthly}
                onChange={(e) => setAMonthly(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                How much to deduct from payroll each month until recovered.
              </p>
            </div>

            {/* Schedule preview */}
            {advanceSchedulePreview.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Deduction schedule preview
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {advanceSchedulePreview.map((row, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{monthLabel(row.month)}</span>
                      <span className="font-medium tabular-nums">−{inr(row.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 border-t border-border pt-2 flex justify-between text-xs font-semibold">
                  <span>
                    {advanceSchedulePreview.length} month
                    {advanceSchedulePreview.length !== 1 ? "s" : ""}
                  </span>
                  <span>{inr(advanceSchedulePreview.reduce((s, r) => s + r.amount, 0))}</span>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Input
                placeholder="Add a note…"
                value={aNote}
                onChange={(e) => setANote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdvanceDialog(false)}>
              Cancel
            </Button>
            <Button onClick={giveAdvance} disabled={aSaving}>
              {aSaving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Record Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Schedule row with inline edit ─────────────────────────────────────────────

function ScheduleRow({
  deduction,
  onUpdate,
}: {
  deduction: Deduction;
  onUpdate: (amount: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(deduction.deduction_amount));
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return;
    setSaving(true);
    await onUpdate(n);
    setSaving(false);
    setEditing(false);
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
        deduction.is_applied
          ? "bg-emerald-50 dark:bg-emerald-950/20"
          : "bg-muted/40 hover:bg-muted/60"
      }`}
    >
      <span className="w-16 shrink-0 text-muted-foreground">{monthLabel(deduction.month)}</span>

      {editing && !deduction.is_applied ? (
        <>
          <Input
            className="h-6 w-20 text-xs py-0 px-1.5"
            type="number"
            min="0"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
          />
          <Button size="sm" className="h-6 px-2 text-[10px]" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="size-2.5 animate-spin" /> : "Save"}
          </Button>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(false)}
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 font-medium tabular-nums">
            −{inr(deduction.deduction_amount)}
          </span>
          {deduction.is_applied ? (
            <Badge
              variant="outline"
              className="h-4 border-emerald-300 bg-transparent text-emerald-700 dark:text-emerald-400 text-[9px] px-1"
            >
              Applied
            </Badge>
          ) : (
            <button
              className="text-primary hover:underline"
              onClick={() => {
                setVal(String(deduction.deduction_amount));
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </>
      )}
    </div>
  );
}
