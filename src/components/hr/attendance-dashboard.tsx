import { useMemo, useState } from 'react';
import { Users, CalendarCheck, TrendingDown, ClipboardList } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEmployees, useDepartments, useHolidays, useAllAttendance } from '@/lib/hooks';
import { periodRange, countWorkingDays, ymd } from '@/lib/attendance-utils';
import type { Attendance } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { currentFinancialYearStart, financialYearLabel, financialYearOptions } from '@/lib/financial-year';

type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'past_year' | 'past_3_year';

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'past_year', label: 'Past year' },
  { value: 'past_3_year', label: 'Past 3 years' },
];

function computeRange(kind: PeriodKind) {
  if (kind === 'past_year') {
    const to = new Date(); to.setHours(0,0,0,0);
    const from = new Date(to); from.setFullYear(to.getFullYear() - 1);
    return { from, to, label: 'Past 12 months' };
  }
  if (kind === 'past_3_year') {
    const to = new Date(); to.setHours(0,0,0,0);
    const from = new Date(to); from.setFullYear(to.getFullYear() - 3);
    return { from, to, label: 'Past 3 years' };
  }
  return periodRange(kind);
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

export function AttendanceDashboard() {
  const [period, setPeriod] = useState<PeriodKind>('month');
  const [financialYear, setFinancialYear] = useState('none');
  const financialYears = useMemo(() => financialYearOptions(currentFinancialYearStart()), []);
  const range = useMemo(() => {
    if (financialYear === 'none') return computeRange(period);
    const start = Number(financialYear);
    return {
      from: new Date(start, 3, 1),
      to: new Date(start + 1, 2, 31),
      label: `Financial Year ${financialYearLabel(start)} (April–March)`,
    };
  }, [period, financialYear]);
  const { data: employees, isLoading: le } = useEmployees();
  const { data: departments, isLoading: ld } = useDepartments();
  const { data: holidays } = useHolidays();
  const { data: attendance, isLoading: la } = useAllAttendance(ymd(range.from), ymd(range.to));

  const stats = useMemo(() => {
    if (!employees || !departments) return null;
    const active = employees.filter(e => e.status === 'active');
    const holidayList = holidays ?? [];
    const att = attendance ?? [];
    const dayCount = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000) + 1);
    const isMultiDay = financialYear !== 'none' || period !== 'day';

    // Overall counts
    const totalPresent = att.filter(a => a.status === 'present').length;
    const totalHalf = att.filter(a => a.status === 'half_day').length;
    const totalAbsent = att.filter(a => a.status === 'absent').length;

    // Department breakdown
    const deptRows = departments.map(d => {
      const emps = active.filter(e => e.department_id === d.id);
      const empIds = new Set(emps.map(e => e.id));
      const rec = att.filter(a => empIds.has(a.employee_id));
      const present = rec.filter(a => a.status === 'present').length;
      const half = rec.filter(a => a.status === 'half_day').length;
      const absent = rec.filter(a => a.status === 'absent').length;
      let workingDays = 0;
      for (const e of emps) {
        workingDays += countWorkingDays(range.from, range.to, d, holidayList, e.joining_date);
      }
      return { id: d.id, name: d.name, count: emps.length, present, half, absent, workingDays };
    });

    // Per-day chart (bucket rollup)
    const perDay: Record<string, { present: number; half: number; absent: number }> = {};
    const cur = new Date(range.from);
    while (cur <= range.to) {
      perDay[ymd(cur)] = { present: 0, half: 0, absent: 0 };
      cur.setDate(cur.getDate() + 1);
    }
    att.forEach((a: Attendance) => {
      const bucket = perDay[a.date];
      if (!bucket) return;
      if (a.status === 'present') bucket.present++;
      else if (a.status === 'half_day') bucket.half++;
      else if (a.status === 'absent') bucket.absent++;
    });
    const chartData = Object.entries(perDay).map(([date, v]) => ({
      date: date.slice(5),
      Present: v.present,
      Half: v.half,
      Absent: v.absent,
    }));

    // For period=day metrics: show today snapshot; for others show averages
    const dayLabel = isMultiDay ? 'avg / day' : 'today';
    const denominator = isMultiDay ? dayCount : 1;
    const presentMetric = isMultiDay ? Math.round(totalPresent / denominator) : totalPresent;
    const absentMetric = isMultiDay ? Math.round(totalAbsent / denominator) : totalAbsent;

    // On leave today (absent on the "to" date used for day snapshot)
    let onLeaveToday = 0;
    if (!isMultiDay) {
      const key = ymd(range.from);
      onLeaveToday = att.filter(a => a.date === key && a.status === 'absent').length;
    } else {
      onLeaveToday = totalAbsent;
    }

    return {
      totalEmployees: active.length,
      totalCount: employees.length,
      presentMetric,
      absentMetric,
      totalHalf,
      onLeave: onLeaveToday,
      dayLabel,
      deptRows,
      chartData,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, departments, holidays, attendance, period, financialYear, range.from, range.to]);

  if (le || ld || la || !stats) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Select value={financialYear} onValueChange={setFinancialYear}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Financial Year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Financial Year: None</SelectItem>
              {financialYears.map(fy => <SelectItem key={fy.value} value={fy.value}>FY {fy.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => { setFinancialYear('none'); setPeriod(p.value); }}
              className={cn('rounded-md border px-3 py-1.5 text-xs font-medium',
                period === p.value ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
            >{p.label}</button>
          ))}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{range.label}</div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Users className="h-4 w-4" />} label="Active employees" value={stats.totalEmployees} sub={`${stats.totalCount} total`} />
        <Stat icon={<CalendarCheck className="h-4 w-4" />} label={`Present (${stats.dayLabel})`} value={stats.presentMetric} />
        <Stat icon={<ClipboardList className="h-4 w-4" />} label={`Half day (total)`} value={stats.totalHalf} />
        <Stat icon={<TrendingDown className="h-4 w-4" />} label={period === 'day' ? 'On leave today' : 'Absent (total)'} value={stats.onLeave} />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Daily attendance</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" fontSize={10} />
              <YAxis fontSize={10} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Present" stackId="a" fill="#059669" />
              <Bar dataKey="Half" stackId="a" fill="#d97706" />
              <Bar dataKey="Absent" stackId="a" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <h2 className="border-b p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Department-wise attendance</h2>
        {stats.deptRows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No departments yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="text-right">Working days</TableHead>
                <TableHead className="text-right text-emerald-700">Present</TableHead>
                <TableHead className="text-right text-amber-700">Half</TableHead>
                <TableHead className="text-right text-red-700">Absent</TableHead>
                <TableHead className="text-right">Attendance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.deptRows.map(d => {
                const denom = d.workingDays || 1;
                const pct = Math.round(((d.present + d.half * 0.5) / denom) * 100);
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-right">{d.count}</TableCell>
                    <TableCell className="text-right">{d.workingDays}</TableCell>
                    <TableCell className="text-right text-emerald-700">{d.present}</TableCell>
                    <TableCell className="text-right text-amber-700">{d.half}</TableCell>
                    <TableCell className="text-right text-red-700">{d.absent}</TableCell>
                    <TableCell className="text-right">{d.workingDays ? `${pct}%` : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
