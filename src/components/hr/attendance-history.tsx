import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Search, ChevronLeft, Download, MessageCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEmployees, useDepartments, useHolidays, useAllAttendance, useAttendanceForEmployee, useEmployee, useAppSettings } from '@/lib/hooks';
import { fullName } from '@/lib/types';
import { ymd, parseYmd, isWorkingDay, periodRange, summarizeAttendance, computeLeavesBalance, type PeriodKind } from '@/lib/attendance-utils';
import { exportEmployeeAttendancePdf, getAttendancePdfBase64 } from '@/lib/pdf-export';
import { isWaConnected, sendWaPdf, normalizeWaNumber } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function AttendanceHistoryList() {
  const { data: employees, isLoading: le } = useEmployees();
  const { data: departments } = useDepartments();
  const { data: holidays } = useHolidays();
  const [period, setPeriod] = useState<typeof PERIODS[number]['value']>('month');
  const { from, to, label: periodLabel } = computeRange(period);
  const { data: att } = useAllAttendance(ymd(from), ymd(to));
  const [search, setSearch] = useState('');

  const deptById = useMemo(() => new Map((departments ?? []).map(d => [d.id, d] as const)), [departments]);
  const attByEmp = useMemo(() => {
    const m = new Map<string, typeof att>();
    (att ?? []).forEach(r => { const arr = m.get(r.employee_id) ?? []; arr.push(r); m.set(r.employee_id, arr); });
    return m;
  }, [att]);

  if (le) return <Skeleton className="h-96 w-full" />;
  const filtered = (employees ?? []).filter(e => fullName(e).toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">Attendance history</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2"><div className="flex gap-1">{(['day', 'week', 'month'] as const).map((value) => <button key={value} type="button" onClick={() => setPeriod(value)} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium capitalize', period === value ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}>{value}</button>)}</div><span className="text-xs text-muted-foreground">{periodLabel}</span></div>
      </div>
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search employees" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Present</TableHead>
              <TableHead className="text-right">Half day</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Extra work</TableHead>
              <TableHead className="text-right">Working days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(e => {
              const dept = e.department_id ? deptById.get(e.department_id) : null;
              const s = summarizeAttendance(attByEmp.get(e.id) ?? [], e, dept, holidays ?? [], from, to);
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link to="/attendance/history/$id" params={{ id: e.id }} className="font-medium hover:underline">{fullName(e)}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dept?.name ?? '—'}</TableCell>
                  <TableCell className="text-right text-emerald-700">{s.present}</TableCell>
                  <TableCell className="text-right text-amber-700">{s.halfDay}</TableCell>
                  <TableCell className="text-right text-red-700">{s.absent}</TableCell>
                  <TableCell className="text-right text-blue-700">{s.extraWork > 0 ? s.extraWork : '—'}</TableCell>
                  <TableCell className="text-right">{s.workingDays}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const PERIODS: { value: PeriodKind | 'past_year' | 'past_3_year'; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'past_year', label: 'Past year' },
  { value: 'past_3_year', label: 'Past 3 years' },
];

function computeRange(kind: typeof PERIODS[number]['value']): { from: Date; to: Date; label: string } {
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

export function EmployeeAttendanceDetail({ id }: { id: string }) {
  const [period, setPeriod] = useState<typeof PERIODS[number]['value']>('month');
  const range = computeRange(period);
  const { data: employee, isLoading: le } = useEmployee(id);
  const { data: departments } = useDepartments();
  const { data: holidays } = useHolidays();
  const { data: settings } = useAppSettings();
  const { data: records, isLoading: lr } = useAttendanceForEmployee(id, ymd(range.from), ymd(range.to));

  // Also fetch since joining for lifetime stat
  const { data: allRecords } = useAttendanceForEmployee(id, employee?.joining_date, ymd(new Date()));

  if (le || lr) return <Skeleton className="h-96 w-full" />;
  if (!employee) return <div className="text-sm text-muted-foreground">Employee not found.</div>;

  const dept = departments?.find(d => d.id === employee.department_id) ?? null;
  const holidayList = holidays ?? [];

  const summary = summarizeAttendance(records ?? [], employee, dept, holidayList, range.from, range.to);
  const today = new Date(); today.setHours(0,0,0,0);
  const join = parseYmd(employee.joining_date);
  const lifetime = summarizeAttendance(allRecords ?? [], employee, dept, holidayList, join, today);
  const leaves = computeLeavesBalance(employee, allRecords ?? [], today);

  const recByDate = new Map((records ?? []).map(r => [r.date, r.status] as const));

  const buildAttOpts = () => ({
    employee, department: dept, attendance: records ?? [], holidays: holidayList,
    from: range.from, to: range.to, periodLabel: PERIODS.find(p => p.value === period)?.label ?? '', settings, allAttendance: allRecords ?? [],
  });

  const doPdf = () => {
    try {
      exportEmployeeAttendancePdf(buildAttOpts());
    } catch (e) {
      toast.error(`PDF export failed: ${(e as Error).message}`);
    }
  };

  const doWa = async () => {
    const waNum = normalizeWaNumber(employee.mobile);
    if (!waNum) { toast.error('Employee has no mobile number'); return; }
    try {
      if (!await isWaConnected()) { toast.error('WhatsApp is not connected'); return; }
      const opts = buildAttOpts();
      const b64 = getAttendancePdfBase64(opts);
      const fname = `attendance-${fullName(employee).replace(/\s+/g, '_')}-${opts.periodLabel}.pdf`;
      const ok = await sendWaPdf(waNum, b64, fname, `Attendance report: ${opts.periodLabel}`);
      if (ok) toast.success('Attendance report sent via WhatsApp');
      else toast.error('Failed to send via WhatsApp');
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/attendance/history" className="text-sm text-muted-foreground hover:underline flex items-center"><ChevronLeft className="h-4 w-4" />Back</Link>
      </div>
      <div>
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">{fullName(employee)}</h1>
            <p className="text-sm text-muted-foreground">{dept?.name ?? 'No department'} · Joined {new Date(employee.joining_date).toLocaleDateString('en-IN')}</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={doPdf}>
              <Download className="mr-1 h-4 w-4" /> Export PDF
            </Button>
            <Button variant="outline" size="sm" onClick={doWa}>
              <MessageCircle className="mr-1 h-4 w-4 text-green-600" /> WhatsApp
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map(p => (
          <button key={p.value} onClick={() => setPeriod(p.value)} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', period === p.value ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}>{p.label}</button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground self-center">{range.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Stat label="Present" value={summary.present} color="text-emerald-700" />
        <Stat label="Half day" value={summary.halfDay} color="text-amber-700" />
        <Stat label="Absent" value={summary.absent} color="text-red-700" />
        <Stat label="Extra work" value={summary.extraWork} color="text-blue-700" />
        <Stat label="Unmarked" value={summary.unmarked} color="text-slate-600" />
        <Stat label="Working days" value={summary.workingDays} />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-semibold">Since joining</div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Total present" value={lifetime.present} color="text-emerald-700" />
          <Stat label="Total half day" value={lifetime.halfDay} color="text-amber-700" />
          <Stat label="Total absent" value={lifetime.absent} color="text-red-700" />
          <Stat label="Extra work days" value={lifetime.extraWork} color="text-blue-700" />
          <Stat label="Working days" value={lifetime.workingDays} />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-semibold">Paid leaves</div>
        <p className="mt-1 text-xs text-muted-foreground">Earns {employee.paid_holidays_per_month} / month, carries forward across months and years.</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat label="Earned" value={leaves.earned} color="text-emerald-700" />
          <Stat label="Used" value={leaves.used} color="text-amber-700" />
          <Stat label="Left" value={leaves.left} color={leaves.left >= 0 ? 'text-emerald-700' : 'text-red-700'} />
        </div>
      </div>

      {(period === 'day' || period === 'week' || period === 'month') && (
        <AttendanceCalendar anchor={range.from} status={recByDate} dept={dept} holidays={holidayList} joiningDate={employee.joining_date} />
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-2xl font-bold', color)}>{value}</div>
    </div>
  );
}

function AttendanceCalendar({ anchor, status, dept, holidays, joiningDate }: {
  anchor: Date;
  status: Map<string, string>;
  dept: ReturnType<typeof useDepartments>['data'] extends (infer T)[] | undefined ? T | null : never;
  holidays: Awaited<ReturnType<typeof useHolidays>>['data'] extends (infer T)[] | undefined ? T[] : never;
  joiningDate: string;
}) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startPad = (first.getDay() + 6) % 7; // Mon start
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(y, m, d));
  const join = parseYmd(joiningDate);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <LegendDot color="bg-emerald-500" label="Present" />
          <LegendDot color="bg-amber-500" label="Half day" />
          <LegendDot color="bg-red-500" label="Absent" />
          <LegendDot color="bg-blue-500" label="Extra work" />
          <LegendDot color="bg-purple-400" label="½ Extra work" />
          <LegendDot color="bg-slate-200" label="Non-working" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="p-1 text-muted-foreground">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = ymd(d);
          const working = isWorkingDay(d, dept, holidays);
          const beforeJoin = d < join;
          const s = status.get(key);
          let bg = 'bg-slate-100';
          let textCls = 'text-foreground';
          if (beforeJoin)                   { bg = 'bg-transparent'; textCls = 'text-muted-foreground/40'; }
          else if (s === 'extra_work')      { bg = 'bg-blue-500';    textCls = 'text-white'; }
          else if (s === 'half_extra_work') { bg = 'bg-purple-400';  textCls = 'text-white'; }
          else if (!working)                  bg = 'bg-slate-200';
          else if (s === 'present')         { bg = 'bg-emerald-500'; textCls = 'text-white'; }
          else if (s === 'half_day')        { bg = 'bg-amber-500';   textCls = 'text-white'; }
          else if (s === 'absent')          { bg = 'bg-red-500';     textCls = 'text-white'; }
          return (
            <div key={i} className={cn('aspect-square rounded-md p-1 text-xs font-medium flex items-start', bg, textCls)}>
              {d.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className={cn('h-2.5 w-2.5 rounded-sm', color)} />{label}</span>;
}
