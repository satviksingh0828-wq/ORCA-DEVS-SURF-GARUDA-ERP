import type { Attendance, Department, Employee, Holiday } from './types.ts';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isWorkingDay(date: Date, dept: Department | null | undefined, holidays: Holiday[]): boolean {
  const dayName = DAY_NAMES[date.getDay()];
  const days = dept?.working_days_of_week?.length ? dept.working_days_of_week : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  if (!days.includes(dayName)) return false;
  const key = ymd(date);
  // A holiday blocks this day UNLESS this department is listed in exempt_department_ids
  const blockedByHoliday = holidays.some(h => {
    if (h.date !== key) return false;
    if (dept && h.exempt_department_ids?.includes(dept.id)) return false; // dept is exempt → not blocked
    return true;
  });
  if (blockedByHoliday) return false;
  return true;
}

export function countWorkingDays(from: Date, to: Date, dept: Department | null | undefined, holidays: Holiday[], joiningDate?: string): number {
  let n = 0;
  const join = joiningDate ? parseYmd(joiningDate) : null;
  const cur = new Date(from);
  while (cur <= to) {
    if ((!join || cur >= join) && isWorkingDay(cur, dept, holidays)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export function periodRange(kind: PeriodKind, anchor: Date = new Date()): { from: Date; to: Date; label: string } {
  const a = new Date(anchor);
  a.setHours(0, 0, 0, 0);
  if (kind === 'day') return { from: a, to: a, label: a.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) };
  if (kind === 'week') {
    const day = a.getDay();
    const diffToMon = (day + 6) % 7;
    const from = new Date(a); from.setDate(a.getDate() - diffToMon);
    const to = new Date(from); to.setDate(from.getDate() + 6);
    return { from, to, label: `${from.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} - ${to.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` };
  }
  if (kind === 'month') {
    const from = new Date(a.getFullYear(), a.getMonth(), 1);
    const to = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { from, to, label: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  }
  const from = new Date(a.getFullYear(), 0, 1);
  const to = new Date(a.getFullYear(), 11, 31);
  return { from, to, label: String(a.getFullYear()) };
}

export function summarizeAttendance(
  records: Attendance[],
  employee: Pick<Employee, 'joining_date' | 'department_id'>,
  dept: Department | null | undefined,
  holidays: Holiday[],
  from: Date,
  to: Date,
): { present: number; absent: number; halfDay: number; workingDays: number; unmarked: number; extraWork: number } {
  const start = employee.joining_date && parseYmd(employee.joining_date) > from ? parseYmd(employee.joining_date) : from;
  const workingDays = countWorkingDays(start, to, dept, holidays);
  const byDate = new Map(records.map(r => [r.date, r] as const));
  let present = 0, absent = 0, halfDay = 0, extraWork = 0;
  const cur = new Date(start);
  while (cur <= to) {
    const r = byDate.get(ymd(cur));
    if (isWorkingDay(cur, dept, holidays)) {
      if (r?.status === 'present') present++;
      else if (r?.status === 'half_day') halfDay++;
      else if (r?.status === 'absent') absent++;
    } else {
      if (r?.status === 'extra_work') extraWork++;
      else if (r?.status === 'half_extra_work') extraWork += 0.5;
    }
    cur.setDate(cur.getDate() + 1);
  }
  const marked = present + absent + halfDay;
  return { present, absent, halfDay, workingDays, unmarked: Math.max(0, workingDays - marked), extraWork };
}

/**
 * Compute paid leaves earned since joining, up to end date, with carry-forward
 * (unused monthly leaves accumulate indefinitely across months and years).
 * "Used" leaves are absent working days within joining..end.
 */
export function computeLeavesBalance(
  employee: Pick<Employee, 'joining_date' | 'paid_holidays_per_month' | 'department_id'>,
  attendance: Attendance[],
  end: Date = new Date(),
  dept?: Department | null,
  holidays: Holiday[] = [],
): { earned: number; used: number; left: number } {
  const perMonth = employee.paid_holidays_per_month ?? 0;
  const join = parseYmd(employee.joining_date);
  const endD = new Date(end); endD.setHours(0,0,0,0);
  // Only absences on working days count against paid leave.
  // Half-day counts as 0.5 — matches payroll-utils.ts requestedThisPeriod calculation.
  const usedAbsences = attendance.reduce((sum, a) => {
    if (a.status !== 'absent' && a.status !== 'half_day') return sum;
    const d = parseYmd(a.date);
    if (!isWorkingDay(d, dept ?? null, holidays)) return sum;
    return sum + (a.status === 'half_day' ? 0.5 : 1);
  }, 0);
  if (endD < join || perMonth <= 0) {
    return { earned: 0, used: usedAbsences, left: -usedAbsences };
  }
  const months = (endD.getFullYear() - join.getFullYear()) * 12
    + (endD.getMonth() - join.getMonth())
    + (endD.getDate() >= join.getDate() ? 1 : 0);
  const earned = Math.max(0, months) * perMonth;
  return { earned, used: usedAbsences, left: earned - usedAbsences };
}
