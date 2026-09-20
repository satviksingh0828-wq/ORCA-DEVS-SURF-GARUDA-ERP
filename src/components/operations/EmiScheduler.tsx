/**
 * EmiScheduler — Vehicle EMI / Loan management tab.
 *
 * Features:
 * - Select a vehicle → purchase amount auto-fills
 * - Enter loan amount → down payment auto-computed
 * - Normal EMI: auto-generate (start date + EMI amount + count) OR with interest (rate + tenure)
 * - Custom EMI: manual rows with due_date & amount per installment
 * - Save → creates emi_schedule + emi_installments + unpaid expenditure entries
 * - Existing schedules listed with mark-paid per installment
 * - Admin-only tab (hidden from basic users)
 */

import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  IndianRupee,
  Loader2,
  Plus,
  CheckCircle2,
  Clock,
  Car,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAll } from "@/lib/fetch-all";
import { inr, num } from "@/lib/trip-calc";
import { addMonthsMonthEndSafe } from "@/lib/emi-schedule";

// ── Types ─────────────────────────────────────────────────────────────────────

type Vehicle = {
  id: string;
  registration_number: string;
  nickname: string | null;
  internal_code: string | null;
  purchase_cost: string | null;
  purchase_date: string | null;
  branch_id: string | null;
};

type PaymentLedger = {
  id: string;
  account_name: string;
  ledger_type: "cash" | "bank";
  branch_id: string;
};

type EmiScheduleRow = {
  id: string;
  vehicle_id: string;
  branch_id: string | null;
  vehicle_label: string;
  loan_amount: number;
  purchase_amount: number | null;
  down_payment: number | null;
  emi_type: string;
  interest_rate: number | null;
  tenure_months: number | null;
  start_date: string | null;
  lender_name: string | null;
  status: string;
  created_at: string;
  installments: EmiInstallmentRow[];
  expanded: boolean;
};

type EmiInstallmentRow = {
  id: string;
  schedule_id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  principal: number | null;
  interest: number | null;
  is_paid: boolean;
  paid_date: string | null;
  expenditure_id: string | null;
};

type CustomRow = { due_date: string; amount: string };

type NormalAuto = { start_date: string; emi_amount: string; num_emis: string };
type NormalInterest = {
  start_date: string;
  annual_rate: string;
  tenure_months: string;
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err !== null) {
    const value = err as { message?: unknown; details?: unknown; hint?: unknown };
    const message = typeof value.message === "string" ? value.message : "";
    const details = typeof value.details === "string" ? value.details : "";
    const hint = typeof value.hint === "string" ? value.hint : "";
    return [message, details, hint].filter(Boolean).join(" — ") || fallback;
  }
  return fallback;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addMonths(dateStr: string, months: number): string {
  return addMonthsMonthEndSafe(dateStr, months);
}

