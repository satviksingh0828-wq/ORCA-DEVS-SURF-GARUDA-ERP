import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Users, Building2, Clock, TrendingUp, Cake, PartyPopper } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEmployees, useDepartments } from '@/lib/hooks';
import { ageFrom, computeSalary, dailyHours, fullName, type Employee, type Department } from '@/lib/types';
import { cn } from '@/lib/utils';

type PeriodKind = 'day' | 'week' | 'month' | 'year';
const PERIOD_MULTIPLIER: Record<PeriodKind, number> = {
  day: 1 / (4 * 5), // per working day (approx)
  week: 1 / 4,
  month: 1,
  year: 12,
};
const PERIOD_LABEL: Record<PeriodKind, string> = { day: 'day', week: 'week', month: 'month', year: 'year' };

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const GENDER_COLORS: Record<string, string> = { male: '#111827', female: '#9ca3af', other: '#4b5563' };

function daysUntil(monthDay: { m: number; d: number }): number {
  const now = new Date();
  const y = now.getFullYear();
  let target = new Date(y, monthDay.m, monthDay.d);
  if (target < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    target = new Date(y + 1, monthDay.m, monthDay.d);
  }
  return Math.floor((target.getTime() - new Date(y, now.getMonth(), now.getDate()).getTime()) / (1000 * 60 * 60 * 24));
}

function upcoming(employees: Employee[], dateKey: 'dob' | 'joining_date') {
  return employees
    .filter(e => e.status === 'active' && e[dateKey])
    .map(e => {
      const d = new Date(e[dateKey]);
      const days = daysUntil({ m: d.getMonth(), d: d.getDate() });
      return { e, days, date: d };
    })
    .filter(x => x.days <= 60)
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);
}

