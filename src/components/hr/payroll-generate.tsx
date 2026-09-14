import { useMemo, useState } from 'react';
import { Download, Trash2, Wallet, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  useEmployees, useDepartments, useAllPositions, useHolidays,
  useAllAttendance, usePayrolls, useCreatePayroll, useDeletePayroll,
  useLoans, useAdvances, useLossDeductions, useUpdateLossDeduction, useAppSettings,
  useAllLoanInstallments, useAllAdvanceInstallments,
  useMarkLoanInstallmentPayroll, useMarkAdvanceInstallmentPayroll, useIncentiveAmounts,
} from '@/lib/hooks';
import { fullName, effectivePaymentStatus } from '@/lib/types';
import type { Employee, PayrollInput, Loan, Advance, LossDeduction, Payroll, LoanInstallment, AdvanceInstallment } from '@/lib/types';
import { computePayroll, halfMonthPeriods, monthPeriod, loanRemaining } from '@/lib/payroll-utils';
import { ymd, parseYmd } from '@/lib/attendance-utils';
import { exportPayrollPdf, getPayrollPdfBase64 } from '@/lib/payroll-pdf';
import { sendPayrollEmail } from '@/lib/payroll-email';
import { isWaConnected, sendWaPdf, normalizeWaNumber } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';