function calcEmi(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 12 / 100;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

type Installment = {
  installment_number: number;
  due_date: string;
  amount: number;
  principal: number | null;
  interest: number | null;
};

function genNormalAuto(inputs: NormalAuto, loanAmt: number): Installment[] {
  const n = parseInt(inputs.num_emis) || 0;
  const emi = parseFloat(inputs.emi_amount) || 0;
  if (!n || !emi || !inputs.start_date) return [];
  return Array.from({ length: n }, (_, i) => ({
    installment_number: i + 1,
    due_date: addMonths(inputs.start_date, i),
    amount: parseFloat(emi.toFixed(2)),
    principal: null,
    interest: null,
  }));
}

function genNormalInterest(inputs: NormalInterest, loanAmt: number): Installment[] {
  const n = parseInt(inputs.tenure_months) || 0;
  const rate = parseFloat(inputs.annual_rate) || 0;
  if (!n || !inputs.start_date) return [];
  const emi = calcEmi(loanAmt, rate, n);
  const r = rate / 12 / 100;
  let balance = loanAmt;
  return Array.from({ length: n }, (_, i) => {
    const interest = parseFloat((balance * r).toFixed(2));
    const principal = parseFloat((emi - interest).toFixed(2));
    balance = parseFloat((balance - principal).toFixed(2));
    return {
      installment_number: i + 1,
      due_date: addMonths(inputs.start_date, i),
      amount: parseFloat(emi.toFixed(2)),
      principal,
      interest,
    };
  });
}

function genCustom(rows: CustomRow[]): Installment[] {
  return rows
    .filter((r) => r.due_date && r.amount)
    .map((r, i) => ({
      installment_number: i + 1,
      due_date: r.due_date,
      amount: parseFloat(r.amount) || 0,
      principal: null,
      interest: null,
    }));
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EmiScheduler() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);
  const [schedules, setSchedules] = useState<EmiScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [loanDisbursementLedgerId, setLoanDisbursementLedgerId] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [lenderName, setLenderName] = useState("");
  const [emiType, setEmiType] = useState<"normal" | "custom">("normal");
  const [normalMode, setNormalMode] = useState<"auto" | "interest">("auto");
  const [normalAuto, setNormalAuto] = useState<NormalAuto>({
    start_date: "",
    emi_amount: "",
    num_emis: "",
  });
  const [normalInterest, setNormalInterest] = useState<NormalInterest>({
    start_date: "",
    annual_rate: "",
    tenure_months: "",
  });
  const [customRows, setCustomRows] = useState<CustomRow[]>([
    { due_date: "", amount: "" },
  ]);

  // Marking paid
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const [paymentLedgerId, setPaymentLedgerId] = useState("");

  // ── Load ─────────────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const [vData, schData, ledgerData] = await Promise.all([
        fetchAll<Vehicle>(() =>
          supabase
            .from("vehicles")
            .select("id,registration_number,nickname,internal_code,purchase_cost,purchase_date,branch_id")
            .order("registration_number"),
        ),
        fetchAll<Record<string, unknown>>(() =>
          supabase
            .from("emi_schedules")
            .select("*")
            .order("created_at", { ascending: false }),
        ),
        fetchAll<PaymentLedger>(() =>
          supabase
            .from("ledger_accounts")
            .select("id,account_name,ledger_type,branch_id")
            .in("ledger_type", ["cash", "bank"])
            .eq("is_active", true)
            .order("account_name"),
        ),
      ]);
      setVehicles(vData);
      setPaymentLedgers(ledgerData);

      // Load installments for all schedules
      const scheduleIds = schData.map((s) => s.id as string);
      let instData: Record<string, unknown>[] = [];
      if (scheduleIds.length > 0) {
        instData = await fetchAll<Record<string, unknown>>(() =>
          supabase
            .from("emi_installments")
            .select("*")
            .in("schedule_id", scheduleIds)
            .order("installment_number"),
        );
      }

      const vehicleMap = new Map(vData.map((v) => [v.id, v]));

      setSchedules(
        schData.map((s) => {
          const v = vehicleMap.get(s.vehicle_id as string);
          const label = v
            ? `${v.registration_number}${v.nickname ? " · " + v.nickname : ""}`
            : "Unknown vehicle";
          return {
            id: s.id as string,
            vehicle_id: s.vehicle_id as string,
            branch_id: (s.branch_id as string) ?? null,
            vehicle_label: label,
            loan_amount: Number(s.loan_amount),
            purchase_amount: s.purchase_amount != null ? Number(s.purchase_amount) : null,
            down_payment: s.down_payment != null ? Number(s.down_payment) : null,
            emi_type: s.emi_type as string,
            interest_rate: s.interest_rate != null ? Number(s.interest_rate) : null,
            tenure_months: s.tenure_months != null ? Number(s.tenure_months) : null,
            start_date: (s.start_date as string) ?? null,
            lender_name: (s.lender_name as string) ?? null,
            status: s.status as string,
            created_at: s.created_at as string,
            installments: instData
              .filter((inst) => inst.schedule_id === s.id)
              .map((inst) => ({
                id: inst.id as string,
                schedule_id: inst.schedule_id as string,
                installment_number: Number(inst.installment_number),
                due_date: inst.due_date as string,
                amount: Number(inst.amount),
                principal: inst.principal != null ? Number(inst.principal) : null,
                interest: inst.interest != null ? Number(inst.interest) : null,
                is_paid: Boolean(inst.is_paid),
                paid_date: (inst.paid_date as string) ?? null,
                expenditure_id: (inst.expenditure_id as string) ?? null,
              })),
            expanded: false,
          };
        }),
      );
    } catch {
      toast.error("Could not load EMI data");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────────

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const purchaseCost = selectedVehicle?.purchase_cost
    ? parseFloat(selectedVehicle.purchase_cost)
    : null;
  const loanAmt = parseFloat(loanAmount) || 0;
  const downPayment = purchaseCost != null && loanAmt > 0 ? purchaseCost - loanAmt : null;

  const previewInstallments = useMemo<Installment[]>(() => {
    if (!loanAmt) return [];
    const generated =
      emiType === "custom"
        ? genCustom(customRows)
        : normalMode === "auto"
          ? genNormalAuto(normalAuto, loanAmt)
          : genNormalInterest(normalInterest, loanAmt);
    if (generated.length === 0) return generated;

    const totalInterestForFlatSchedule = Math.max(
      0,
      generated.reduce((sum, item) => sum + item.amount, 0) - loanAmt,
    );
    const regularInterest = Number((totalInterestForFlatSchedule / generated.length).toFixed(2));
    let principalAllocated = 0;
    return generated.map((item, index) => {
      const principal =
        index === generated.length - 1
          ? Number((loanAmt - principalAllocated).toFixed(2))
          : Number((item.amount - regularInterest).toFixed(2));
      const interest = Number((item.amount - principal).toFixed(2));
      principalAllocated += principal;
      return { ...item, principal, interest };
    });
  }, [emiType, normalMode, normalAuto, normalInterest, customRows, loanAmt]);

  const totalEmi = previewInstallments.reduce((s, i) => s + i.amount, 0);
  const totalInterest = totalEmi - loanAmt;
  const effectiveRate =
    emiType === "normal" && normalMode === "interest"
      ? parseFloat(normalInterest.annual_rate) || 0
      : null;

  // ── Save ──────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!vehicleId) { toast.error("Select a vehicle"); return; }
    if (!loanAmt) { toast.error("Enter loan amount"); return; }
    if (!loanDisbursementLedgerId) { toast.error("Select the cash or bank account used for loan disbursement"); return; }
    if (!selectedVehicle?.purchase_date) { toast.error("Vehicle purchase date is required before creating a loan schedule"); return; }
    if (previewInstallments.length === 0) {
      toast.error("No installments to save — fill in EMI details");
      return;
    }
    if (totalInterest < -0.01) { toast.error("Total EMI amount cannot be less than the loan amount"); return; }

    setSaving(true);
    try {
      const rate =
        emiType === "normal" && normalMode === "interest"
          ? parseFloat(normalInterest.annual_rate) || null
          : null;
      const tenure =
        emiType === "normal" && normalMode === "interest"
          ? parseInt(normalInterest.tenure_months) || null
          : emiType === "normal" && normalMode === "auto"
            ? parseInt(normalAuto.num_emis) || null
            : null;
      const startDate =
        emiType === "normal"
          ? normalMode === "auto"
            ? normalAuto.start_date || null
            : normalInterest.start_date || null
          : previewInstallments[0]?.due_date ?? null;

      // Insert emi_schedule
      const { data: schedData, error: schedErr } = await supabase
        .from("emi_schedules")
        .insert({
          vehicle_id: vehicleId,
          branch_id: selectedVehicle?.branch_id ?? null,
          loan_disbursement_ledger_id: loanDisbursementLedgerId,
          loan_amount: loanAmt,
          purchase_amount: purchaseCost ?? null,
          down_payment: downPayment ?? null,
          emi_type: emiType,
          interest_rate: rate,
          tenure_months: tenure,
          start_date: startDate,
          lender_name: lenderName || null,
          status: "active",
        })
        .select("id")
        .single();

      if (schedErr || !schedData) throw schedErr ?? new Error("Schedule insert failed");

      const scheduleId = schedData.id;

      // Insert installments + expenditures
      for (const inst of previewInstallments) {
        // Create unpaid expenditure
        const expName = `EMI #${inst.installment_number} — ${selectedVehicle?.registration_number ?? ""} (${scheduleId.slice(0, 6)})`;
        const { data: expData, error: expErr } = await supabase
          .from("expenditures")
          .insert({
            expenditure_name: expName,
            amount: String(inst.amount),
            entry_date: inst.due_date,
            note: lenderName ? `Lender: ${lenderName}` : null,
            vehicle_id: vehicleId,
            branch_id: selectedVehicle?.branch_id ?? null,
            is_paid: false,
            is_emi: true,
          })
          .select("id")
          .single();

        if (expErr || !expData) throw expErr ?? new Error("Expenditure insert failed");

        // Create installment (with expenditure link)
        const { data: instData, error: instErr } = await supabase
          .from("emi_installments")
          .insert({
            schedule_id: scheduleId,
            installment_number: inst.installment_number,
            due_date: inst.due_date,
            amount: inst.amount,
            principal: inst.principal ?? null,
            interest: inst.interest ?? null,
            is_paid: false,
            expenditure_id: expData.id,
          })
          .select("id")
          .single();

        if (instErr || !instData) throw instErr ?? new Error("Installment insert failed");

        // Update expenditure with installment link
        await supabase
          .from("expenditures")
          .update({ emi_installment_id: instData.id })
          .eq("id", expData.id);
      }

      toast.success(`EMI schedule created — ${previewInstallments.length} installments added`);

      // Reset form
      setShowForm(false);
      setVehicleId("");
      setLoanDisbursementLedgerId("");
      setLoanAmount("");
      setLenderName("");
      setEmiType("normal");
      setNormalMode("auto");
      setNormalAuto({ start_date: "", emi_amount: "", num_emis: "" });
      setNormalInterest({ start_date: "", annual_rate: "", tenure_months: "" });
      setCustomRows([{ due_date: "", amount: "" }]);

      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save EMI schedule"));
    }
    setSaving(false);
  }

  // ── Mark Paid ─────────────────────────────────────────────────────────────────

  async function handleMarkPaid(scheduleId: string, inst: EmiInstallmentRow) {
    if (!paymentLedgerId) {
      toast.error("Select the cash or bank account used for this EMI payment");
      return;
    }
    setMarkingPaid(inst.id);
    try {
      const { error } = await supabase.rpc("tms_mark_vehicle_emi_paid", {
        p_installment_id: inst.id,
        p_payment_ledger_id: paymentLedgerId,
      });
      if (error) throw error;

      toast.success(`EMI #${inst.installment_number} marked as paid`);
      setPaymentLedgerId("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark as paid");
    }
    setMarkingPaid(null);
  }

  function toggleExpand(id: string) {
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, expanded: !s.expanded } : s)),
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div />
        <Button onClick={() => setShowForm((v) => !v)} size="sm" variant={showForm ? "outline" : "default"}>
          {showForm ? "Cancel" : <><Plus className="size-4" /> New EMI Schedule</>}
        </Button>
      </div>

      {/* ── Create Form ───────────────────────────────────────────────────── */}
      {showForm && (
        <div className="surface-card space-y-6 p-6">
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <IndianRupee className="size-4 text-primary" />
            Create EMI Schedule
          </h3>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {/* Vehicle */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Vehicle *</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.registration_number}
                      {v.nickname ? ` · ${v.nickname}` : ""}
                      {v.internal_code ? ` [${v.internal_code}]` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Lender name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Lender / Bank</Label>
              <Input
                placeholder="e.g. HDFC Bank"
                value={lenderName}
                onChange={(e) => setLenderName(e.target.value)}
              />
            </div>
          </div>

          {selectedVehicle && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Loan Disbursed To *</Label>
              <select
                value={loanDisbursementLedgerId}
                required
                onChange={(e) => setLoanDisbursementLedgerId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select cash or bank account</option>
                {paymentLedgers
                  .filter((ledger) => ledger.branch_id === selectedVehicle.branch_id)
                  .map((ledger) => (
                    <option key={ledger.id} value={ledger.id}>
                      {ledger.account_name} ({ledger.ledger_type})
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                The selected account is debited on the vehicle purchase date and Vehicle Loan is credited.
              </p>
            </div>
          )}

          {/* Purchase cost (read-only) */}
          {selectedVehicle && (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  Purchase Amount
                </p>
                <p className="text-lg font-bold">
                  {purchaseCost != null ? inr(purchaseCost) : <span className="text-muted-foreground text-sm">Not set on vehicle</span>}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  Loan Amount *
                </p>
                <Input
                  type="number"
                  min={0}
                  placeholder="0.00"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(e.target.value)}
                  className="h-9 font-semibold"
                />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  Down Payment (auto)
                </p>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {downPayment != null ? inr(downPayment) : "—"}
                </p>
              </div>
            </div>
          )}

          {!selectedVehicle && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Loan Amount *</Label>
              <Input
                type="number"
                min={0}
                placeholder="0.00"
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value)}
              />
            </div>
          )}

          {/* EMI Type */}
          <div className="space-y-3">
            <Label className="text-xs font-medium text-muted-foreground">EMI Type *</Label>
            <div className="flex gap-3">
              {(["normal", "custom"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEmiType(t)}
                  className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                    emiType === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {t === "normal" ? "Normal EMI" : "Custom EMI"}
                  <p className="mt-0.5 text-[11px] font-normal opacity-70">
                    {t === "normal" ? "All installments same amount" : "Each installment different"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Normal EMI inputs */}
          {emiType === "normal" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                {(["auto", "interest"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setNormalMode(m)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      normalMode === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "auto" ? "Start date + amount + count" : "With interest rate"}
                  </button>
                ))}
              </div>

              {normalMode === "auto" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Start Date *</Label>
                    <Input
                      type="date"
                      value={normalAuto.start_date}
                      onChange={(e) => setNormalAuto((p) => ({ ...p, start_date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">EMI Amount (₹) *</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="0.00"
                      value={normalAuto.emi_amount}
                      onChange={(e) => setNormalAuto((p) => ({ ...p, emi_amount: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Number of EMIs *</Label>
                    <Input
                      type="number"
                      min={1}
                      max={360}
                      placeholder="e.g. 36"
                      value={normalAuto.num_emis}
                      onChange={(e) => setNormalAuto((p) => ({ ...p, num_emis: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              {normalMode === "interest" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Start Date *</Label>
                    <Input
                      type="date"
                      value={normalInterest.start_date}
                      onChange={(e) =>
                        setNormalInterest((p) => ({ ...p, start_date: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Annual Interest Rate (%) *</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="e.g. 9.5"
                      value={normalInterest.annual_rate}
                      onChange={(e) =>
                        setNormalInterest((p) => ({ ...p, annual_rate: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Tenure (months) *</Label>
                    <Input
                      type="number"
                      min={1}
                      max={360}
                      placeholder="e.g. 60"
                      value={normalInterest.tenure_months}
                      onChange={(e) =>
                        setNormalInterest((p) => ({ ...p, tenure_months: e.target.value }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Custom EMI inputs */}
          {emiType === "custom" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Installment Schedule</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCustomRows((p) => [...p, { due_date: "", amount: "" }])
                  }
                >
                  <Plus className="size-3.5" /> Add Row
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-10">#</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Due Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customRows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="date"
                            value={row.due_date}
                            className="h-8"
                            onChange={(e) =>
                              setCustomRows((p) =>
                                p.map((r, j) => (j === i ? { ...r, due_date: e.target.value } : r)),
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            placeholder="0.00"
                            value={row.amount}
                            className="h-8"
                            onChange={(e) =>
                              setCustomRows((p) =>
                                p.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Preview */}
          {previewInstallments.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 rounded-xl bg-muted/40 px-4 py-3 text-sm flex-wrap">
                <span className="font-medium">{previewInstallments.length} installments</span>
                <span className="text-muted-foreground">·</span>
                <span>Total: <strong>{inr(totalEmi)}</strong></span>
                {loanAmt > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span>
                      Interest: <strong className="text-amber-600 dark:text-amber-400">{inr(totalInterest)}</strong>
                    </span>
                    {effectiveRate != null && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span>Rate: <strong>{effectiveRate}% p.a.</strong></span>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border border-border max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Due Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">EMI Amount</th>
                      {previewInstallments[0]?.principal != null && (
                        <>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Principal</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Interest</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {previewInstallments.map((inst) => (
                      <tr key={inst.installment_number} className="border-t border-border hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground">{inst.installment_number}</td>
                        <td className="px-3 py-2">{inst.due_date}</td>
                        <td className="px-3 py-2 text-right font-medium">{inr(inst.amount)}</td>
                        {inst.principal != null && (
                          <>
                            <td className="px-3 py-2 text-right text-muted-foreground">{inr(inst.principal)}</td>
                            <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">{inr(inst.interest ?? 0)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
              Save Schedule
            </Button>
          </div>
        </div>
      )}

      {/* ── Existing Schedules ─────────────────────────────────────────────────── */}
      {schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-16 text-center">
          <Car className="size-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No EMI schedules yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first schedule using the button above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((sched) => {
            const paid = sched.installments.filter((i) => i.is_paid).length;
            const total = sched.installments.length;
            const paidAmt = sched.installments.filter((i) => i.is_paid).reduce((s, i) => s + i.amount, 0);
            const pendingAmt = sched.installments.filter((i) => !i.is_paid).reduce((s, i) => s + i.amount, 0);
            const nextDue = sched.installments.find((i) => !i.is_paid);

            return (
              <div key={sched.id} className="surface-card overflow-hidden">
                {/* Schedule header */}
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => toggleExpand(sched.id)}
                    className="flex-1 flex items-center gap-4 p-5 text-left hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-sm truncate">{sched.vehicle_label}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            sched.status === "active"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {sched.status}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {sched.emi_type === "normal" ? "Normal EMI" : "Custom EMI"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Loan: <strong className="text-foreground">{inr(sched.loan_amount)}</strong></span>
                        {sched.interest_rate && (
                          <span>Rate: <strong className="text-foreground">{sched.interest_rate}%</strong></span>
                        )}
                        {sched.lender_name && <span>{sched.lender_name}</span>}
                        <span className="text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3 inline mr-0.5" />{paid}/{total} paid
                        </span>
                        {nextDue && (
                          <span className="text-amber-600 dark:text-amber-400">
                            <Clock className="size-3 inline mr-0.5" />Next: {nextDue.due_date}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">Pending</p>
                      <p className="font-bold text-sm text-amber-600 dark:text-amber-400">{inr(pendingAmt)}</p>
                    </div>
                    {sched.expanded ? (
                      <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-muted">
                  <div
                    className="h-1 bg-emerald-500 transition-all"
                    style={{ width: total > 0 ? `${(paid / total) * 100}%` : "0%" }}
                  />
                </div>

                {/* Installments table */}
                {sched.expanded && (
                  <div className="border-t border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">#</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Due Date</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Amount</th>
                          {sched.installments.some((i) => i.principal != null) && (
                            <>
                              <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Principal</th>
                              <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Interest</th>
                            </>
                          )}
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                          <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sched.installments.map((inst) => (
                          <tr
                            key={inst.id}
                            className={`border-t border-border ${inst.is_paid ? "opacity-60" : ""}`}
                          >
                            <td className="px-4 py-2.5 text-muted-foreground">{inst.installment_number}</td>
                            <td className="px-4 py-2.5">{inst.due_date}</td>
                            <td className="px-4 py-2.5 text-right font-medium">{inr(inst.amount)}</td>
                            {sched.installments.some((i) => i.principal != null) && (
                              <>
                                <td className="px-4 py-2.5 text-right text-muted-foreground">
                                  {inst.principal != null ? inr(inst.principal) : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-right text-amber-600 dark:text-amber-400">
                                  {inst.interest != null ? inr(inst.interest) : "—"}
                                </td>
                              </>
                            )}
                            <td className="px-4 py-2.5">
                              {inst.is_paid ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                  <CheckCircle2 className="size-3.5" /> Paid {inst.paid_date ?? ""}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                                  <Clock className="size-3.5" /> Pending
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {!inst.is_paid && (
                                <div className="flex min-w-56 items-center justify-end gap-2">
                                  <select
                                    value={paymentLedgerId}
                                    onChange={(e) => setPaymentLedgerId(e.target.value)}
                                    className="h-7 max-w-40 rounded-md border border-input bg-background px-2 text-[11px]"
                                  >
                                    <option value="">Paid from...</option>
                                    {paymentLedgers
                                      .filter((ledger) => ledger.branch_id === sched.branch_id)
                                      .map((ledger) => (
                                        <option key={ledger.id} value={ledger.id}>
                                          {ledger.account_name} ({ledger.ledger_type})
                                        </option>
                                      ))}
                                  </select>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={markingPaid === inst.id || !paymentLedgerId}
                                    onClick={() => handleMarkPaid(sched.id, inst)}
                                  >
                                    {markingPaid === inst.id ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="size-3 text-emerald-600" />
                                    )}
                                    Mark Paid
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-medium">
                          <td colSpan={2} className="px-4 py-2.5 text-xs text-muted-foreground">
                            Totals
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">
                            {inr(sched.installments.reduce((s, i) => s + i.amount, 0))}
                          </td>
                          {sched.installments.some((i) => i.principal != null) && (
                            <>
                              <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                                {inr(sched.installments.reduce((s, i) => s + (i.principal ?? 0), 0))}
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs text-amber-600 dark:text-amber-400">
                                {inr(sched.installments.reduce((s, i) => s + (i.interest ?? 0), 0))}
                              </td>
                            </>
                          )}
                          <td colSpan={2} className="px-4 py-2.5 text-xs">
                            <span className="text-emerald-600 dark:text-emerald-400 mr-3">
                              Paid: {inr(paidAmt)}
                            </span>
                            <span className="text-amber-600 dark:text-amber-400">
                              Pending: {inr(pendingAmt)}
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
