import { useEffect, useMemo, useState } from 'react';
import React from 'react';
import {
  Clock, CheckCircle2, Download, Search,
  ArrowUpDown, ArrowUp, ArrowDown, Banknote,
  ChevronDown, ChevronRight, FileText, MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  useEmployees, useAllPayrolls, useMarkPayrollPaid,
  useDepartments, useAllPositions, useAppSettings,
  useLoans, useAdvances, useLossDeductions,
  useAllLoanInstallments, useAllAdvanceInstallments,
} from '@/lib/hooks';
import { fullName, effectivePaymentStatus } from '@/lib/types';
import type { Payroll, Employee } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { ymd } from '@/lib/attendance-utils';
import { exportPendingPayrolls } from '@/lib/excel-io';
import { exportPayrollPdf, getPayrollPdfBase64 } from '@/lib/payroll-pdf';
import { calculatePayrollNet } from '@/lib/payroll-utils';
import { isWaConnected, sendWaPdf, sendWaMessage, normalizeWaNumber } from '@/lib/whatsapp';

function money(n: number) {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SortField = 'date' | 'period' | 'net';
type SortDir   = 'asc' | 'desc';

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  generated:    { label: 'Pending',      className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  partial_paid: { label: 'Partial paid', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300' },
};

/* ── Pay dialog ──────────────────────────────────────────────────────────── */
function PayDialog({
  payroll, employee, employeeName, onConfirm, onClose,
}: {
  payroll: Payroll;
  employee: Employee | undefined;
  employeeName: string;
  onConfirm: (opts: { partial: boolean; amount: number; date: string; paymentLedgerId: string }) => void;
  onClose: () => void;
}) {
  const ps       = effectivePaymentStatus(payroll);
  const net      = calculatePayrollNet(payroll);
  const alreadyPaid = ps === 'partial_paid' ? Number(payroll.payment_amount || 0) : 0;
  const remaining   = Math.max(0, net - alreadyPaid);

  const [partial, setPartial] = useState(false);
  const [amount, setAmount]   = useState(String(remaining.toFixed(2)));
  const [date, setDate]       = useState(ymd(new Date()));
  const [paymentLedgerId, setPaymentLedgerId] = useState('');
  const [paymentLedgers, setPaymentLedgers] = useState<Array<{ id: string; account_name: string; ledger_type: 'bank' | 'cash' }>>([]);

  useEffect(() => {
    let cancelled = false;
    if (!employee?.accounting_branch_id) { setPaymentLedgers([]); return; }
    void supabase.from('ledger_accounts')
      .select('id, account_name, ledger_type')
      .eq('branch_id', employee.accounting_branch_id)
      .eq('is_active', true)
      .in('ledger_type', ['bank', 'cash'])
      .order('account_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { toast.error(`Could not load bank/cash accounts: ${error.message}`); return; }
        setPaymentLedgers((data ?? []) as Array<{ id: string; account_name: string; ledger_type: 'bank' | 'cash' }>);
      });
    return () => { cancelled = true; };
  }, [employee?.accounting_branch_id]);

  const handleConfirm = () => {
    const amt = Number(amount);
    if (!(amt > 0)) { toast.error('Enter a valid payment amount'); return; }
    if (amt > remaining) { toast.error(`Amount exceeds outstanding balance (${money(remaining)})`); return; }
    if (!date) { toast.error('Select payment date'); return; }
    if (!paymentLedgerId) { toast.error('Select the bank or cash account used for this payment'); return; }
    if (partial && amt >= remaining) {
      toast.error('For full payment, choose "Full payment". Enter less than the balance for partial.');
      return;
    }
    onConfirm({ partial, amount: amt, date, paymentLedgerId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-xl">
        <div className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Banknote className="h-4 w-4" />Mark payroll as paid
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {employeeName} · {new Date(payroll.period_start).toLocaleDateString('en-IN')} – {new Date(payroll.period_end).toLocaleDateString('en-IN')}
        </p>

        {alreadyPaid > 0 && (
          <div className="mb-3 rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
            Previous payment: {money(alreadyPaid)} on {payroll.payment_date ? new Date(payroll.payment_date).toLocaleDateString('en-IN') : '—'}
            <div className="mt-0.5 font-semibold">Outstanding balance: {money(remaining)}</div>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Payment type</Label>
            <div className="flex gap-2">
              <Button size="sm" variant={partial ? 'outline' : 'default'} className="flex-1"
                onClick={() => { setPartial(false); setAmount(String(remaining.toFixed(2))); }}>
                Full payment
              </Button>
              <Button size="sm" variant={partial ? 'default' : 'outline'} className="flex-1"
                onClick={() => setPartial(true)}>
                Partial
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Amount paid (₹)</Label>
            <Input type="number" min={0.01} max={remaining} step={0.01}
              value={amount} onChange={e => setAmount(e.target.value)} disabled={!partial} />
            <div className="text-xs text-muted-foreground">
              Net payable: {money(net)}{alreadyPaid > 0 ? ` · Balance due: ${money(remaining)}` : ''}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Paid from (employee Accounting Branch)</Label>
            <Select value={paymentLedgerId} onValueChange={setPaymentLedgerId} disabled={!employee?.accounting_branch_id}>
              <SelectTrigger><SelectValue placeholder="Select bank or cash account" /></SelectTrigger>
              <SelectContent>
                {paymentLedgers.map(ledger => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.ledger_type})</SelectItem>)}
              </SelectContent>
            </Select>
            {!employee?.accounting_branch_id && <p className="text-xs text-muted-foreground">This employee has no Accounting Branch selected.</p>}
            {employee?.accounting_branch_id && paymentLedgers.length === 0 && <p className="text-xs text-muted-foreground">No active bank or cash accounts found for this Accounting Branch.</p>}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Payment date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleConfirm}>
            <CheckCircle2 className="mr-1 h-3 w-3" />Confirm payment
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Calculation popup ───────────────────────────────────────────────────── */
function CalculationDialog({ payroll, employee, onClose }: { payroll: Payroll; employee?: Employee; onClose: () => void }) {
  const n = (v: unknown) => Number(v) || 0;
  const monthlyGross = employee
    ? n(employee.basic_salary) + n(employee.hra) + n(employee.travel_allowance) + n(employee.special_allowance) + n(employee.other_allowance)
    : n(payroll.gross);
  const monthDays = new Date(new Date(payroll.period_start).getFullYear(), new Date(payroll.period_start).getMonth() + 1, 0).getDate();
  const dailyRate = monthDays > 0 ? monthlyGross / monthDays : 0;
  const payableDays = dailyRate > 0 ? n(payroll.gross) / dailyRate : 0;
  const incentive = n(payroll.incentive_amount);
  const paidLeavePayout = n(payroll.paid_leave_payout_amount);
  const extraWorkPayout = n(payroll.extra_work_pay);
  const finalSettlement = n(payroll.paid_leave_final_settlement_amount);
  const paidLeavePayoutTotal = paidLeavePayout + finalSettlement;
  const totalEarnings = n(payroll.gross) + extraWorkPayout + finalSettlement + incentive;
  const totalDeductions = n(payroll.pf_deduction) + n(payroll.tax_deduction) + n(payroll.unpaid_leave_deduction) + n(payroll.loan_deduction) + n(payroll.advance_deduction) + n(payroll.loss_deduction);
  const Row = ({ label, value, className = '' }: { label: string; value: number; className?: string }) => (
    <div className={`flex items-start justify-between gap-4 border-b py-2 last:border-0 ${className}`}>
      <span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{money(value)}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-background p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Payroll Calculation</h2><p className="text-xs text-muted-foreground">{employee ? fullName(employee) : 'Employee'} · {new Date(payroll.period_start).toLocaleDateString('en-IN')} – {new Date(payroll.period_end).toLocaleDateString('en-IN')}</p></div>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-3"><div className="mb-1 font-semibold">Salary-day calculation</div><p className="mb-2 text-xs text-muted-foreground">Weekly offs, working days, applicable holidays, paid leave, and extra-work dates are counted as unique payable dates.</p>
            <Row label="Monthly gross salary" value={monthlyGross} /><Row label={`Calendar days in month (${monthDays})`} value={monthDays} /><Row label="Daily salary rate" value={dailyRate} /><Row label="Payable salary days" value={payableDays} /><Row label="Gross salary for period" value={n(payroll.gross)} className="font-semibold" />
          </div>
          <div className="rounded-lg border p-3"><div className="mb-1 font-semibold">Earnings</div><Row label="Basic salary" value={n(payroll.basic_salary) - paidLeavePayout} /><Row label="HRA" value={n(payroll.hra)} /><Row label="Travel allowance" value={n(payroll.travel_allowance)} /><Row label="Special allowance" value={n(payroll.special_allowance)} /><Row label="Other allowance" value={n(payroll.other_allowance)} /><Row label="Extra Work Day Payout" value={extraWorkPayout} /><Row label="Paid Leave Payout" value={paidLeavePayoutTotal} /><Row label="Pending incentive" value={incentive} /><Row label="Total earnings" value={totalEarnings} className="font-semibold" /></div>
          <div className="rounded-lg border p-3"><div className="mb-1 font-semibold">Deductions</div><Row label="Unpaid Leave Deduction" value={n(payroll.unpaid_leave_deduction)} /><div className="mb-1 text-xs text-muted-foreground">{n(payroll.unpaid_leaves)} unpaid leave day(s) × calendar-day rate</div><Row label="PF" value={n(payroll.pf_deduction)} /><Row label="Tax" value={n(payroll.tax_deduction)} /><Row label="Loan EMI" value={n(payroll.loan_deduction)} /><Row label="Advance EMI" value={n(payroll.advance_deduction)} /><Row label="Loss deduction" value={n(payroll.loss_deduction)} /><Row label="Total deductions" value={totalDeductions} className="font-semibold text-destructive" /></div>
          <div className="rounded-lg border bg-muted/30 p-3"><div className="mb-1 font-semibold">Final calculation</div><p className="text-sm">{money(totalEarnings)} earnings − {money(totalDeductions)} deductions</p><div className={`mt-3 flex justify-between border-t pt-3 text-lg font-bold ${calculatePayrollNet(payroll) < 0 ? 'text-destructive' : ''}`}><span>Net salary</span><span>{money(calculatePayrollNet(payroll))}</span></div></div>
        </div>
      </div>
    </div>
  );
}

/* ── Detail panel (expandable under each row) ───────────────────────────── */
function DetailPanel({
  payroll,
  employee,
  onMarkPaid,
}: {
  payroll: Payroll;
  employee: Employee | undefined;
  onMarkPaid: () => void;
}) {
  const { data: departments } = useDepartments();
  const { data: positions }   = useAllPositions();
  const { data: settings }    = useAppSettings();
  const { data: allLoans }    = useLoans();
  const { data: allAdvances } = useAdvances();
  const { data: allDeds }     = useLossDeductions();
  const { data: allLoanInst } = useAllLoanInstallments();
  const { data: allAdvInst }  = useAllAdvanceInstallments();

  const dept = employee?.department_id
    ? departments?.find(d => d.id === employee.department_id) ?? null
    : null;
  const pos = employee?.position_id
    ? positions?.find(p => p.id === employee.position_id) ?? null
    : null;

  const ps         = effectivePaymentStatus(payroll);
  const net        = calculatePayrollNet(payroll);
  const paidAmt    = Number(payroll.payment_amount || 0);
  const outstanding = ps === 'partial_paid' ? Math.max(0, net - paidAmt) : net;
  const gross       = Number(payroll.gross) + Number(payroll.extra_work_pay || 0) + Number(payroll.paid_leave_final_settlement_amount || 0) + Number(payroll.incentive_amount || 0);
  const totalDed    =
    Number(payroll.pf_deduction) + Number(payroll.tax_deduction) +
    Number(payroll.unpaid_leave_deduction) + Number(payroll.loan_deduction) +
    Number(payroll.advance_deduction) + Number(payroll.loss_deduction);

  const buildPdfOpts = () => {
    const empLoans    = (allLoans    ?? []).filter(l => l.employee_id === employee!.id && l.status === 'active');
    const empAdvances = (allAdvances ?? []).filter(a => a.employee_id === employee!.id && a.status === 'active');
    return {
      payroll, employee: employee!, department: dept, position: pos, settings,
      loans: empLoans, advances: empAdvances,
      lossDeductions: (allDeds ?? []).filter(d => d.payroll_id === payroll.id),
      loanInstallments: (allLoanInst ?? []).filter(i => empLoans.some(l => l.id === i.loan_id)),
      advanceInstallments: (allAdvInst ?? []).filter(i => empAdvances.some(a => a.id === i.advance_id)),
    };
  };

  const handlePdf = () => {
    if (!employee) { toast.error('Employee not found'); return; }
    exportPayrollPdf(buildPdfOpts());
  };

  const handleWaPdf = async () => {
    if (!employee) { toast.error('Employee not found'); return; }
    const waNum = normalizeWaNumber(employee.mobile);
    if (!waNum) { toast.error('Employee has no mobile number'); return; }
    try {
      if (!await isWaConnected()) { toast.error('WhatsApp is not connected'); return; }
      const b64 = getPayrollPdfBase64(buildPdfOpts());
      const fname = `payslip-${fullName(employee).replace(/\s+/g, '_')}-${payroll.period_start}.pdf`;
      const caption = `Payslip for ${new Date(payroll.period_start).toLocaleDateString('en-IN')} – ${new Date(payroll.period_end).toLocaleDateString('en-IN')}`;
      const ok = await sendWaPdf(waNum, b64, fname, caption);
      if (ok) toast.success('Payslip sent via WhatsApp');
      else toast.error('Failed to send via WhatsApp');
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="border-t bg-muted/20 px-4 py-4 text-xs">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Earnings */}
        <div>
          <div className="mb-1.5 font-semibold text-sm">Earnings</div>
          <table className="w-full">
            <tbody className="divide-y divide-border/50">
              <DetailRow k="Basic salary"      v={Number(payroll.basic_salary)} />
              <DetailRow k="HRA"               v={Number(payroll.hra)} />
              <DetailRow k="Travel allowance"  v={Number(payroll.travel_allowance)} />
              <DetailRow k="Special allowance" v={Number(payroll.special_allowance)} />
              <DetailRow k="Other allowance"   v={Number(payroll.other_allowance)} />
              {(Number(payroll.paid_leave_payout_amount) + Number(payroll.paid_leave_final_settlement_amount)) > 0 && (
                <DetailRow k="Paid Leave Payout" v={Number(payroll.paid_leave_payout_amount) + Number(payroll.paid_leave_final_settlement_amount)} />
              )}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-1.5 text-muted-foreground">Gross</td>
                <td className="py-1.5 text-right">{money(gross)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Deductions */}
        <div>
          <div className="mb-1.5 font-semibold text-sm">Deductions</div>
          <table className="w-full">
            <tbody className="divide-y divide-border/50">
              <DetailRow k="PF"             v={Number(payroll.pf_deduction)} />
              <DetailRow k="Tax"            v={Number(payroll.tax_deduction)} />
              <DetailRow k="Unpaid leave"   v={Number(payroll.unpaid_leave_deduction)} />
              <DetailRow k="Loan EMI"       v={Number(payroll.loan_deduction)} />
              <DetailRow k="Advance EMI"    v={Number(payroll.advance_deduction)} />
              <DetailRow k="Loss deduction" v={Number(payroll.loss_deduction)} />
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-1.5 text-muted-foreground">Total deductions</td>
                <td className="py-1.5 text-right text-destructive">−{money(totalDed)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Net + attendance */}
      <div className="mt-3 flex flex-wrap items-end gap-4 rounded-md border bg-card px-3 py-2">
        <div>
          <div className="text-muted-foreground">Net payable</div>
          <div className={`text-base font-bold ${net < 0 ? 'text-destructive' : ''}`}>{money(net)}</div>
        </div>
        {ps === 'partial_paid' && (
          <>
            <div>
              <div className="text-muted-foreground">Paid so far</div>
              {(payroll.payment_history?.length ?? 0) > 0 ? (
                <div className="space-y-0.5">
                  {payroll.payment_history!.map((entry, i) => (
                    <div key={i} className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                      {money(entry.amount)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        on {new Date(entry.date).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                  ))}
                  <div className="text-xs text-muted-foreground">Total: {money(paidAmt)}</div>
                </div>
              ) : (
                <div className="text-base font-semibold text-blue-700 dark:text-blue-400">
                  {money(paidAmt)}
                  {payroll.payment_date && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      on {new Date(payroll.payment_date).toLocaleDateString('en-IN')}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground">Outstanding balance</div>
              <div className="text-base font-bold text-amber-700 dark:text-amber-400">{money(outstanding)}</div>
            </div>
          </>
        )}
        <div>
          <div className="text-muted-foreground">Days worked</div>
          <div className="font-semibold">{payroll.present_days} / {payroll.working_days}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Paid leaves used</div>
          <div className="font-semibold">{payroll.paid_leaves_used}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Unpaid leaves</div>
          <div className="font-semibold">{payroll.unpaid_leaves}</div>
        </div>
      </div>

      {/* Notes */}
      {payroll.notes && (
        <div className="mt-2 text-muted-foreground italic">Note: {payroll.notes}</div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handlePdf}>
          <FileText className="mr-1 h-3 w-3" />Download payslip PDF
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleWaPdf}>
          <MessageCircle className="mr-1 h-3 w-3 text-green-600" />Send via WhatsApp
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={onMarkPaid}>
          <CheckCircle2 className="mr-1 h-3 w-3" />
          {ps === 'partial_paid' ? 'Pay outstanding balance' : 'Mark as paid'}
        </Button>
      </div>
    </div>
  );
}

function DetailRow({ k, v }: { k: string; v: number }) {
  return (
    <tr>
      <td className="py-1 text-muted-foreground">{k}</td>
      <td className="py-1 text-right">{money(v)}</td>
    </tr>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export function PayrollPending() {
  const { data: employees } = useEmployees();
  const { data: allPayrolls, isLoading } = useAllPayrolls();
  const markPaid = useMarkPayrollPaid();
  const { data: settings } = useAppSettings();
  const { data: allLoans } = useLoans();
  const { data: allAdvances } = useAdvances();
  const { data: allDeductions } = useLossDeductions();

  const [search, setSearch]       = useState('');
  const [sort, setSort]           = useState<SortField>('date');
  const [sortDir, setSortDir]     = useState<SortDir>('desc');
  const [filterPeriod, setFilterPeriod] = useState('__all__');
  const [payDialog, setPayDialog] = useState<Payroll | null>(null);
  const [calculationPayroll, setCalculationPayroll] = useState<Payroll | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const empMap = useMemo(
    () => new Map((employees ?? []).map(e => [e.id, e] as const)),
    [employees],
  );

  const pendingPayrolls = useMemo(
    () => (allPayrolls ?? []).filter(p => {
      const s = effectivePaymentStatus(p);
      return s === 'generated' || s === 'partial_paid';
    }),
    [allPayrolls],
  );

  const uniquePeriods = useMemo(() => {
    const seen = new Set<string>();
    pendingPayrolls.forEach(p => seen.add(`${p.period_start}|${p.period_end}`));
    return Array.from(seen).sort().map(k => {
      const [s, e] = k.split('|');
      return { key: k, label: `${new Date(s).toLocaleDateString('en-IN')} – ${new Date(e).toLocaleDateString('en-IN')}` };
    });
  }, [pendingPayrolls]);

  const filtered = useMemo(() => {
    let list = [...pendingPayrolls];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => {
        const emp = empMap.get(p.employee_id);
        return emp && fullName(emp).toLowerCase().includes(q);
      });
    }
    if (filterPeriod && filterPeriod !== '__all__') {
      const [s, e] = filterPeriod.split('|');
      list = list.filter(p => p.period_start === s && p.period_end === e);
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sort === 'date' || sort === 'period') cmp = a.period_start.localeCompare(b.period_start);
      else if (sort === 'net') cmp = Number(a.net) - Number(b.net);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [pendingPayrolls, search, filterPeriod, sort, sortDir, empMap]);

  const totals = useMemo(() => ({
    count:   filtered.length,
    total:   filtered.reduce((s, p) => s + calculatePayrollNet(p), 0),
    partial: filtered.filter(p => effectivePaymentStatus(p) === 'partial_paid').length,
  }), [filtered]);

  const toggleSort = (field: SortField) => {
    if (sort === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSort(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sort !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />;
  };

  const handleMarkPaid = async (opts: { partial: boolean; amount: number; date: string; paymentLedgerId: string }) => {
    if (!payDialog) return;
    const ps        = effectivePaymentStatus(payDialog);
    const alreadyPaid = ps === 'partial_paid' ? Number(payDialog.payment_amount || 0) : 0;
    const totalPaid = alreadyPaid + opts.amount;
    try {
      await markPaid.mutateAsync({
        payrollId:       payDialog.id,
        paymentDate:     opts.date,
        paymentAmount:   totalPaid,
        paymentLedgerId: opts.paymentLedgerId,
        partial:         opts.partial,
        historyEntry:    { date: opts.date, amount: opts.amount },
        existingHistory: payDialog.payment_history ?? null,
      });
      const emp = empMap.get(payDialog.employee_id);
      toast.success(
        `${emp ? fullName(emp) : 'Payroll'} marked as ${opts.partial ? 'partially' : 'fully'} paid — ` +
        `${money(opts.amount)} on ${new Date(opts.date).toLocaleDateString('en-IN')}`
      );
      // Auto-send WhatsApp payment notification if enabled
      if (settings?.wa_send_on_payment && emp?.mobile) {
        const waNum = normalizeWaNumber(emp.mobile);
        if (waNum) {
          try {
            if (await isWaConnected()) {
              const statusLabel = opts.partial ? 'partial payment' : 'full payment';
              const msg =
                `Hi ${fullName(emp)}, your salary ${statusLabel} of Rs.${opts.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} has been processed` +
                ` on ${new Date(opts.date).toLocaleDateString('en-IN')}` +
                ` for the period ${new Date(payDialog.period_start).toLocaleDateString('en-IN')} – ${new Date(payDialog.period_end).toLocaleDateString('en-IN')}.` +
                ` Total paid: Rs.${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
              await sendWaMessage(waNum, msg);
            }
          } catch { /* silent */ }
        }
      }
      setPayDialog(null);
      setExpanded(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleExport = () => {
    if (!filtered.length) { toast.info('No records to export'); return; }
    exportPendingPayrolls({ payrolls: filtered, employees: employees ?? [] });
    toast.success('Excel file exported');
  };

  const empName = (p: Payroll) => {
    const emp = empMap.get(p.employee_id) as Employee | undefined;
    return emp ? fullName(emp) : '—';
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {calculationPayroll && (
        <CalculationDialog payroll={calculationPayroll} employee={empMap.get(calculationPayroll.employee_id)} onClose={() => setCalculationPayroll(null)} />
      )}
      {payDialog && (
        <PayDialog
          payroll={payDialog}
          employee={empMap.get(payDialog.employee_id)}
          employeeName={empName(payDialog)}
          onConfirm={handleMarkPaid}
          onClose={() => setPayDialog(null)}
        />
      )}

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <Clock className="h-5 w-5" /> Pending Payroll
        </h1>
        <p className="text-sm text-muted-foreground">
          Payrolls generated but salary not yet disbursed. Mark as paid once bank transfer is done — this creates the bank entry in the ledger.
          Click any row to see full details or download the payslip PDF.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Pending records</div>
          <div className="text-2xl font-bold">{totals.count}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Total amount due</div>
          <div className="text-2xl font-bold">{money(totals.total)}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Partially paid</div>
          <div className="text-2xl font-bold">{totals.partial}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search employee name…" value={search}
            onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
        </div>
        <Select value={filterPeriod} onValueChange={setFilterPeriod}>
          <SelectTrigger className="w-56 h-9"><SelectValue placeholder="All periods" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All periods</SelectItem>
            {uniquePeriods.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport} className="h-9">
          <Download className="mr-1 h-3.5 w-3.5" />Export Excel
        </Button>
      </div>

      {/* Table */}
      {isLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="rounded-lg border bg-card">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <div className="text-sm font-medium">All clear — no pending payrolls</div>
              <div className="text-xs">Generate a payroll for any employee to see it here before marking it as paid.</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs">
                  <tr>
                    <th className="w-8 px-2 py-2.5" />
                    <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                    <th className="px-4 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => toggleSort('period')}>
                      Period <SortIcon field="period" />
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Gross</th>
                    <th className="px-4 py-2.5 text-right font-medium">Deductions</th>
                    <th className="px-4 py-2.5 text-right font-medium cursor-pointer select-none" onClick={() => toggleSort('net')}>
                      Net due <SortIcon field="net" />
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const status      = effectivePaymentStatus(p);
                    const badge       = STATUS_LABEL[status];
                    const deductions  =
                      Number(p.pf_deduction) + Number(p.tax_deduction) +
                      Number(p.loan_deduction) + Number(p.advance_deduction) +
                      Number(p.loss_deduction) + Number(p.unpaid_leave_deduction);
                    const partialPaid  = status === 'partial_paid' && p.payment_amount != null;
                    const correctedNet = calculatePayrollNet(p);
                    const outstanding  = partialPaid
                      ? Math.max(0, correctedNet - Number(p.payment_amount))
                      : correctedNet;
                    const isOpen = expanded === p.id;
                    const emp    = empMap.get(p.employee_id);

                    return (
                      <React.Fragment key={p.id}>
                        <tr
                          className={`border-t cursor-pointer hover:bg-muted/30 transition-colors ${isOpen ? 'bg-muted/20' : ''}`}
                          onClick={() => setExpanded(isOpen ? null : p.id)}
                        >
                          <td className="px-2 py-3 text-center text-muted-foreground">
                            {isOpen
                              ? <ChevronDown className="h-3.5 w-3.5 mx-auto" />
                              : <ChevronRight className="h-3.5 w-3.5 mx-auto" />}
                          </td>
                          <td className="px-4 py-3 font-medium">{empName(p)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(p.period_start).toLocaleDateString('en-IN')} – {new Date(p.period_end).toLocaleDateString('en-IN')}
                            <div>{p.period_type === 'half_month' ? 'Half month' : 'Full month'}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {money(Number(p.gross) + Number(p.extra_work_pay || 0) + Number(p.paid_leave_final_settlement_amount || 0) + Number(p.incentive_amount || 0))}
                          </td>
                          <td className="px-4 py-3 text-right text-destructive">−{money(deductions)}</td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {money(outstanding)}
                            {partialPaid && (
                              <div className="text-xs text-muted-foreground font-normal">
                                of {money(calculatePayrollNet(p))} total
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge?.className}`}>
                              {badge?.label}
                            </span>
                            {partialPaid && p.payment_date && (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {money(Number(p.payment_amount))} on {new Date(p.payment_date).toLocaleDateString('en-IN')}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCalculationPayroll(p)}>
                                <FileText className="mr-1 h-3 w-3" />View Calculation
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPayDialog(p)}>
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                {status === 'partial_paid' ? 'Pay balance' : 'Mark paid'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t-0">
                            <td colSpan={8} className="p-0">
                              <DetailPanel
                                payroll={p}
                                employee={emp}
                                onMarkPaid={() => { setPayDialog(p); }}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="border-t bg-muted/40 text-xs font-semibold">
                  <tr>
                    <td className="px-4 py-2.5" colSpan={5}>Total ({filtered.length} records)</td>
                    <td className="px-4 py-2.5 text-right">{money(totals.total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
