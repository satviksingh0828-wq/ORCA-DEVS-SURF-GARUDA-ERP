import { useEffect, useMemo, useState } from 'react';
import { Banknote, HandCoins, Plus, CheckCircle2, Trash2, Download, ChevronDown, ChevronRight, FileText, AlertCircle, SplitSquareHorizontal, SkipForward, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  useEmployees, useLoans, useAdvances, useCreateLoan, useCreateAdvance,
  useUpdateLoan, useUpdateAdvance, useDeleteLoan, useDeleteAdvance, useAppSettings,
  useLoanInstallments, useAdvanceInstallments,
  useMarkLoanInstallmentPaid, useMarkAdvanceInstallmentPaid,
  useMarkLoanInstallmentUnpaid, useMarkAdvanceInstallmentUnpaid,
  useMarkLoanInstallmentPartialPaid, useMarkAdvanceInstallmentPartialPaid,
  useSkipLoanInstallment, useSkipAdvanceInstallment,
} from '@/lib/hooks';
import { fullName } from '@/lib/types';
import type { InterestMethod, Loan, LoanInput, Employee, LoanInstallment, AdvanceInstallment } from '@/lib/types';
import { computeEMI, loanRemaining, loanRemainingFromInstallments } from '@/lib/payroll-utils';
import { ymd } from '@/lib/attendance-utils';
import { exportLoanDetailPdf, exportLoansSummaryPdf, getLoanDetailPdfBase64 } from '@/lib/pdf-export';
import { isWaConnected, sendWaPdf, normalizeWaNumber } from '@/lib/whatsapp';
import { supabase } from '@/integrations/supabase/client';