function money(n: number) {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PAYMENT_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  generated:    { label: 'Generated — Payment pending', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  paid:         { label: 'Paid', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' },
  partial_paid: { label: 'Partially paid', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300' },
};

type GenerateCalculationPreview = {
  c: {
    gross: number; perDay: number; calendarDaysInMonth: number; payableDates: number;
    workingDays: number; present: number; extraWorkDays: number;
    paidLeavesUsedThisPeriod: number; paidLeavesLeftAfter: number;
    unpaidLeavesThisPeriod: number; unpaidLeaveDeduction: number; paidLeavePayout: number; extraWorkPay: number;
  };
  pf: number; tax: number; loanDed: number; advDed: number; lossDed: number; incentiveAmount: number; net: number;
};

function GenerateCalculationDialog({ emp, preview, period, onClose }: { emp: Employee; preview: GenerateCalculationPreview; period: { label: string }; onClose: () => void }) {
  const Row = ({ label, value, className = '', raw = false }: { label: string; value: number; className?: string; raw?: boolean }) => (
    <div className={`flex items-start justify-between gap-4 border-b py-2 last:border-0 ${className}`}>
      <span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{raw ? Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : money(value)}</span>
    </div>
  );
  const monthlyGross = Number(emp.basic_salary) + Number(emp.hra) + Number(emp.travel_allowance) + Number(emp.special_allowance) + Number(emp.other_allowance);
  const totalEarnings = preview.c.gross + preview.incentiveAmount;
  const totalDeductions = preview.pf + preview.tax + preview.c.unpaidLeaveDeduction + preview.loanDed + preview.advDed + preview.lossDed;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-background p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Payroll Calculation</h2><p className="text-xs text-muted-foreground">{fullName(emp)} · {period.label}</p></div><Button variant="outline" size="sm" onClick={onClose}>Close</Button></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-3"><div className="mb-1 font-semibold">Step 1 — Gross salary</div><p className="mb-2 text-xs text-muted-foreground">Basic salary plus all configured allowances.</p><Row label="Basic salary" value={Number(emp.basic_salary)} /><Row label="HRA" value={Number(emp.hra)} /><Row label="Travel allowance" value={Number(emp.travel_allowance)} /><Row label="Special allowance" value={Number(emp.special_allowance)} /><Row label="Other allowance" value={Number(emp.other_allowance)} /><Row label="Monthly gross salary" value={monthlyGross} className="font-semibold" /></div>
          <div className="rounded-lg border p-3"><div className="mb-1 font-semibold">Step 2 — Payable dates</div><p className="mb-2 text-xs text-muted-foreground">Dates are counted uniquely, so a weekly off, holiday, leave, or extra-work date is never counted twice.</p><Row label={`Calendar days in month (${preview.c.calendarDaysInMonth})`} value={preview.c.calendarDaysInMonth} raw /><Row label="Daily salary rate" value={preview.c.perDay} /><Row label="Department working days" value={preview.c.workingDays} raw /><Row label="Unique payable salary days" value={preview.c.payableDates} raw /><Row label="Gross salary for period" value={preview.c.gross} className="font-semibold" /></div>
          <div className="rounded-lg border p-3"><div className="mb-1 font-semibold">Step 3 — Leave calculation</div><Row label="Paid leave used" value={preview.c.paidLeavesUsedThisPeriod} raw /><Row label="Paid leave balance after payroll" value={preview.c.paidLeavesLeftAfter} raw /><Row label="Unpaid leave" value={preview.c.unpaidLeavesThisPeriod} raw /><Row label="Unpaid Leave Deduction" value={preview.c.unpaidLeaveDeduction} className="font-semibold text-destructive" /><Row label="Paid Leave Payout" value={preview.c.paidLeavePayout} /></div>
          <div className="rounded-lg border p-3"><div className="mb-1 font-semibold">Step 4 — Other earnings</div><Row label={`Extra Work Day Payout (${preview.c.extraWorkDays} days)`} value={preview.c.extraWorkPay} /><Row label="Pending incentive" value={preview.incentiveAmount} /><Row label="Total earnings" value={totalEarnings} className="font-semibold" /></div>
          <div className="rounded-lg border p-3 sm:col-span-2"><div className="mb-1 font-semibold">Step 5 — Deductions and net salary</div><div className="grid gap-x-6 sm:grid-cols-2"><Row label="PF" value={preview.pf} /><Row label="Tax" value={preview.tax} /><Row label="Loan EMI" value={preview.loanDed} /><Row label="Advance EMI" value={preview.advDed} /><Row label="Loss deduction" value={preview.lossDed} /><Row label="Unpaid Leave Deduction" value={preview.c.unpaidLeaveDeduction} /></div><div className="mt-3 border-t pt-3"><p className="text-sm">{money(totalEarnings)} earnings − {money(totalDeductions)} deductions</p><div className={`mt-2 flex justify-between text-lg font-bold ${preview.net < 0 ? 'text-destructive' : ''}`}><span>Net salary</span><span>{money(preview.net)}</span></div></div></div>
        </div>
      </div>
    </div>
  );
}

export function PayrollGenerate() {
  const now = new Date();
  const { data: employees, isLoading: le } = useEmployees();
  const { data: departments } = useDepartments();
  const { data: positions } = useAllPositions();
  const { data: holidays } = useHolidays();
  const { data: allAttendance } = useAllAttendance();
  const { data: loans } = useLoans();
  const { data: advances } = useAdvances();
  const { data: deductions } = useLossDeductions();
  const { data: settings } = useAppSettings();
  const { data: allLoanInst } = useAllLoanInstallments();
  const { data: allAdvInst } = useAllAdvanceInstallments();

  const [empId, setEmpId] = useState<string>('');
  const [calculationOpen, setCalculationOpen] = useState(false);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth());
  const [periodType, setPeriodType] = useState<'month' | 'half_month'>('month');
  const [half, setHalf] = useState<'first' | 'second'>('first');
  const { data: incentiveAmounts } = useIncentiveAmounts(empId || undefined);

  const emp = useMemo(() => (employees ?? []).find(e => e.id === empId) ?? null, [employees, empId]);
  const dept = emp && departments ? departments.find(d => d.id === emp.department_id) ?? null : null;
  const position = emp && positions ? positions.find(p => p.id === emp.position_id) ?? null : null;
  const { data: history, isLoading: lh } = usePayrolls(empId || undefined);
  const create = useCreatePayroll();
  const del = useDeletePayroll();
  const updDed = useUpdateLossDeduction();
  const markLoanInstPayroll = useMarkLoanInstallmentPayroll();
  const markAdvInstPayroll = useMarkAdvanceInstallmentPayroll();

  const period = useMemo(() => {
    if (periodType === 'month') {
      const { from, to } = monthPeriod(year, month);
      return { from, to, label: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
    }
    const hs = halfMonthPeriods(year, month);
    const p = half === 'first' ? hs[0] : hs[1];
    return { from: p.from, to: p.to, label: `${p.label} of ${p.from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}` };
  }, [periodType, half, year, month]);

  const periodYear  = period.from.getFullYear();
  const periodMonth = period.from.getMonth();

  const outsideEmployment = useMemo(() => {
    if (!emp) return null as null | string;
    const j = new Date(emp.joining_date);
    if (period.to < j) return 'Employee had not joined during this period';
    if (emp.date_of_leaving) {
      const l = new Date(emp.date_of_leaving);
      if (period.from > l) return 'Employee had already left before this period';
    }
    return null;
  }, [emp, period]);

  const isJoiningPeriod = useMemo(() => {
    if (!emp) return false;
    const j = new Date(emp.joining_date);
    return j >= period.from && j <= period.to;
  }, [emp, period]);

  const isLeavingPeriod = useMemo(() => {
    if (!emp || !emp.date_of_leaving) return false;
    const l = new Date(emp.date_of_leaving);
    return l >= period.from && l <= period.to;
  }, [emp, period]);

  const halfMonthBlocked = useMemo(() => {
    if (periodType !== 'half_month' || !emp) return null;
    if (isJoiningPeriod || isLeavingPeriod) return null;
    const j = new Date(emp.joining_date);
    const jLabel = j.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const lLabel = emp.date_of_leaving
      ? new Date(emp.date_of_leaving).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : null;
    return `Half-month payroll is only allowed in ${emp.first_name}'s joining month (${jLabel})${lLabel ? ` or leaving month (${lLabel})` : ''}. Use full month for regular periods.`;
  }, [periodType, emp, isJoiningPeriod, isLeavingPeriod]);

  const lastPayroll = useMemo<Payroll | null>(() => {
    const list = (history ?? []).filter(p => parseYmd(p.period_end) < period.from);
    if (!list.length) return null;
    return list.slice().sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  }, [history, period]);

  const activeLoans    = useMemo(() => (loans ?? []).filter(l => l.employee_id === empId && l.status === 'active'), [loans, empId]);
  const activeAdvances = useMemo(() => (advances ?? []).filter(a => a.employee_id === empId && a.status === 'active'), [advances, empId]);
  const pendingDeds    = useMemo(() => (deductions ?? []).filter(d => d.employee_id === empId && d.status === 'pending'), [deductions, empId]);

  // ── Period-wise installment lookup ──────────────────────────────────────────
  /**
   * For each loan, find the installment for the current period month/year.
   * Handles partial payments: if paid_partial_manual, deduct only the remaining balance.
   * On leaving period: all pending/partial installments are charged.
   */
  const loanEmiAmount = useMemo(() => (l: Loan): number => {
    const insts = (allLoanInst ?? []).filter(i => i.loan_id === l.id);
    if (isLeavingPeriod) {
      return insts
        .filter(i => i.status === 'pending' || i.status === 'paid_partial_manual')
        .reduce((s, i) => {
          if (i.status === 'paid_partial_manual') {
            return s + Math.max(0, Number(i.amount) - Number(i.paid_amount || 0));
          }
          return s + Number(i.amount);
        }, 0);
    }
    // Payroll-partial-skipped takes priority (only the payroll portion is deducted; rest deferred to tail)
    const payrollSkipInst = insts.find(i =>
      i.due_year === periodYear && i.due_month === periodMonth && i.status === 'payroll_partial_skipped'
    );
    if (payrollSkipInst) return Number(payrollSkipInst.paid_amount || 0);
    // Partial payment takes priority over pending
    const partialInst = insts.find(i =>
      i.due_year === periodYear && i.due_month === periodMonth && i.status === 'paid_partial_manual'
    );
    if (partialInst) return Math.max(0, Number(partialInst.amount) - Number(partialInst.paid_amount || 0));
    const inst = insts.find(i => i.due_year === periodYear && i.due_month === periodMonth && i.status === 'pending');
    return inst ? Number(inst.amount) : 0;
  }, [allLoanInst, isLeavingPeriod, periodYear, periodMonth]);

  const advEmiAmount = useMemo(() => (a: Advance): number => {
    const insts = (allAdvInst ?? []).filter(i => i.advance_id === a.id);
    if (isLeavingPeriod) {
      return insts
        .filter(i => i.status === 'pending' || i.status === 'paid_partial_manual')
        .reduce((s, i) => {
          if (i.status === 'paid_partial_manual') {
            return s + Math.max(0, Number(i.amount) - Number(i.paid_amount || 0));
          }
          return s + Number(i.amount);
        }, 0);
    }
    const advPayrollSkipInst = insts.find(i =>
      i.due_year === periodYear && i.due_month === periodMonth && i.status === 'payroll_partial_skipped'
    );
    if (advPayrollSkipInst) return Number(advPayrollSkipInst.paid_amount || 0);
    const partialInst = insts.find(i =>
      i.due_year === periodYear && i.due_month === periodMonth && i.status === 'paid_partial_manual'
    );
    if (partialInst) return Math.max(0, Number(partialInst.amount) - Number(partialInst.paid_amount || 0));
    const inst = insts.find(i => i.due_year === periodYear && i.due_month === periodMonth && i.status === 'pending');
    return inst ? Number(inst.amount) : 0;
  }, [allAdvInst, isLeavingPeriod, periodYear, periodMonth]);

  const preview = useMemo(() => {
    if (!emp) return null;
    const c = computePayroll(
      emp, dept, holidays ?? [], allAttendance ?? [],
      period.from, period.to, periodType, lastPayroll, isLeavingPeriod,
    );

    const loanDed = activeLoans.reduce((s, l) => s + loanEmiAmount(l), 0);
    const advDed  = activeAdvances.reduce((s, a) => s + advEmiAmount(a), 0);
    const lossDed = pendingDeds.reduce((s, d) => s + Number(d.amount), 0);
    const incentiveAmount = (incentiveAmounts ?? []).filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.amount), 0);

    const n      = (v: number | string) => Number(v) || 0;
    const halfF  = periodType === 'half_month' ? 0.5 : 1;
    const pf     = n(emp.pf_deduction)  * halfF * c.joinLeaveFactor;
    const tax    = n(emp.tax_deduction) * halfF * c.joinLeaveFactor;
    const totalDed = pf + tax + loanDed + advDed + lossDed + c.unpaidLeaveDeduction;
    const net = c.gross + incentiveAmount - totalDed;

    return { c, loanDed, advDed, lossDed, incentiveAmount, pf, tax, net };
  }, [emp, dept, holidays, allAttendance, period, periodType, activeLoans, activeAdvances,
    pendingDeds, isLeavingPeriod, lastPayroll, loanEmiAmount, advEmiAmount, incentiveAmounts]);

  const alreadyGenerated = useMemo(
    () => (history ?? []).some(p => p.period_start === ymd(period.from) && p.period_end === ymd(period.to)),
    [history, period],
  );

  /** Existing saved payroll for the selected period — used to show snapshotted values when alreadyGenerated */
  const existingPayroll = useMemo(
    () => (history ?? []).find(p => p.period_start === ymd(period.from) && p.period_end === ymd(period.to)) ?? null,
    [history, period],
  );

  // Check partial EMI details for display
  const partialEmiInfo = useMemo(() => {
    if (!allLoanInst || !allAdvInst) return { loanPartials: 0, advPartials: 0 };
    const loanPartials = activeLoans.filter(l => {
      const insts = allLoanInst.filter(i => i.loan_id === l.id);
      return insts.some(i => i.due_year === periodYear && i.due_month === periodMonth && i.status === 'paid_partial_manual');
    }).length;
    const advPartials = activeAdvances.filter(a => {
      const insts = allAdvInst.filter(i => i.advance_id === a.id);
      return insts.some(i => i.due_year === periodYear && i.due_month === periodMonth && i.status === 'paid_partial_manual');
    }).length;
    return { loanPartials, advPartials };
  }, [activeLoans, activeAdvances, allLoanInst, allAdvInst, periodYear, periodMonth]);

  const generate = async () => {
    if (!emp || !preview) return;
    if (outsideEmployment) { toast.error(outsideEmployment); return; }
    if (alreadyGenerated)  { toast.error('Payroll for this period already exists'); return; }

    const { c, loanDed, advDed, lossDed, incentiveAmount, pf, tax, net } = preview;
    if (net < 0) {
      const confirmed = window.confirm(
        `⚠️ Warning: Net pay is negative (${money(net)}).\n\n` +
        `Total deductions exceed gross earnings for this period. ` +
        `This usually means loans, advances, or loss deductions are larger than the salary.\n\n` +
        `The payroll will be saved with a negative net. You should review the deductions before proceeding.\n\n` +
        `Click OK to save anyway, or Cancel to go back and adjust.`
      );
      if (!confirmed) return;
    }

    const halfF = periodType === 'half_month' ? 0.5 : 1;
    const scale = c.calendarDaysInMonth > 0 ? c.payableDates / c.calendarDaysInMonth : 0;
    const n = (v: number | string) => Number(v) || 0;

    const values: PayrollInput = {
      employee_id:               emp.id,
      period_start:              ymd(period.from),
      period_end:                ymd(period.to),
      period_type:               periodType,
      basic_salary:              n(emp.basic_salary)        * scale,
      hra:                       n(emp.hra)                 * scale,
      travel_allowance:          n(emp.travel_allowance)    * scale,
      special_allowance:         n(emp.special_allowance)   * scale,
      other_allowance:           n(emp.other_allowance)     * scale,
      gross:                     c.gross,
      pf_deduction:              pf,
      tax_deduction:             tax,
      loan_deduction:            loanDed,
      advance_deduction:         advDed,
      loss_deduction:            lossDed,
      unpaid_leave_deduction:    c.unpaidLeaveDeduction,
      paid_leave_payout_amount:  c.paidLeavePayout,
      extra_work_days:           c.extraWorkDays,
      extra_work_pay:            c.extraWorkPay,
      incentive_amount:         incentiveAmount,
      net,
      working_days:              c.workingDays,
      present_days:              c.present,
      paid_leaves_used:          c.paidLeavesUsedThisPeriod,
      paid_leaves_left:          c.paidLeavesLeftAfter,
      unpaid_leaves:             c.unpaidLeavesThisPeriod,
      unpaid_leave_deduction_rate: 0,
      paid_leave_payout_rate:    0,
      // Payment status: generated — salary not disbursed yet
      payment_status: 'generated',
      payment_date:   null,
      payment_amount: null,
      notes: null,
    };

    try {
      const created = await create.mutateAsync(values);

      const pdfOpts = {
        payroll: created, employee: emp, department: dept, position, settings,
        loans: activeLoans, advances: activeAdvances, lossDeductions: pendingDeds,
        loanInstallments: (allLoanInst ?? []).filter(i => activeLoans.some(l => l.id === i.loan_id)),
        advanceInstallments: (allAdvInst ?? []).filter(i => activeAdvances.some(a => a.id === i.advance_id)),
      };

      // Export immediately after the payroll row is created. Ancillary updates
      // below must not prevent the user from receiving the payslip download.
      try {
        exportPayrollPdf(pdfOpts);
      } catch (error) {
        toast.error(`Payroll saved, but PDF export failed: ${(error as Error).message}`);
      }
      toast.success('Payroll generated — mark it as paid once the salary is disbursed (see Pending Payroll tab).');

      // Mark loan installments as paid via this payroll
      // Also handles partial installments (paid_partial_manual → paid_payroll)
      for (const l of activeLoans) {
        const lInsts = (allLoanInst ?? []).filter(i => i.loan_id === l.id);
        if (isLeavingPeriod) {
          const pending = lInsts.filter(i => i.status === 'pending' || i.status === 'paid_partial_manual' || i.status === 'payroll_partial_skipped');
          for (const inst of pending) {
            await markLoanInstPayroll.mutateAsync({ installmentId: inst.id, payrollId: created.id, loanId: l.id });
          }
        } else {
          const inst = lInsts.find(i =>
            i.due_year === periodYear && i.due_month === periodMonth &&
            (i.status === 'pending' || i.status === 'paid_partial_manual' || i.status === 'payroll_partial_skipped')
          );
          if (inst) {
            await markLoanInstPayroll.mutateAsync({ installmentId: inst.id, payrollId: created.id, loanId: l.id });
          }
        }
      }

      // Mark advance installments as paid via this payroll
      for (const a of activeAdvances) {
        const aInsts = (allAdvInst ?? []).filter(i => i.advance_id === a.id);
        if (isLeavingPeriod) {
          const pending = aInsts.filter(i => i.status === 'pending' || i.status === 'paid_partial_manual' || i.status === 'payroll_partial_skipped');
          for (const inst of pending) {
            await markAdvInstPayroll.mutateAsync({ installmentId: inst.id, payrollId: created.id, advanceId: a.id });
          }
        } else {
          const inst = aInsts.find(i =>
            i.due_year === periodYear && i.due_month === periodMonth &&
            (i.status === 'pending' || i.status === 'paid_partial_manual' || i.status === 'payroll_partial_skipped')
          );
          if (inst) {
            await markAdvInstPayroll.mutateAsync({ installmentId: inst.id, payrollId: created.id, advanceId: a.id });
          }
        }
      }

      // Consume pending one-time incentives exactly once.
      for (const inc of (incentiveAmounts ?? []).filter(i => i.status === 'pending')) {
        const { supabase } = await import('@/integrations/supabase/client');
        await supabase.from('incentive_amounts').update({ status: 'added', payroll_id: created.id, added_on: ymd(new Date()) }).eq('id', inc.id).eq('status', 'pending');
      }
      // Mark loss deductions as deducted
      for (const d of pendingDeds) {
        await updDed.mutateAsync({ id: d.id, values: { status: 'deducted', payroll_id: created.id, deducted_on: ymd(new Date()) } });
      }

      // Auto-send payslip via WhatsApp if enabled
      if (settings?.wa_auto_send_payroll && emp.mobile) {
        const waNum = normalizeWaNumber(emp.mobile);
        if (waNum) {
          try {
            if (await isWaConnected()) {
              const b64 = getPayrollPdfBase64(pdfOpts);
              const from = period.from.toLocaleDateString('en-IN');
              const to = period.to.toLocaleDateString('en-IN');
              const ok = await sendWaPdf(waNum, b64, `payslip-${ymd(period.from)}.pdf`, `Your payslip for ${from} – ${to}`);
              if (ok) toast.success('Payslip sent via WhatsApp');
            }
          } catch { /* silent — don't fail payroll generation */ }
        }
      }

      // Email the generated payslip to the employee when enabled. Email
      // failures are reported but never roll back an already-created payroll.
      if (settings?.email_auto_send_payroll && emp.email) {
        try {
          const b64 = getPayrollPdfBase64(pdfOpts);
          const from = period.from.toLocaleDateString('en-IN');
          const to = period.to.toLocaleDateString('en-IN');
          await sendPayrollEmail({
            to: emp.email,
            employeeName: fullName(emp),
            periodLabel: `${from} – ${to}`,
            filename: `payslip-${ymd(period.from)}.pdf`,
            pdfBase64: b64,
          });
          toast.success('Payslip sent by email');
        } catch (error) {
          toast.error(`Payroll saved, but email failed: ${(error as Error).message}`);
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const exportOne = (p: Parameters<typeof exportPayrollPdf>[0]['payroll']) => {
    if (!emp) return;
    const empLoans    = (loans    ?? []).filter(l => l.employee_id === emp.id && l.status === 'active');
    const empAdvances = (advances ?? []).filter(a => a.employee_id === emp.id && a.status === 'active');
    const payrollDeds = (deductions ?? []).filter(d => d.payroll_id === p.id);
    try {
      exportPayrollPdf({
        payroll: p, employee: emp, department: dept, position, settings,
        loans: empLoans, advances: empAdvances, lossDeductions: payrollDeds,
        loanInstallments: (allLoanInst ?? []).filter(i => empLoans.some(l => l.id === i.loan_id)),
        advanceInstallments: (allAdvInst ?? []).filter(i => empAdvances.some(a => a.id === i.advance_id)),
      });
    } catch (error) {
      toast.error(`PDF export failed: ${(error as Error).message}`);
    }
  };

  const scale = preview ? (preview.c.calendarDaysInMonth > 0 ? preview.c.payableDates / preview.c.calendarDaysInMonth : 0) : 1;

  const loanEmiSummary = useMemo(() => {
    if (!allLoanInst) return { loanCount: 0, advCount: 0 };
    const lCount = activeLoans.filter(l => loanEmiAmount(l) > 0).length;
    const aCount = activeAdvances.filter(a => advEmiAmount(a) > 0).length;
    return { loanCount: lCount, advCount: aCount };
  }, [activeLoans, activeAdvances, loanEmiAmount, advEmiAmount, allLoanInst]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><Wallet className="h-5 w-5" /> Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Generate payroll → payslip PDF. Mark salary as paid in the <strong>Pending Payroll</strong> tab after bank transfer.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-6">
        <div className="space-y-2">
          <Label>Employee</Label>
          <Select value={empId} onValueChange={setEmpId}>
            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>
              {le ? <div className="p-2 text-sm">Loading...</div> : (employees ?? []).filter(e => e.status === 'active').map(e => (
                <SelectItem key={e.id} value={e.id}>{fullName(e)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Period type</Label>
          <Select value={periodType} onValueChange={v => setPeriodType(v as 'month' | 'half_month')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="half_month">Half month</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Month</Label>
          <div className="flex gap-2">
            <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                  <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" value={year} onChange={e => setYear(Number(e.target.value) || year)} className="w-28" />
          </div>
        </div>
        {periodType === 'half_month' && (
          <div className="space-y-2">
            <Label>Half</Label>
            <Select value={half} onValueChange={v => setHalf(v as 'first' | 'second')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="first">1st half (1–15)</SelectItem>
                <SelectItem value="second">2nd half (16–end)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {calculationOpen && emp && preview && (
        <GenerateCalculationDialog emp={emp} preview={preview} period={period} onClose={() => setCalculationOpen(false)} />
      )}

      {emp && preview && (
        <div className="space-y-3 rounded-lg border bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-lg font-semibold">{fullName(emp)}</div>
              <div className="text-xs text-muted-foreground">{dept?.name ?? '—'} · {position?.name ?? '—'} · {period.label}</div>
              {outsideEmployment && <div className="mt-1 text-xs font-medium text-destructive">{outsideEmployment}</div>}
              {halfMonthBlocked && !outsideEmployment && <div className="mt-1 text-xs font-medium text-destructive">{halfMonthBlocked}</div>}
              {isJoiningPeriod && !outsideEmployment && (
                <div className="mt-1 text-xs text-muted-foreground">Joining period — salary & leave rates prorated ({Math.round(preview.c.joinLeaveFactor * 100)}%)</div>
              )}
              {isLeavingPeriod && !outsideEmployment && (
                <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Final payroll — all remaining EMIs charged + paid leave balance paid out
                </div>
              )}
              {(partialEmiInfo.loanPartials > 0 || partialEmiInfo.advPartials > 0) && (
                <div className="mt-1 text-xs text-blue-700 dark:text-blue-400">
                  Partial payments: {partialEmiInfo.loanPartials > 0 ? `${partialEmiInfo.loanPartials} loan EMI(s)` : ''}
                  {partialEmiInfo.loanPartials > 0 && partialEmiInfo.advPartials > 0 ? ', ' : ''}
                  {partialEmiInfo.advPartials > 0 ? `${partialEmiInfo.advPartials} advance EMI(s)` : ''} — only remaining balances deducted
                </div>
              )}
              {lastPayroll && (
                <div className="mt-1 text-xs text-muted-foreground">Paid-leave balance carried from payroll ending {new Date(lastPayroll.period_end).toLocaleDateString('en-IN')}</div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCalculationOpen(true)} disabled={!preview}>
                View Calculation
              </Button>
              <Button
              onClick={generate}
              disabled={create.isPending || alreadyGenerated || !!outsideEmployment || !!halfMonthBlocked}
            >
              {outsideEmployment ? 'Not applicable' : halfMonthBlocked ? 'Half-month not allowed' : alreadyGenerated ? 'Already generated' : create.isPending ? 'Generating…' : 'Generate & export PDF'}
              </Button>
            </div>
          </div>

          {/* When payroll already exists for this period, show snapshotted values (not live employee data) */}
          {alreadyGenerated && existingPayroll && (
            <div className="rounded-md border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300">
              ⚠ Payroll already generated — values below are from the saved record (salary changes since then do not affect this payroll).
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-semibold">Earnings</div>
              {alreadyGenerated && existingPayroll ? (
                <>
                  <Row label="Basic"   v={Number(existingPayroll.basic_salary)} />
                  <Row label="HRA"     v={Number(existingPayroll.hra)} />
                  <Row label="Travel"  v={Number(existingPayroll.travel_allowance)} />
                  <Row label="Special" v={Number(existingPayroll.special_allowance)} />
                  <Row label="Other"   v={Number(existingPayroll.other_allowance)} />
                  <Row label={`Extra Work Day Payout (${Number(existingPayroll.extra_work_days) || 0} days)`} v={Number(existingPayroll.extra_work_pay) || 0} />
                  <Row label="Paid Leave Payout" v={Number(existingPayroll.paid_leave_payout_amount) || 0} />
                  {Number(existingPayroll.incentive_amount) > 0 && <Row label="One-time incentive" v={Number(existingPayroll.incentive_amount)} />}
                  <div className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold">
                    <span>Gross</span>
                    <span>{money(Number(existingPayroll.gross) + Number(existingPayroll.incentive_amount || 0))}</span>
                  </div>
                </>
              ) : (
                <>
                  <Row label="Basic"   v={Number(emp.basic_salary)      * scale} />
                  <Row label="HRA"     v={Number(emp.hra)               * scale} />
                  <Row label="Travel"  v={Number(emp.travel_allowance)  * scale} />
                  <Row label="Special" v={Number(emp.special_allowance) * scale} />
                  <Row label="Other"   v={Number(emp.other_allowance)   * scale} />
                  <Row label={`Extra Work Day Payout (${preview.c.extraWorkDays} days)`} v={preview.c.extraWorkPay} />
                  <Row label="Paid Leave Payout" v={preview.c.paidLeavePayout} />
                  <Row label="One-time incentive" v={preview.incentiveAmount} />
                  <div className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold">
                    <span>Gross</span>
                    <span>{money(preview.c.gross + preview.incentiveAmount)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-semibold">Deductions</div>
              {alreadyGenerated && existingPayroll ? (
                <>
                  <Row label="PF"           v={Number(existingPayroll.pf_deduction)} />
                  <Row label="Tax"          v={Number(existingPayroll.tax_deduction)} />
                  <Row label={`Unpaid Leave Deduction (${Number(existingPayroll.unpaid_leaves) || 0} days × calendar-day rate)`} v={Number(existingPayroll.unpaid_leave_deduction) || 0} />
                  <Row label="Loan EMI"     v={Number(existingPayroll.loan_deduction)} />
                  <Row label="Advance EMI"  v={Number(existingPayroll.advance_deduction)} />
                  <Row label="Loss"         v={Number(existingPayroll.loss_deduction)} />
                  <div className={`mt-2 flex justify-between border-t pt-2 text-sm font-semibold ${Number(existingPayroll.net) < 0 ? 'text-destructive' : ''}`}>
                    <span>Net</span>
                    <span>{money(Number(existingPayroll.net))}</span>
                  </div>
                </>
              ) : (
                <>
                  <Row label="PF"          v={preview.pf} />
                  <Row label="Tax"         v={preview.tax} />
                  <Row label={`Unpaid Leave Deduction (${preview.c.unpaidLeavesThisPeriod} days × calendar-day rate)`} v={preview.c.unpaidLeaveDeduction} />
                  <Row label={`Loan EMI (${loanEmiSummary.loanCount} loans)`}     v={preview.loanDed} />
                  <Row label={`Advance EMI (${loanEmiSummary.advCount} advances)`} v={preview.advDed} />
                  <Row label={`Loss (${pendingDeds.length})`}                      v={preview.lossDed} />
                  <div className={`mt-2 flex justify-between border-t pt-2 text-sm font-semibold ${preview.net < 0 ? 'text-destructive' : ''}`}>
                    <span>Net {preview.net < 0 && '⚠ NEGATIVE'}</span>
                    <span>{money(preview.net)}</span>
                  </div>
                  {preview.net < 0 && (
                    <div className="mt-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                      Deductions exceed gross earnings. Review loans, advances, and loss deductions before generating.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid gap-2 rounded-md border p-3 text-xs sm:grid-cols-5">
            <Stat label="Working days"     v={preview.c.workingDays} />
            <Stat label="Days worked"      v={preview.c.present} />
            <Stat label="Extra work days"  v={preview.c.extraWorkDays} />
            <Stat label="Paid leaves used" v={preview.c.paidLeavesUsedThisPeriod} />
            <Stat label="Paid leaves left" v={preview.c.paidLeavesLeftAfter} />
          </div>
        </div>
      )}

      {emp && (
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <div className="mb-3 text-base font-semibold">Past payroll — {fullName(emp)}</div>
          {lh ? <Skeleton className="h-24 w-full" /> : (history ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No payrolls yet.</div>
          ) : (
            <div className="divide-y">
              {(history ?? []).map(p => {
                const ps = effectivePaymentStatus(p);
                const badge = PAYMENT_STATUS_LABEL[ps];
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <div className="font-medium">
                        {new Date(p.period_start).toLocaleDateString('en-IN')} — {new Date(p.period_end).toLocaleDateString('en-IN')}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{p.period_type === 'half_month' ? 'Half month' : 'Month'} · Net {money(p.net)}</span>
                        {Number(p.paid_leave_payout_amount) > 0 && <span>· Leave payout {money(Number(p.paid_leave_payout_amount))}</span>}
                        <span className={cn('rounded px-1.5 py-0.5 font-medium', badge?.className)}>
                          <Clock className="mr-1 inline h-2.5 w-2.5" />{badge?.label}
                          {p.payment_date && ` · ${new Date(p.payment_date).toLocaleDateString('en-IN')}`}
                          {p.payment_amount != null && ps === 'partial_paid' && ` · Paid ${money(Number(p.payment_amount))}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => exportOne(p)}><Download className="mr-1 h-3 w-3" />PDF</Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        if (confirm('Delete this payroll? EMI installments and pending deductions will be reverted.')) del.mutate(p.id);
                      }}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{money(v)}</span>
    </div>
  );
}
function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{v}</span>
    </div>
  );
}

export type _T = Employee | Loan | Advance | LossDeduction | LoanInstallment | AdvanceInstallment;
