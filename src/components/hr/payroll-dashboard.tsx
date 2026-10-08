import { useMemo, useState } from 'react';
import { Wallet, TrendingUp, Banknote, HandCoins, MinusCircle, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEmployees, useAllPayrolls, useLoans, useAdvances, useLossDeductions } from '@/lib/hooks';
import { fullName } from '@/lib/types';
import { loanRemaining } from '@/lib/payroll-utils';
import { currentFinancialYearStart, dateInFinancialYear, financialYearLabel, financialYearOptions } from '@/lib/financial-year';

function money(n: number) {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PayrollDashboard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | 'all'>('all');
  const [financialYear, setFinancialYear] = useState('none');
  const financialYears = useMemo(() => financialYearOptions(currentFinancialYearStart()), []);

  const { data: payrolls, isLoading: lp } = useAllPayrolls();
  const { data: employees, isLoading: le } = useEmployees();
  const { data: loans } = useLoans();
  const { data: advances } = useAdvances();
  const { data: deductions } = useLossDeductions();

  const stats = useMemo(() => {
    const emps = employees ?? [];
    const empMap = new Map(emps.map(e => [e.id, e] as const));
    const pays = (payrolls ?? []).filter(p => {
      if (financialYear !== 'none') return dateInFinancialYear(p.period_start, financialYear);
      const d = new Date(p.period_start);
      if (d.getFullYear() !== year) return false;
      if (month !== 'all' && d.getMonth() !== month) return false;
      return true;
    });

    const monthly = MONTHS.map((m) => ({ month: m, gross: 0, net: 0, deductions: 0 }));
    (payrolls ?? []).filter(p => financialYear !== 'none'
      ? dateInFinancialYear(p.period_start, financialYear)
      : new Date(p.period_start).getFullYear() === year).forEach(p => {
      const mi = new Date(p.period_start).getMonth();
      monthly[mi].gross += Number(p.gross);
      monthly[mi].net += Number(p.net);
      monthly[mi].deductions += Number(p.gross) - Number(p.net);
    });

    const totalNet = pays.reduce((s, p) => s + Number(p.net), 0);
    const totalGross = pays.reduce((s, p) => s + Number(p.gross), 0);
    const totalDed = totalGross - totalNet;
    const paidEmployees = new Set(pays.map(p => p.employee_id)).size;

    const perEmployee = new Map<string, number>();
    pays.forEach(p => perEmployee.set(p.employee_id, (perEmployee.get(p.employee_id) ?? 0) + Number(p.net)));
    const topEarners = Array.from(perEmployee.entries())
      .map(([id, total]) => ({ emp: empMap.get(id), total }))
      .filter(x => x.emp)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const activeLoans = (loans ?? []).filter(l => l.status === 'active');
    const activeAdvances = (advances ?? []).filter(l => l.status === 'active');
    const pendingDeductions = (deductions ?? []).filter(d => d.status === 'pending');
    const loanRem = activeLoans.reduce((s, l) => s + loanRemaining(l), 0);
    const advRem = activeAdvances.reduce((s, l) => s + loanRemaining(l), 0);
    const dedPending = pendingDeductions.reduce((s, d) => s + Number(d.amount), 0);

    const breakdown = [
      { name: 'Net paid', value: Math.max(0, totalNet) },
      { name: 'Deductions', value: Math.max(0, totalDed) },
    ];

    return {
      monthly, totalNet, totalGross, totalDed, paidEmployees,
      topEarners, activeLoans: activeLoans.length, activeAdvances: activeAdvances.length,
      pendingDedCount: pendingDeductions.length,
      loanRem, advRem, dedPending, breakdown,
      payrollCount: pays.length,
    };
  }, [payrolls, employees, loans, advances, deductions, year, month, financialYear]);

  if (lp || le) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const scope = financialYear !== 'none'
    ? `FY ${financialYearLabel(Number(financialYear))}`
    : month === 'all' ? String(year) : `${MONTHS[month]} ${year}`;
  const hasBreakdownData = stats.breakdown.some(b => b.value > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={financialYear} onValueChange={setFinancialYear}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Financial Year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Financial Year: None</SelectItem>
              {financialYears.map(fy => <SelectItem key={fy.value} value={fy.value}>FY {fy.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={v => { setFinancialYear('none'); setMonth(v === 'all' ? 'all' : Number(v)); }}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-1.5">
            {[year - 1, year, year + 1].map(y => (
              <button key={y} onClick={() => { setFinancialYear('none'); setYear(y); }} className={'rounded-md border px-3 py-1.5 text-xs font-medium ' + (financialYear === 'none' && y === year ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}>{y}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<TrendingUp className="h-4 w-4" />} label={`Total net paid — ${scope}`} value={money(stats.totalNet)} sub={`${stats.payrollCount} payslips`} />
        <Stat icon={<Users className="h-4 w-4" />} label="Employees paid" value={String(stats.paidEmployees)} />
        <Stat icon={<Wallet className="h-4 w-4" />} label={`Gross — ${scope}`} value={money(stats.totalGross)} sub={`Deductions ${money(stats.totalDed)}`} />
        <Stat icon={<MinusCircle className="h-4 w-4" />} label="Pending loss deductions" value={money(stats.dedPending)} sub={`${stats.pendingDedCount} records`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Stat icon={<Banknote className="h-4 w-4" />} label="Active loans" value={String(stats.activeLoans)} sub={`Remaining ${money(stats.loanRem)}`} />
        <Stat icon={<HandCoins className="h-4 w-4" />} label="Active advances" value={String(stats.activeAdvances)} sub={`Remaining ${money(stats.advRem)}`} />
        <Stat icon={<MinusCircle className="h-4 w-4" />} label="Pending deductions" value={String(stats.pendingDedCount)} sub={money(stats.dedPending)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Monthly payroll — {scope}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Legend />
                <Bar dataKey="gross" name="Gross" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="net" name="Net" fill="#111827" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Net vs deductions — {scope}</h2>
          <div className="h-64">
            {hasBreakdownData ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.breakdown} dataKey="value" nameKey="name" outerRadius={90} label={(e: { name: string; value: number }) => `${e.name}`}>
                    <Cell fill="#111827" />
                    <Cell fill="#9ca3af" />
                  </Pie>
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data for this period.</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <h2 className="border-b p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Top earners — {scope}</h2>
        {stats.topEarners.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No payrolls in this period.</p>
        ) : (
          <ul className="divide-y">
            {stats.topEarners.map(t => (
              <li key={t.emp!.id} className="flex items-center justify-between p-3 text-sm">
                <span className="font-medium">{fullName(t.emp!)}</span>
                <span className="font-semibold">{money(t.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