function money(n: number) {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LoansView({ mode }: { mode: 'loan' | 'advance' }) {
  const label = mode === 'loan' ? 'Loan' : 'Advance';
  const Icon  = mode === 'loan' ? Banknote : HandCoins;

  const { data: employees }  = useEmployees();
  const { data: settings }   = useAppSettings();
  const loansQ    = useLoans();
  const advancesQ = useAdvances();
  const list    = mode === 'loan' ? loansQ.data    : advancesQ.data;
  const loading = mode === 'loan' ? loansQ.isLoading : advancesQ.isLoading;

  const createL = useCreateLoan();
  const createA = useCreateAdvance();
  const updateL = useUpdateLoan();
  const updateA = useUpdateAdvance();
  const deleteL = useDeleteLoan();
  const deleteA = useDeleteAdvance();
  const create  = mode === 'loan' ? createL : createA;
  const update  = mode === 'loan' ? updateL : updateA;
  const del     = mode === 'loan' ? deleteL : deleteA;

  const empMap   = useMemo(() => new Map((employees ?? []).map(e => [e.id, e] as const)), [employees]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAdd, setShowAdd]   = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [discount, setDiscount] = useState('0');

  const totals = useMemo(() => {
    const all = list ?? [];
    return {
      count:     all.length,
      active:    all.filter(l => l.status === 'active').length,
      principal: all.reduce((s, l) => s + Number(l.principal), 0),
      remaining: all.reduce((s, l) => s + loanRemaining(l), 0),
    };
  }, [list]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><Icon className="h-5 w-5" /> {label}s</h1>
          <p className="text-sm text-muted-foreground">
            EMIs tracked per calendar month. Partial payments reduce the payroll deduction for that period. Manually paid EMIs are skipped by payroll.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!list?.length} onClick={() => {
            try {
              exportLoansSummaryPdf({ loans: list ?? [], employees: employees ?? [], settings, kind: mode });
            } catch (e) {
              toast.error(`PDF export failed: ${(e as Error).message}`);
            }
          }}>
            <Download className="mr-1 h-4 w-4" />Export all
          </Button>
          <Button onClick={() => setShowAdd(v => !v)}>
            <Plus className="mr-1 h-4 w-4" />{showAdd ? 'Close' : `Add ${label.toLowerCase()}`}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Records"        v={String(totals.count)} />
        <Stat label="Active"         v={String(totals.active)} />
        <Stat label="Total principal" v={money(totals.principal)} />
        <Stat label="Total remaining" v={money(totals.remaining)} />
      </div>

      {showAdd && (
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <LoanForm mode={mode} onDone={() => setShowAdd(false)} employees={employees ?? []}
            onCreate={async (v) => { await create.mutateAsync(v as LoanInput); }} />
        </div>
      )}

      {loading ? <Skeleton className="h-40 w-full" /> : (
        <div className="rounded-lg border bg-card">
          {(list ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No {label.toLowerCase()}s yet.</div>
          ) : (
            <div className="divide-y">
              {(list ?? []).map(l => {
                const emp        = empMap.get(l.employee_id);
                const remaining  = loanRemaining(l);
                const isOpen     = expanded === l.id;
                const isPaying   = payingId === l.id;
                return (
                  <LoanRow
                    key={l.id}
                    l={l}
                    emp={emp}
                    remaining={remaining}
                    isOpen={isOpen}
                    isPaying={isPaying}
                    discount={discount}
                    mode={mode}
                    label={label}
                    settings={settings}
                    onToggle={() => setExpanded(isOpen ? null : l.id)}
                    onPayToggle={() => { setPayingId(isPaying ? null : l.id); setDiscount('0'); }}
                    onPayDiscount={setDiscount}
                    onMarkFullPaid={async () => {
                      try {
                        await update.mutateAsync({ id: l.id, values: { status: 'paid', paid_off_date: ymd(new Date()), discount_amount: Number(discount) || 0, paid_months: l.months } });
                        toast.success('Marked paid'); setPayingId(null);
                      } catch (e) { toast.error((e as Error).message); }
                    }}
                    onDelete={() => { if (confirm('Delete this ' + label.toLowerCase() + '?')) del.mutate(l.id); }}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Individual loan row with installment schedule ─────────────────────────── */

function LoanRow({
  l, emp, remaining, isOpen, isPaying, discount, mode, label, settings,
  onToggle, onPayToggle, onPayDiscount, onMarkFullPaid, onDelete,
}: {
  l: Loan; emp: Employee | undefined; remaining: number;
  isOpen: boolean; isPaying: boolean; discount: string;
  mode: 'loan' | 'advance'; label: string; settings: Parameters<typeof exportLoansSummaryPdf>[0]['settings'];
  onToggle: () => void; onPayToggle: () => void;
  onPayDiscount: (v: string) => void; onMarkFullPaid: () => void; onDelete: () => void;
}) {
  const isLoan      = mode === 'loan';
  const lInstQ      = useLoanInstallments(isLoan ? l.id : '');
  const aInstQ      = useAdvanceInstallments(!isLoan ? l.id : '');
  const installments: Array<LoanInstallment | AdvanceInstallment> =
    (isLoan ? lInstQ.data : aInstQ.data) ?? [];

  // True remaining computed from actual installments (handles partial-paid, skipped, tail rows)
  const trulyRemaining = useMemo(() => {
    if (installments.length === 0) return remaining;
    return loanRemainingFromInstallments(installments);
  }, [installments, remaining]);

  const markLoanPaid        = useMarkLoanInstallmentPaid();
  const markAdvPaid         = useMarkAdvanceInstallmentPaid();
  const markLoanUnpaid      = useMarkLoanInstallmentUnpaid();
  const markAdvUnpaid       = useMarkAdvanceInstallmentUnpaid();
  const markLoanPartial     = useMarkLoanInstallmentPartialPaid();
  const markAdvPartial      = useMarkAdvanceInstallmentPartialPaid();
  const skipLoan            = useSkipLoanInstallment();
  const skipAdv             = useSkipAdvanceInstallment();

  // Partial payment dialog state
  const [partialInstId, setPartialInstId] = useState<string | null>(null);
  const [partialAmt, setPartialAmt]       = useState('');
  const [directPayInstId, setDirectPayInstId] = useState<string | null>(null);
  const [paymentLedgerId, setPaymentLedgerId] = useState('');
  const [paymentLedgers, setPaymentLedgers] = useState<Array<{ id: string; account_name: string; ledger_type: 'bank' | 'cash' }>>([]);

  useEffect(() => {
    let cancelled = false;
    if (!emp?.accounting_branch_id) { setPaymentLedgers([]); setPaymentLedgerId(''); return; }
    void supabase.from('ledger_accounts')
      .select('id,account_name,ledger_type')
      .eq('branch_id', emp.accounting_branch_id)
      .eq('is_active', true)
      .in('ledger_type', ['bank', 'cash'])
      .order('account_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { toast.error(`Could not load cash/bank accounts: ${error.message}`); return; }
        const rows = (data ?? []) as Array<{ id: string; account_name: string; ledger_type: 'bank' | 'cash' }>;
        setPaymentLedgers(rows);
        if (!rows.some(row => row.id === paymentLedgerId)) setPaymentLedgerId('');
      });
    return () => { cancelled = true; };
  }, [emp?.accounting_branch_id]);

  const partialInst = partialInstId
    ? installments.find(i => i.id === partialInstId)
    : null;

  // Skip dialog state (shared for all skip modes)
  const [skipInstId, setSkipInstId] = useState<string | null>(null);
  const [skipAmt, setSkipAmt]       = useState('');
  const [skipMode, setSkipMode]     = useState<'skip' | 'cash' | 'payroll'>('skip');

  const skipInst = skipInstId ? installments.find(i => i.id === skipInstId) : null;

  const handleMarkInstallmentUnpaid = async (inst: LoanInstallment | AdvanceInstallment) => {
    if (inst.status === 'pending') { toast.info('This EMI is already unpaid'); return; }
    try {
      if (isLoan) {
        const li = inst as LoanInstallment;
        await markLoanUnpaid.mutateAsync({ installmentId: li.id, loanId: li.loan_id });
      } else {
        const ai = inst as AdvanceInstallment;
        await markAdvUnpaid.mutateAsync({ installmentId: ai.id, advanceId: ai.advance_id });
      }
      toast.success(`EMI #${inst.emi_number} reset to unpaid — it will be deducted in the next payroll`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleMarkInstallmentPaid = async (inst: LoanInstallment | AdvanceInstallment) => {
    if (inst.status === 'paid_manual') { toast.info('This EMI is already marked as paid manually'); return; }
    const wasPayroll = inst.status === 'paid_payroll';
    if (!wasPayroll && !paymentLedgerId) { setDirectPayInstId(inst.id); return; }
    try {
      if (isLoan) {
        const li = inst as LoanInstallment;
        await markLoanPaid.mutateAsync({ installmentId: li.id, loanId: li.loan_id, currentStatus: li.status, payrollId: li.payroll_id, directPaymentLedgerId: paymentLedgerId || undefined });
      } else {
        const ai = inst as AdvanceInstallment;
        await markAdvPaid.mutateAsync({ installmentId: ai.id, advanceId: ai.advance_id, currentStatus: ai.status, payrollId: ai.payroll_id, directPaymentLedgerId: paymentLedgerId || undefined });
      }
      setDirectPayInstId(null);
      if (wasPayroll) {
        toast.warning(`EMI #${inst.emi_number} marked as paid directly. The payroll that deducted it should be deleted and regenerated.`);
      } else {
        toast.success(`EMI #${inst.emi_number} marked as paid directly — will be skipped in payroll`);
      }
      // Auto-send WA PDF if setting enabled
      if ((isLoan ? settings?.wa_send_loan : settings?.wa_send_advance) && emp?.mobile) {
        const waNum = normalizeWaNumber(emp.mobile);
        if (waNum) {
          try {
            if (await isWaConnected()) {
              const b64 = getLoanDetailPdfBase64({ loan: l, employee: emp, settings, kind: mode, installments });
              await sendWaPdf(waNum, b64, `${mode}-${l.start_date}.pdf`, `EMI #${inst.emi_number} marked as paid — ${mode === 'loan' ? 'Loan' : 'Advance'} statement`);
            }
          } catch { /* silent */ }
        }
      }
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleSendWaLoanPdf = async () => {
    if (!emp?.mobile) { toast.error('Employee has no mobile number'); return; }
    const waNum = normalizeWaNumber(emp.mobile);
    if (!waNum) { toast.error('Invalid mobile number'); return; }
    try {
      if (!await isWaConnected()) { toast.error('WhatsApp is not connected'); return; }
      const b64 = getLoanDetailPdfBase64({ loan: l, employee: emp, settings, kind: mode, installments });
      const fname = `${mode}-${fullName(emp).replace(/\s+/g, '_')}-${l.start_date}.pdf`;
      const ok = await sendWaPdf(waNum, b64, fname, `Your ${mode === 'loan' ? 'loan' : 'advance'} statement`);
      if (ok) toast.success(`${mode === 'loan' ? 'Loan' : 'Advance'} PDF sent via WhatsApp`);
      else toast.error('Failed to send via WhatsApp');
    } catch (e) { toast.error((e as Error).message); }
  };

  const handlePartialPay = async () => {
    if (!partialInst) return;
    const amt = Number(partialAmt);
    const maxAmt = Number(partialInst.amount);
    if (!(amt > 0)) { toast.error('Enter a valid amount'); return; }
    if (amt >= maxAmt) { toast.error(`Amount must be less than the full EMI (${money(maxAmt)}). Use "Mark paid" for full payment.`); return; }
    if (!paymentLedgerId) { toast.error('Select the cash or bank account that received the EMI'); return; }
    try {
      if (isLoan) {
        const li = partialInst as LoanInstallment;
        await markLoanPartial.mutateAsync({ installmentId: li.id, loanId: li.loan_id, paidAmount: amt, paymentLedgerId });
      } else {
        const ai = partialInst as AdvanceInstallment;
        await markAdvPartial.mutateAsync({ installmentId: ai.id, advanceId: ai.advance_id, paidAmount: amt, paymentLedgerId });
      }
      toast.success(
        `EMI #${partialInst.emi_number}: ${money(amt)} recorded as direct payment. ` +
        `Remaining ${money(maxAmt - amt)} will be deducted via payroll.`
      );
      setPartialInstId(null);
      setPartialAmt('');
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleSkip = async () => {
    if (!skipInst) return;
    const amt    = Number(skipAmt) || 0;
    const maxAmt = Number(skipInst.amount);
    if ((skipMode === 'cash' || skipMode === 'payroll') && !(amt > 0)) {
      toast.error('Enter a valid amount'); return;
    }
    if ((skipMode === 'cash' || skipMode === 'payroll') && amt >= maxAmt) {
      toast.error(`Amount must be less than the full EMI (${money(maxAmt)}). Use "Mark paid" for full payment.`); return;
    }
    if (skipMode === 'cash' && !paymentLedgerId) { toast.error('Select the cash or bank account that received the EMI'); return; }
    try {
      if (isLoan) {
        const li = skipInst as LoanInstallment;
        await skipLoan.mutateAsync({
          installmentId: li.id, loanId: li.loan_id,
          paidAmount:    skipMode === 'cash'    ? amt : 0,
          payrollAmount: skipMode === 'payroll' ? amt : 0,
          paymentLedgerId: skipMode === 'cash' ? paymentLedgerId : undefined,
        });
      } else {
        const ai = skipInst as AdvanceInstallment;
        await skipAdv.mutateAsync({
          installmentId: ai.id, advanceId: ai.advance_id,
          paidAmount:    skipMode === 'cash'    ? amt : 0,
          payrollAmount: skipMode === 'payroll' ? amt : 0,
          paymentLedgerId: skipMode === 'cash' ? paymentLedgerId : undefined,
        });
      }
      const deferred = maxAmt - (skipMode === 'skip' ? 0 : amt);
      const msg = skipMode === 'payroll'
        ? `EMI #${skipInst.emi_number}: ${money(amt)} will be deducted from payroll. ${money(deferred)} deferred to end of schedule.`
        : skipMode === 'cash'
          ? `EMI #${skipInst.emi_number}: ${money(amt)} collected now. ${money(deferred)} deferred to end of schedule.`
          : `EMI #${skipInst.emi_number} skipped. ${money(maxAmt)} deferred to end of schedule.`;
      toast.success(msg);
      setSkipInstId(null);
      setSkipAmt('');
      setSkipMode('skip');
    } catch (e) { toast.error((e as Error).message); }
  };

  const statusColor = (s: string) => {
    if (s === 'paid_payroll')              return 'text-emerald-700 dark:text-emerald-400';
    if (s === 'paid_manual')               return 'text-blue-700 dark:text-blue-400';
    if (s === 'paid_partial_manual')       return 'text-amber-600 dark:text-amber-400';
    if (s === 'skipped')                   return 'text-violet-600 dark:text-violet-400';
    if (s === 'partial_skipped')           return 'text-orange-600 dark:text-orange-400';
    if (s === 'payroll_partial_skipped')   return 'text-cyan-600 dark:text-cyan-400';
    return 'text-muted-foreground';
  };
  const statusLabel = (inst: LoanInstallment | AdvanceInstallment) => {
    if (inst.status === 'paid_payroll') return 'Paid via payroll';
    if (inst.status === 'paid_manual')  return 'Paid directly';
    if (inst.status === 'paid_partial_manual') {
      const pa = Number(inst.paid_amount || 0);
      return `Partial: ${money(pa)} paid, ${money(Number(inst.amount) - pa)} via payroll`;
    }
    if (inst.status === 'skipped') return 'Skipped — deferred to end';
    if (inst.status === 'partial_skipped') {
      const pa = Number(inst.paid_amount || 0);
      return `${money(pa)} paid — rest deferred`;
    }
    if (inst.status === 'payroll_partial_skipped') {
      const pa = Number(inst.paid_amount || 0);
      return `${money(pa)} via payroll — ${money(Number(inst.amount) - pa)} deferred`;
    }
    return 'Pending';
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onToggle}>
          {isOpen ? <ChevronDown className="h-4 w-4 opacity-60" /> : <ChevronRight className="h-4 w-4 opacity-60" />}
          <div className="min-w-0">
            <div className="font-medium">{emp ? fullName(emp) : 'Unknown'}</div>
            <div className="text-xs text-muted-foreground">
              Principal {money(l.principal)} · EMI {money(l.emi)} · {l.paid_months}/{l.months} paid · {l.status}
            </div>
          </div>
        </button>
        <div className="text-right text-xs"><div className="font-semibold">{money(trulyRemaining)}</div><div className="text-muted-foreground">left</div></div>
        {l.status === 'active' && (
          <Button size="sm" variant="outline" onClick={onPayToggle}>
            <CheckCircle2 className="mr-1 h-3 w-3" />Mark fully paid
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
      </div>

      {isPaying && (
        <div className="space-y-2 border-t bg-muted/30 px-4 py-3 text-sm">
          <div className="font-medium">Mark {label.toLowerCase()} fully paid off (cash)</div>
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <div className="space-y-1 sm:col-span-2">
              <Label>Discount amount (optional)</Label>
              <Input type="number" value={discount} onChange={e => onPayDiscount(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onPayToggle}>Cancel</Button>
              <Button onClick={onMarkFullPaid}>Confirm</Button>
            </div>
          </div>
        </div>
      )}

      {isOpen && (
        <div className="space-y-3 border-t bg-muted/20 px-4 py-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <Row k="Employee"      v={emp ? fullName(emp) : '—'} />
            <Row k="Principal"     v={money(l.principal)} />
            <Row k="Interest"      v={`${l.interest_rate}% ${l.interest_method}`} />
            <Row k="Months"        v={String(l.months)} />
            <Row k="EMI"           v={money(l.emi)} />
            <Row k="Total payable" v={money(l.total_payable)} />
            <Row k="Start date"    v={new Date(l.start_date).toLocaleDateString('en-IN')} />
            <Row k="Status"        v={l.status} />
            <Row k="Progress"      v={`${l.paid_months}/${l.months} EMIs paid`} />
            <Row k="Remaining"     v={money(trulyRemaining)} />
            {l.discount_amount > 0 && <Row k="Discount given" v={money(l.discount_amount)} />}
            {l.paid_off_date && <Row k="Paid off" v={new Date(l.paid_off_date).toLocaleDateString('en-IN')} />}
          </div>
          {l.notes && <div className="text-xs text-muted-foreground">Notes: {l.notes}</div>}

          {/* Installment schedule */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">EMI schedule (period-wise)</div>
              <div className="flex gap-1.5">
                {emp && (
                  <Button size="sm" variant="outline" onClick={() => {
                    try {
                      exportLoanDetailPdf({ loan: l, employee: emp, settings, kind: mode, installments });
                    } catch (e) {
                      toast.error(`PDF export failed: ${(e as Error).message}`);
                    }
                  }}>
                    <FileText className="mr-1 h-3 w-3" />PDF
                  </Button>
                )}
                {emp && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={handleSendWaLoanPdf}>
                    <MessageCircle className="h-3 w-3 text-green-600" />WA
                  </Button>
                )}
              </div>
            </div>

            {(lInstQ.isLoading || aInstQ.isLoading) ? (
              <Skeleton className="h-20 w-full" />
            ) : installments.length === 0 ? (
              <div className="text-xs text-muted-foreground">No installment schedule found.</div>
            ) : (
              <>
                {(directPayInstId || partialInstId || (skipInstId && skipMode === 'cash')) && (
                  <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:bg-emerald-950/20">
                    <Label className="text-xs text-emerald-800 dark:text-emerald-300">Received through (employee accounting branch)</Label>
                    <Select value={paymentLedgerId} onValueChange={setPaymentLedgerId}>
                      <SelectTrigger className="mt-1 h-8 bg-background text-sm"><SelectValue placeholder="Select cash or bank account" /></SelectTrigger>
                      <SelectContent>
                        {paymentLedgers.map(account => (
                          <SelectItem key={account.id} value={account.id}>{account.account_name} ({account.ledger_type})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!paymentLedgers.length && <p className="mt-1 text-xs text-destructive">No active cash or bank account is configured for this employee&apos;s accounting branch.</p>}
                    {directPayInstId && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" className="h-8" disabled={!paymentLedgerId} onClick={() => {
                          const selected = installments.find(item => item.id === directPayInstId);
                          if (selected) void handleMarkInstallmentPaid(selected);
                        }}>Confirm direct receipt</Button>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setDirectPayInstId(null)}>Cancel</Button>
                      </div>
                    )}
                  </div>
                )}
                {/* Partial payment panel */}
                {partialInstId && partialInst && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                    <div className="mb-2 font-semibold text-amber-800 dark:text-amber-300">
                      Partial payment — EMI #{partialInst.emi_number} (Full amount: {money(Number(partialInst.amount))})
                    </div>
                    <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                      Enter the amount received in cash. The remaining balance will be deducted from this employee's payroll for this period.
                    </p>
                    <div className="flex items-end gap-2">
                      <div className="space-y-1 flex-1">
                        <Label className="text-xs">Amount paid directly (₹)</Label>
                        <Input type="number" min={1} max={Number(partialInst.amount) - 1}
                          placeholder={`Max ${money(Number(partialInst.amount) - 1)}`}
                          value={partialAmt} onChange={e => setPartialAmt(e.target.value)}
                          className="h-8 text-sm" autoFocus />
                      </div>
                      {partialAmt && Number(partialAmt) > 0 && Number(partialAmt) < Number(partialInst.amount) && (
                        <div className="text-xs text-muted-foreground pb-1">
                          → {money(Number(partialInst.amount) - Number(partialAmt))} via payroll
                        </div>
                      )}
                      <Button size="sm" onClick={handlePartialPay} className="h-8">Save</Button>
                      <Button size="sm" variant="outline" onClick={() => { setPartialInstId(null); setPartialAmt(''); }} className="h-8">Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Skip / Partial+Skip panel */}
                {skipInstId && skipInst && (
                  <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-950/30 p-3 text-sm">
                    <div className="mb-2 font-semibold text-violet-800 dark:text-violet-300">
                      Skip EMI #{skipInst.emi_number} — {money(Number(skipInst.amount))}
                    </div>

                    {/* Mode selector */}
                    <div className="mb-3 flex flex-col gap-1.5 text-xs">
                      {([ ['skip','Skip entirely — defer full EMI to end'], ['cash','Partial collected (cash) — defer rest to end'], ['payroll','Partial via payroll deduction — defer rest to end'] ] as [typeof skipMode, string][]).map(([m, label]) => (
                        <label key={m} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="skipMode" value={m} checked={skipMode === m} onChange={() => { setSkipMode(m); setSkipAmt(''); }} />
                          <span className={skipMode === m ? 'font-medium text-violet-800 dark:text-violet-200' : 'text-muted-foreground'}>{label}</span>
                        </label>
                      ))}
                    </div>

                    {/* Amount input for partial modes */}
                    {skipMode !== 'skip' && (
                      <div className="mb-3 flex items-end gap-2 flex-wrap">
                        <div className="space-y-1 flex-1 min-w-[160px]">
                          <Label className="text-xs">
                            {skipMode === 'cash' ? 'Amount collected (₹)' : 'Amount to deduct from payroll (₹)'}
                          </Label>
                          <Input type="number" min={1} max={Number(skipInst.amount) - 1}
                            placeholder={`Max ${money(Number(skipInst.amount) - 1)}`}
                            value={skipAmt} onChange={e => setSkipAmt(e.target.value)}
                            className="h-8 text-sm" autoFocus />
                        </div>
                        {Number(skipAmt) > 0 && Number(skipAmt) < Number(skipInst.amount) && (
                          <div className="text-xs text-violet-700 dark:text-violet-400 pb-1 whitespace-nowrap">
                            → {money(Number(skipInst.amount) - Number(skipAmt))} deferred to end
                          </div>
                        )}
                      </div>
                    )}
                    {skipMode === 'skip' && (
                      <p className="mb-3 text-xs text-violet-600 dark:text-violet-400">
                        Full {money(Number(skipInst.amount))} will be added as a new EMI at the end of the schedule.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSkip} className="h-8 bg-violet-600 hover:bg-violet-700">
                        <SkipForward className="mr-1 h-3 w-3" />Confirm skip
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setSkipInstId(null); setSkipAmt(''); setSkipMode('skip'); }} className="h-8">Cancel</Button>
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">EMI #</th>
                        <th className="px-3 py-2 text-left font-medium">Due month</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                        <th className="px-3 py-2 text-right font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {installments.map(inst => {
                        const isGen           = !!(inst as LoanInstallment & { skip_generated?: boolean }).skip_generated;
                        const isPaid          = inst.status !== 'pending';
                        const isPartial       = inst.status === 'paid_partial_manual';
                        const isSkipped       = inst.status === 'skipped';
                        const isPartSkip      = inst.status === 'partial_skipped';
                        const isPayrollSkip   = inst.status === 'payroll_partial_skipped';
                        const wasPayroll      = inst.status === 'paid_payroll';
                        const rowBg = isSkipped     ? 'bg-violet-50/60 dark:bg-violet-950/20'
                          : isPartSkip              ? 'bg-orange-50/60 dark:bg-orange-950/20'
                          : isPayrollSkip           ? 'bg-cyan-50/60 dark:bg-cyan-950/20'
                          : isPartial               ? 'bg-amber-50/60 dark:bg-amber-950/20'
                          : isPaid                  ? 'bg-emerald-50/40 dark:bg-emerald-950/20'
                          : isGen                   ? 'bg-blue-50/30 dark:bg-blue-950/10'
                          : '';
                        return (
                          <tr key={inst.id} className={rowBg}>
                            <td className="px-3 py-1.5">
                              {inst.emi_number}
                              {isGen && <span className="ml-1 rounded bg-blue-100 dark:bg-blue-900 px-1 py-0.5 text-[10px] text-blue-700 dark:text-blue-300">ext.</span>}
                            </td>
                            <td className="px-3 py-1.5">
                              {new Date(inst.due_year, inst.due_month, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-3 py-1.5 text-right">{money(inst.amount)}</td>
                            <td className={`px-3 py-1.5 text-right font-medium ${statusColor(inst.status)}`}>
                              {statusLabel(inst)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {inst.status === 'pending' && (
                                  <>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                      onClick={() => handleMarkInstallmentPaid(inst)}>
                                      Mark paid
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-amber-700 hover:text-amber-800"
                                      onClick={() => { setPartialInstId(inst.id); setPartialAmt(''); setSkipInstId(null); }}>
                                      <SplitSquareHorizontal className="mr-1 h-3 w-3" />Partial
                                    </Button>
                                    {/* Skip only available on original (non-generated) installments */}
                                    {!isGen && (
                                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-violet-700 hover:text-violet-800"
                                        onClick={() => { setSkipInstId(inst.id); setSkipAmt(''); setSkipMode('skip'); setPartialInstId(null); }}>
                                        <SkipForward className="mr-1 h-3 w-3" />Skip
                                      </Button>
                                    )}
                                  </>
                                )}
                                {isPartial && (
                                  <>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-amber-700"
                                      onClick={() => { setPartialInstId(inst.id); setPartialAmt(String(inst.paid_amount || '')); setSkipInstId(null); }}>
                                      Edit partial
                                    </Button>
                                  </>
                                )}
                                {(isSkipped || isPartSkip || isPayrollSkip) && (
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-violet-700"
                                    onClick={() => { const mode = isPayrollSkip ? 'payroll' : (isPartSkip ? 'cash' : 'skip'); setSkipInstId(inst.id); setSkipAmt(String(inst.paid_amount || '')); setSkipMode(mode); setPartialInstId(null); }}>
                                    Edit skip
                                  </Button>
                                )}
                                {!isPartial && !isSkipped && !isPartSkip && !isPayrollSkip && wasPayroll && (
                                  <button
                                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline text-xs"
                                    onClick={() => handleMarkInstallmentPaid(inst)}
                                    title="Override: mark as paid directly (payroll deduction should be undone)"
                                  >
                                    <AlertCircle className="h-3 w-3" />Override
                                  </button>
                                )}
                                {inst.status !== 'pending' && (
                                  <button
                                    className="flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:underline text-xs"
                                    onClick={() => handleMarkInstallmentUnpaid(inst)}
                                    title="Undo — mark this EMI back to unpaid"
                                  >
                                    ↩ Undo
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>;
}
function Stat({ label, v }: { label: string; v: string }) {
  return <div className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold">{v}</div></div>;
}

function LoanForm({ mode, employees, onDone, onCreate }: {
  mode: 'loan' | 'advance';
  employees: Employee[];
  onDone: () => void;
  onCreate: (v: LoanInput) => Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [principal, setPrincipal]   = useState('0');
  const [rate]                      = useState('0');
  const [method] = useState<InterestMethod>('none');
  const [months, setMonths]         = useState('1');
  const [start, setStart]           = useState(ymd(new Date()));
  const [notes, setNotes]           = useState('');
  const [disbursementLedgerId, setDisbursementLedgerId] = useState('');
  const [disbursementLedgers, setDisbursementLedgers] = useState<Array<{ id: string; account_name: string; ledger_type: string }>>([]);
  const [loadingDisbursementLedgers, setLoadingDisbursementLedgers] = useState(false);
  const [disbursementError, setDisbursementError] = useState('');

  const emiCalc    = useMemo(() => computeEMI(Number(principal), Number(rate), method, Number(months)), [principal, rate, method, months]);
  const selectedEmp = useMemo(() => employees.find(e => e.id === employeeId) ?? null, [employees, employeeId]);
  const minStart    = selectedEmp?.joining_date ?? undefined;

  useEffect(() => {
    let cancelled = false;
    setDisbursementLedgerId('');
    setDisbursementLedgers([]);
    setDisbursementError('');
    if (!selectedEmp?.accounting_branch_id) return;
    setLoadingDisbursementLedgers(true);
    void supabase
      .from('ledger_accounts')
      .select('id,account_name,ledger_type')
      .eq('branch_id', selectedEmp.accounting_branch_id)
      .eq('is_active', true)
      .in('ledger_type', ['bank', 'cash'])
      .order('account_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setDisbursementError(error.message);
        setDisbursementLedgers((data ?? []) as Array<{ id: string; account_name: string; ledger_type: string }>);
      })
      .finally(() => { if (!cancelled) setLoadingDisbursementLedgers(false); });
    return () => { cancelled = true; };
  }, [selectedEmp?.accounting_branch_id]);

  const submit = async () => {
    if (!employeeId) { toast.error('Select an employee'); return; }
    if (!selectedEmp?.accounting_branch_id) { toast.error('Select an Accounting Branch for this employee first'); return; }
    if (!disbursementLedgerId) { toast.error(`Select the bank or cash account from which this ${mode} will be given`); return; }
    const P = Number(principal), n = Number(months);
    if (!(P > 0) || !(n > 0)) { toast.error('Enter valid amount and months'); return; }
    if (selectedEmp && start < selectedEmp.joining_date) {
      toast.error('Start date cannot be before employee joining date'); return;
    }
    if (selectedEmp?.date_of_leaving && start > selectedEmp.date_of_leaving) {
      toast.error('Start date is after employee leaving date'); return;
    }
    try {
      await onCreate({
        employee_id: employeeId,
        disbursement_ledger_id: disbursementLedgerId,
        principal: P,
        interest_rate: Number(rate) || 0,
        interest_method: method,
        months: n,
        emi: emiCalc.emi,
        total_payable: emiCalc.total,
        start_date: start,
        paid_months: 0,
        status: 'active',
        paid_off_date: null,
        discount_amount: 0,
        notes: notes.trim() || null,
      });
      toast.success(`${mode === 'loan' ? 'Loan' : 'Advance'} added — installment schedule generated`);
      onDone();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <div className="text-base font-semibold">Add {mode}</div>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {employees.filter(e => e.status === 'active').map(e => (
                <SelectItem key={e.id} value={e.id}>{fullName(e)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedEmp && (
            <div className="text-xs text-muted-foreground">
              Joined {new Date(selectedEmp.joining_date).toLocaleDateString('en-IN')}
              {selectedEmp.date_of_leaving ? ` · Left ${new Date(selectedEmp.date_of_leaving).toLocaleDateString('en-IN')}` : ''}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label>Paid from (employee Accounting Branch)</Label>
          <Select value={disbursementLedgerId} onValueChange={setDisbursementLedgerId} disabled={!selectedEmp?.accounting_branch_id || loadingDisbursementLedgers}>
            <SelectTrigger><SelectValue placeholder={loadingDisbursementLedgers ? 'Loading bank/cash accounts…' : 'Select bank or cash account'} /></SelectTrigger>
            <SelectContent>
              {disbursementLedgers.map(ledger => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.ledger_type})</SelectItem>)}
            </SelectContent>
          </Select>
          {!selectedEmp?.accounting_branch_id && <p className="text-xs text-muted-foreground">This employee has no Accounting Branch selected.</p>}
          {selectedEmp?.accounting_branch_id && !loadingDisbursementLedgers && !disbursementError && disbursementLedgers.length === 0 && <p className="text-xs text-muted-foreground">No active bank or cash accounts found for this Accounting Branch.</p>}
          {disbursementError && <p className="text-xs text-destructive">Could not load bank/cash accounts: {disbursementError}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Principal</Label><Input type="number" value={principal} onChange={e => setPrincipal(e.target.value)} /></div>
          <div className="space-y-1"><Label>Months</Label><Input type="number" value={months} onChange={e => setMonths(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Start date (first EMI due this month)</Label>
            <Input type="date" min={minStart} value={start} onChange={e => setStart(e.target.value)} />
          </div>
        </div>
        <div className="rounded-md border bg-muted/40 p-2 text-xs">
          Monthly EMI: <span className="font-semibold">{money(emiCalc.emi)}</span> · Total payable: <span className="font-semibold">{money(emiCalc.total)}</span>
          <br />
          <span className="text-muted-foreground">An installment schedule will be generated automatically for each calendar month.</span>
        </div>
        <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={submit}>Save</Button>
      </div>
    </div>
  );
}
