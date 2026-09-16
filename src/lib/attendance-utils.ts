import type { Attendance, Department, Employee, Holiday } from "./types.ts";

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isWorkingDay(
  date: Date,
  dept: Department | null | undefined,
  holidays: Holiday[],
): boolean {
  const dayName = DAY_NAMES[date.getDay()];
  const days = dept?.working_days_of_week?.length
    ? dept.working_days_of_week
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  if (!days.includes(dayName)) return false;
  const key = ymd(date);
  // A holiday blocks this day UNLESS this department is listed in exempt_department_ids
  const blockedByHoliday = holidays.some((h) => {
    if (h.date !== key) return false;
    if (dept && h.exempt_department_ids?.includes(dept.id)) return false; // dept is exempt → not blocked
    return true;
  });
  if (blockedByHoliday) return false;
  return true;
}

export function countWorkingDays(
  from: Date,
  to: Date,
  dept: Department | null | undefined,
  holidays: Holiday[],
  joiningDate?: string,
): number {
  let n = 0;
  const join = joiningDate ? parseYmd(joiningDate) : null;
  const cur = new Date(from);
  while (cur <= to) {
    if ((!join || cur >= join) && isWorkingDay(cur, dept, holidays)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export type PeriodKind = "day" | "week" | "month" | "year";

export function periodRange(
  kind: PeriodKind,
  anchor: Date = new Date(),
): { from: Date; to: Date; label: string } {
  const a = new Date(anchor);
  a.setHours(0, 0, 0, 0);
  if (kind === "day")
    return {
      from: a,
      to: a,
      label: a.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    };
  if (kind === "week") {
    const day = a.getDay();
    const diffToMon = (day + 6) % 7;
    const from = new Date(a);
    from.setDate(a.getDate() - diffToMon);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return {
      from,
      to,
      label: `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} - ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`,
    };
  }
  if (kind === "month") {
    const from = new Date(a.getFullYear(), a.getMonth(), 1);
    const to = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return {
      from,
      to,
      label: from.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    };
  }
  const from = new Date(a.getFullYear(), 0, 1);
  const to = new Date(a.getFullYear(), 11, 31);
  return { from, to, label: String(a.getFullYear()) };
}

export function summarizeAttendance(
  records: Attendance[],
  employee: Pick<Employee, "joining_date" | "department_id">,
  dept: Department | null | undefined,
  holidays: Holiday[],
  from: Date,
  to: Date,
): {
  present: number;
  absent: number;
  halfDay: number;
  workingDays: number;
  unmarked: number;
  extraWork: number;
} {
  const start =
    employee.joining_date && parseYmd(employee.joining_date) > from
      ? parseYmd(employee.joining_date)
      : from;
  const workingDays = countWorkingDays(start, to, dept, holidays);
  const byDate = new Map(records.map((r) => [r.date, r] as const));
  let present = 0,
    absent = 0,
    halfDay = 0,
    extraWork = 0;
  const cur = new Date(start);
  while (cur <= to) {
    const r = byDate.get(ymd(cur));
    if (isWorkingDay(cur, dept, holidays)) {
      if (r?.status === "present") present++;
      else if (r?.status === "half_day") halfDay++;
      else if (r?.status === "absent") absent++;
    } else {
      if (r?.status === "extra_work") extraWork++;
      else if (r?.status === "half_extra_work") extraWork += 0.5;
    }
    cur.setDate(cur.getDate() + 1);
  }
  const marked = present + absent + halfDay;
  return {
    present,
    absent,
    halfDay,
    workingDays,
    unmarked: Math.max(0, workingDays - marked),
    extraWork,
  };
}

/**
 * Compute paid leaves earned since joining, up to end date, with carry-forward
 * (unused monthly leaves accumulate indefinitely across months and years).
 * "Used" leaves are absent working days within joining..end.
 */
export function computeLeavesBalance(
  employee: Pick<Employee, "joining_date" | "paid_holidays_per_month" | "department_id">,
  attendance: Attendance[],
  end: Date = new Date(),
  dept?: Department | null,
  holidays: Holiday[] = [],
): { earned: number; used: number; left: number } {
  const perMonth = employee.paid_holidays_per_month ?? 0;
  const join = parseYmd(employee.joining_date);
  const endD = new Date(end);
  endD.setHours(0, 0, 0, 0);
  if (endD < join || perMonth <= 0) {
    return { earned: 0, used: 0, left: 0 };
  }

  // Process each month in payroll order. An absence consumes only the paid
  // balance available at that point; excess absence is unpaid and must not
  // reduce the balance earned in later months.
  const byMonth = new Map<string, number>();
  for (const record of attendance) {
    if (record.status !== "absent" && record.status !== "half_day") continue;
    const date = parseYmd(record.date);
    if (date < join || date > endD || !isWorkingDay(date, dept ?? null, holidays)) continue;
    const month = record.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + (record.status === "half_day" ? 0.5 : 1));
  }

  let earned = 0;
  let used = 0;
  let balance = 0;
  const cursor = new Date(join.getFullYear(), join.getMonth(), 1);
  const lastMonth = new Date(endD.getFullYear(), endD.getMonth(), 1);
  while (cursor <= lastMonth) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (monthEnd >= join && cursor <= endD) {
      const entitlement =
        cursor.getFullYear() === join.getFullYear() &&
        cursor.getMonth() === join.getMonth() &&
        join.getDate() > monthEnd.getDate()
          ? 0
          : perMonth;
      earned += entitlement;
      balance += entitlement;
      const paidUsed = Math.min(balance, byMonth.get(ymd(cursor).slice(0, 7)) ?? 0);
      used += paidUsed;
      balance -= paidUsed;
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { earned, used, left: balance };
}