export function EmployeeDashboard() {
  const { data: employees, isLoading: le } = useEmployees();
  const { data: departments, isLoading: ld } = useDepartments();
  const [period, setPeriod] = useState<PeriodKind>('month');
  const mult = PERIOD_MULTIPLIER[period];
  const periodLabel = PERIOD_LABEL[period];

  const stats = useMemo(() => {
    if (!employees || !departments) return null;
    return buildStats(employees, departments);
  }, [employees, departments]);

  if (le || ld || !stats) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <div className="inline-flex gap-1 rounded-lg border bg-card p-1">
          {(['day', 'week', 'month', 'year'] as PeriodKind[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                period === p ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
            >{p}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Building2 className="h-4 w-4" />} label="Departments" value={stats.deptCount} />
        <Stat icon={<Users className="h-4 w-4" />} label="Active employees" value={stats.activeCount} sub={`${stats.totalCount} total`} />
        <Stat icon={<Clock className="h-4 w-4" />} label={`Total working hrs / ${periodLabel}`} value={(stats.totalHours * mult).toFixed(0)} />
        <Stat icon={<TrendingUp className="h-4 w-4" />} label={`Avg working hrs / employee / ${periodLabel}`} value={(stats.avgHours * mult).toFixed(1)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Age distribution</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.ageBuckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="range" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Gender distribution</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.genderData} dataKey="value" nameKey="name" outerRadius={90} label>
                  {stats.genderData.map(g => <Cell key={g.name} fill={GENDER_COLORS[g.name] ?? '#94a3b8'} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <h2 className="border-b p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Working hours by department ({periodLabel})</h2>
        {stats.deptHours.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No departments yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Active employees</TableHead>
                <TableHead className="text-right">Total monthly hrs</TableHead>
                <TableHead className="text-right">Avg / employee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.deptHours.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-right">{d.count}</TableCell>
                <TableCell className="text-right">{(d.total * mult).toFixed(0)}</TableCell>
                <TableCell className="text-right">{d.count ? ((d.total / d.count) * mult).toFixed(1) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat icon={<TrendingUp className="h-4 w-4" />} label={`Total salary paid / ${periodLabel}`} value={`₹${Math.round(stats.totalSalary * mult).toLocaleString('en-IN')}`} />
        <Stat icon={<TrendingUp className="h-4 w-4" />} label={`Average salary / ${periodLabel}`} value={`₹${Math.round(stats.avgSalary * mult).toLocaleString('en-IN')}`} />
        <Stat icon={<TrendingUp className="h-4 w-4" />} label={`Median salary / ${periodLabel}`} value={`₹${Math.round(stats.medianSalary * mult).toLocaleString('en-IN')}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card">
          <h2 className="flex items-center gap-2 border-b p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><Cake className="h-4 w-4" />Upcoming birthdays</h2>
          {stats.birthdays.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">None in the next 60 days.</p>
          ) : (
            <ul className="divide-y">
              {stats.birthdays.map(({ e, days, date }) => (
                <li key={e.id} className="flex items-center justify-between p-3 text-sm">
                  <Link to="/employees/$id" params={{ id: e.id }} className="font-medium hover:underline">{fullName(e)}</Link>
                  <span className="text-muted-foreground">{date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {days === 0 ? 'today' : `in ${days}d`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border bg-card">
          <h2 className="flex items-center gap-2 border-b p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><PartyPopper className="h-4 w-4" />Work anniversaries</h2>
          {stats.anniversaries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">None in the next 60 days.</p>
          ) : (
            <ul className="divide-y">
              {stats.anniversaries.map(({ e, days, date }) => {
                const years = new Date().getFullYear() - new Date(e.joining_date).getFullYear();
                return (
                  <li key={e.id} className="flex items-center justify-between p-3 text-sm">
                    <Link to="/employees/$id" params={{ id: e.id }} className="font-medium hover:underline">{fullName(e)}</Link>
                    <span className="text-muted-foreground">{date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {years}y · {days === 0 ? 'today' : `in ${days}d`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function buildStats(employees: Employee[], departments: Department[]) {
  const active = employees.filter(e => e.status === 'active');

  const deptById = new Map(departments.map(d => [d.id, d] as const));
  const empHours = (e: Employee) => {
    const dept = e.department_id ? deptById.get(e.department_id) : null;
    const days = dept ? dept.working_days_of_week.length : 5;
    return dailyHours(e) * days * 4;
  };

  const totalHours = active.reduce((s, e) => s + empHours(e), 0);
  const avgHours = active.length ? totalHours / active.length : 0;

  const ageRanges = [
    { range: '<25', min: 0, max: 24 },
    { range: '25-34', min: 25, max: 34 },
    { range: '35-44', min: 35, max: 44 },
    { range: '45-54', min: 45, max: 54 },
    { range: '55+', min: 55, max: 200 },
  ];
  const ageBuckets = ageRanges.map(r => ({
    range: r.range,
    count: active.filter(e => { const a = ageFrom(e.dob); return a >= r.min && a <= r.max; }).length,
  }));

  const genderMap: Record<string, number> = {};
  active.forEach(e => { genderMap[e.gender] = (genderMap[e.gender] ?? 0) + 1; });
  const genderData = Object.entries(genderMap).map(([name, value]) => ({ name, value }));

  const deptHours = departments.map(d => {
    const emps = active.filter(e => e.department_id === d.id);
    return { id: d.id, name: d.name, count: emps.length, total: emps.reduce((s, e) => s + empHours(e), 0) };
  });

  const salaries = active.map(e => computeSalary(e).net);
  const totalSalary = salaries.reduce((s, v) => s + v, 0);
  const avgSalary = salaries.length ? totalSalary / salaries.length : 0;
  const sorted = [...salaries].sort((a, b) => a - b);
  const medianSalary = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;

  return {
    deptCount: departments.length,
    activeCount: active.length,
    totalCount: employees.length,
    totalHours, avgHours, ageBuckets, genderData, deptHours,
    totalSalary, avgSalary, medianSalary,
    birthdays: upcoming(employees, 'dob'),
    anniversaries: upcoming(employees, 'joining_date'),
  };
}
