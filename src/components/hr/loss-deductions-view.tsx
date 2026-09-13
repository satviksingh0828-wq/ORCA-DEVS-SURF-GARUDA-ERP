import { useMemo, useState } from 'react';
import { MinusCircle, Plus, CheckCircle2, Trash2, Download, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  useEmployees, useLossDeductions, useCreateLossDeduction,
  useUpdateLossDeduction, useDeleteLossDeduction, useAppSettings,
} from '@/lib/hooks';
import { fullName } from '@/lib/types';
import type { Employee } from '@/lib/types';
import { ymd } from '@/lib/attendance-utils';
import { exportLossDeductionsPdf } from '@/lib/pdf-export';
import { isWaConnected, sendWaMessage, normalizeWaNumber } from '@/lib/whatsapp';

function money(n: number) {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LossDeductionsView() {
  const { data: employees } = useEmployees();
  const { data: list, isLoading } = useLossDeductions();
  const { data: settings } = useAppSettings();
  const create = useCreateLossDeduction();
  const upd = useUpdateLossDeduction();
  const del = useDeleteLossDeduction();
  const empMap = useMemo(() => new Map((employees ?? []).map(e => [e.id, e] as const)), [employees]);

  const [showAdd, setShowAdd] = useState(false);
  const [empId, setEmpId] = useState('');
  const [amt, setAmt] = useState('0');
  const [reason, setReason] = useState('');
  const [journalDate, setJournalDate] = useState(ymd(new Date()));

  const totals = useMemo(() => {
    const all = list ?? [];
    return {
      count: all.length,
      pending: all.filter(d => d.status === 'pending').reduce((s, d) => s + Number(d.amount), 0),
      total: all.reduce((s, d) => s + Number(d.amount), 0),
    };
  }, [list]);

  const submit = async () => {
    if (!empId || !(Number(amt) > 0)) { toast.error('Select employee and amount'); return; }
    try {
      await create.mutateAsync({ employee_id: empId, amount: Number(amt), reason: reason.trim(), journal_date: journalDate, status: 'pending', payroll_id: null, deducted_on: null });
      toast.success('Added — will deduct in next payroll');
      // Auto-send WA notification if enabled
      if (settings?.wa_send_loss_deduction) {
        const emp = (employees ?? []).find(e => e.id === empId);
        const waNum = normalizeWaNumber(emp?.mobile);
        if (waNum) {
          try {
            if (await isWaConnected()) {
              const msg =
                `Hi ${fullName(emp!)}, a loss deduction of Rs.${Number(amt).toLocaleString('en-IN', { minimumFractionDigits: 2 })} has been recorded` +
                (reason.trim() ? ` (Reason: ${reason.trim()})` : '') +
                `. This will be deducted from your next payroll.`;
              await sendWaMessage(waNum, msg);
            }
          } catch { /* silent */ }
        }
      }
      setShowAdd(false); setEmpId(''); setAmt('0'); setReason(''); setJournalDate(ymd(new Date()));
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleSendWaDeduction = async (d: { employee_id: string; amount: number; reason?: string | null }, emp: Employee | undefined) => {
    const waNum = normalizeWaNumber(emp?.mobile);
    if (!waNum) { toast.error('Employee has no mobile number'); return; }
    try {
      if (!await isWaConnected()) { toast.error('WhatsApp is not connected'); return; }
      const msg =
        `Hi ${fullName(emp!)}, a loss deduction of Rs.${Number(d.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} has been recorded` +
        (d.reason ? ` (Reason: ${d.reason})` : '') + `.`;
      const ok = await sendWaMessage(waNum, msg);
      if (ok) toast.success('Notification sent via WhatsApp');
      else toast.error('Failed to send via WhatsApp');
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><MinusCircle className="h-5 w-5" /> Loss deductions</h1>
          <p className="text-sm text-muted-foreground">Pending amounts auto-deduct from the employee&apos;s next payroll.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!list?.length} onClick={() => {
            try {
              exportLossDeductionsPdf({ deductions: list ?? [], employees: employees ?? [], settings });
            } catch (e) {
              toast.error(`PDF export failed: ${(e as Error).message}`);
            }
          }}>
            <Download className="mr-1 h-4 w-4" />Export PDF
          </Button>
          <Button onClick={() => setShowAdd(v => !v)}><Plus className="mr-1 h-4 w-4" />{showAdd ? 'Close' : 'Add deduction'}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Records" v={String(totals.count)} />
        <Stat label="Pending" v={money(totals.pending)} />
        <Stat label="Total" v={money(totals.total)} />
      </div>

      {showAdd && (
        <div className="space-y-3 rounded-lg border bg-card p-4 sm:p-6">
          <div className="text-base font-semibold">Add loss deduction</div>
          <div className="space-y-1">
            <Label>Employee</Label>
            <Select value={empId} onValueChange={setEmpId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{(employees ?? []).filter(e => e.status === 'active').map(e => <SelectItem key={e.id} value={e.id}>{fullName(e)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Amount</Label><Input type="number" value={amt} onChange={e => setAmt(e.target.value)} /></div>
            <div className="space-y-1"><Label>Journal date</Label><Input type="date" value={journalDate} onChange={e => setJournalDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Reason</Label><Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={submit}>Save</Button>
          </div>
        </div>
      )}

      {isLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="rounded-lg border bg-card">
          {(list ?? []).length === 0 ? <div className="p-4 text-sm text-muted-foreground">None yet.</div> : (
            <div className="divide-y">
              {(list ?? []).map(d => {
                const emp = empMap.get(d.employee_id);
                return (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{emp ? fullName(emp) : '—'} · {money(d.amount)}</div>
                      <div className="text-xs text-muted-foreground">{d.reason || '(no reason)'} · status: {d.status}{d.deducted_on ? ` on ${new Date(d.deducted_on).toLocaleDateString('en-IN')}` : ''}</div>
                    </div>
                    <div className="flex gap-1">
                      {d.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={async () => {
                          try { await upd.mutateAsync({ id: d.id, values: { status: 'paid', deducted_on: ymd(new Date()) } }); toast.success('Marked paid'); }
                          catch (e) { toast.error((e as Error).message); }
                        }}><CheckCircle2 className="mr-1 h-3 w-3" />Mark paid</Button>
                      )}
                      <Button size="sm" variant="ghost" title="Send via WhatsApp" onClick={() => handleSendWaDeduction(d, emp)}>
                        <MessageCircle className="h-3 w-3 text-green-600" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm('Delete?')) del.mutate(d.id); }}><Trash2 className="h-3 w-3" /></Button>
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

function Stat({ label, v }: { label: string; v: string }) {
  return <div className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold">{v}</div></div>;
}
