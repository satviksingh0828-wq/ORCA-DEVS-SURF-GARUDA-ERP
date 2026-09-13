import { useMemo, useState } from 'react';
import { CheckCircle2, Download, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useCreateIncentiveAmount, useDeleteIncentiveAmount, useEmployees, useIncentiveAmounts, useMarkIncentivePaid } from '@/lib/hr/hooks';
import { fullName } from '@/lib/hr/types';
import { ymd } from '@/lib/attendance-utils';

const money = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function IncentiveAmountsView() {
  const { data: employees } = useEmployees();
  const { data: records, isLoading } = useIncentiveAmounts();
  const create = useCreateIncentiveAmount();
  const markPaid = useMarkIncentivePaid();
  const remove = useDeleteIncentiveAmount();
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [journalDate, setJournalDate] = useState(ymd(new Date()));
  const activeEmployees = (employees ?? []).filter(e => e.status === 'active');
  const pendingTotal = useMemo(() => (records ?? []).filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0), [records]);
  const allTimeTotal = useMemo(() => (records ?? []).reduce((s, r) => s + Number(r.amount), 0), [records]);
  const employeeMap = useMemo(() => new Map((employees ?? []).map(e => [e.id, e])), [employees]);

  async function add() {
    const value = Number(amount);
    if (!employeeId || !Number.isFinite(value) || value <= 0) { toast.error('Select an employee and enter a positive amount.'); return; }
    try {
      await create.mutateAsync({ employee_id: employeeId, amount: value, reason: reason.trim() || null, journal_date: journalDate });
      setAmount(''); setReason(''); setJournalDate(ymd(new Date())); toast.success('Incentive amount added.');
    } catch (e) { toast.error((e as Error).message); }
  }
  function exportCsv() {
    const rows = [['Employee', 'Amount', 'Reason', 'Status', 'Payroll ID', 'Handled on'], ...(records ?? []).map(r => [employeeMap.get(r.employee_id) ? fullName(employeeMap.get(r.employee_id)!) : r.employee_id, String(r.amount), r.reason ?? '', r.status, r.payroll_id ?? '', r.added_on ?? ''])];
    const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'incentive-amounts.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
  return <div className="mx-auto max-w-5xl space-y-4">
    <div><h1 className="text-xl font-bold sm:text-2xl">Incentive amounts</h1><p className="text-sm text-muted-foreground">One-time additions applied to the employee's next generated payroll.</p></div>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border bg-card p-4"><div className="text-xs text-muted-foreground">Total records</div><div className="text-2xl font-bold">{records?.length ?? 0}</div></div><div className="rounded-lg border bg-card p-4"><div className="text-xs text-muted-foreground">Pending total</div><div className="text-2xl font-bold">{money(pendingTotal)}</div></div><div className="rounded-lg border bg-card p-4"><div className="text-xs text-muted-foreground">All-time total</div><div className="text-2xl font-bold">{money(allTimeTotal)}</div></div></div>
    <div className="rounded-lg border bg-card p-4"><div className="mb-3 text-sm font-semibold">Add one-time incentive</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><div><Label>Employee</Label><Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger><SelectContent>{activeEmployees.map(e => <SelectItem key={e.id} value={e.id}>{fullName(e)}</SelectItem>)}</SelectContent></Select></div><div><Label>Amount</Label><Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="₹0.00" /></div><div><Label>Reason (optional)</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason" /></div><div><Label>Journal date</Label><Input type="date" value={journalDate} onChange={e => setJournalDate(e.target.value)} /></div><div className="flex items-end"><Button onClick={add} disabled={create.isPending}><Plus className="mr-1 h-4 w-4" />Add</Button></div></div></div>
    <div className="flex justify-end"><Button variant="outline" onClick={exportCsv} disabled={!records?.length}><Download className="mr-1 h-4 w-4" />Export register</Button></div>
    <div className="rounded-lg border bg-card"><div className="border-b px-4 py-3 text-sm font-semibold">Incentive register</div>{isLoading ? <div className="p-4 text-sm text-muted-foreground">Loading…</div> : !records?.length ? <div className="p-4 text-sm text-muted-foreground">No incentive amounts yet.</div> : <div className="divide-y">{records.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><div className="font-medium">{employeeMap.get(r.employee_id) ? fullName(employeeMap.get(r.employee_id)!) : 'Unknown employee'}</div><div className="text-xs text-muted-foreground">{r.reason || 'No reason'} · {r.status}{r.payroll_id ? ` · payroll ${r.payroll_id.slice(0, 8)}` : ''}</div></div><div className="flex items-center gap-3"><span className="font-semibold">{money(r.amount)}</span>{r.status === 'pending' && <Button size="sm" variant="outline" onClick={() => markPaid.mutate(r.id)}><CheckCircle2 className="mr-1 h-3 w-3" />Mark handled</Button>}<Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)} aria-label="Delete incentive"><Trash2 className="h-4 w-4" /></Button></div></div>)}</div>}</div>
  </div>;
}
