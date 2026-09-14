import type { Attendance, Department, Employee, Holiday, InterestMethod, Payroll } from './types';
import { countWorkingDays, isWorkingDay, parseYmd, ymd } from './attendance-utils';

export function computeEMI(
  principal: number,
  ratePct: number,
  method: InterestMethod,
  months: number,
): { emi: number; total: number } {
  const P = Number(principal) || 0;
  const n = Math.max(1, Math.floor(Number(months) || 1));
  const rate = (Number(ratePct) || 0) / 100;
  if (method === 'none' || rate === 0) return { emi: P / n, total: P };
  if (method === 'simple') {
    const interest = P * rate * (n / 12);
    const total = P + interest;
    return { emi: total / n, total };
  }
  const r = rate / 12;
  const emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return { emi, total: emi * n };
}

export function monthPeriod(year: number, month: number): { from: Date; to: Date } {
  return { from: new Date(year, month, 1), to: new Date(year, month + 1, 0) };
}

export function halfMonthPeriods(year: number, month: number): Array<{ from: Date; to: Date; label: string }> {
  const last = new Date(year, month + 1, 0).getDate();
  return [
    { from: new Date(year, month, 1), to: new Date(year, month, 15), label: '1st half' },
    { from: new Date(year, month, 16), to: new Date(year, month, last), label: '2nd half' },
  ];
}

export function clampToEmployment(
  from: Date,
  to: Date,
  emp: Pick<Employee, 'joining_date' | 'date_of_leaving'>,
): { from: Date; to: Date } {
  const join = parseYmd(emp.joining_date);
  const leave = emp.date_of_leaving ? parseYmd(emp.date_of_leaving) : null;
  const f = join > from ? join : from;
  const t = leave && leave < to ? leave : to;
  return { from: f, to: t };
}

export interface PayrollComputation {
  workingDays: number;
  fullPeriodWorkingDays: number;
  joinLeaveFactor: number;
  present: number;
  halfDay: number;
  absent: number;
  unmarked: number;
  extraWorkDays: number;
  extraWorkPay: number;
  paidLeavesEarned: number;
  paidLeavesUsedBefore: number;
  paidLeavesLeftBefore: number;
  paidLeavesUsedThisPeriod: number;
  unpaidLeavesThisPeriod: number;
  paidLeavesLeftAfter: number;
  factor: number;
  gross: number;
  perDay: number;
  /** Deduction for unpaid leaves this period (using custom rate if set, else pro-rata). */
  unpaidLeaveDeduction: number;
  /** Payout for unused paid leaves — non-zero only in final (leaving) payroll. */
  paidLeavePayout: number;
}

function countSundays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    if (cur.getDay() === 0) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Compute a payroll period.
 *
 * Leave logic:
 * - Unpaid leaves are strictly per-period (reset to 0 after each period — no carry-forward).
 * - Salary days are scheduled working days + Sundays + paid-leave entitlement.
 * - Joining/leaving periods use only the eligible days inside employment.
 * - Unpaid leave is always deducted automatically at the period's eligible-day rate.
 * - Paid leaves are already included in salary; no separate final-pay payout is made.
 *
 * EMI logic: handled externally via installment records — not in this function.
 */
export function computePayroll(
  emp: Employee,
  dept: Department | null | undefined,
  holidays: Holiday[],
  allAttendance: Attendance[],
  from: Date,
  to: Date,
  periodType: 'month' | 'half_month',
  lastPayroll?: Payroll | null,
  isFinalPayroll = false,
): PayrollComputation {
  const fullPeriodWorkingDays = countWorkingDays(from, to, dept, holidays);
  const { from: cf, to: ct } = clampToEmployment(from, to, emp);
  const workingDays = countWorkingDays(cf, ct, dept, holidays);
  const fullPeriodSundays = countSundays(from, to);
  const employedSundays = cf <= ct ? countSundays(cf, ct) : 0;
  const periodPaidLeaves = (emp.paid_holidays_per_month ?? 0) * (periodType === 'half_month' ? 0.5 : 1);
  const eligibleFullDays = fullPeriodWorkingDays + fullPeriodSundays + periodPaidLeaves;
  const eligibleEmployedDays = workingDays + employedSundays + periodPaidLeaves;
  const joinLeaveFactor = eligibleFullDays > 0 ? eligibleEmployedDays / eligibleFullDays : 1;

  const empAtt = allAttendance.filter(a => a.employee_id === emp.id);
  const byDate = new Map(empAtt.map(a => [a.date, a] as const));
  let present = 0, halfDay = 0, absent = 0, extraWorkDays = 0;
  const cur = new Date(cf);
  while (cur <= ct) {
    const r = byDate.get(ymd(cur));
    if (isWorkingDay(cur, dept, holidays)) {
      if (r?.status === 'present')   present++;
      else if (r?.status === 'half_day') halfDay++;
      else if (r?.status === 'absent')   absent++;
    } else {
      if (r?.status === 'extra_work') extraWorkDays++;
      else if (r?.status === 'half_extra_work') extraWorkDays += 0.5;
    }
    cur.setDate(cur.getDate() + 1);
  }
  const marked   = present + halfDay + absent;
  const unmarked = Math.max(0, workingDays - marked);

  // ── Paid-leave balance (carry-forward from last payroll snapshot) ──────────
  const perMonth = emp.paid_holidays_per_month ?? 0;
  const join     = parseYmd(emp.joining_date);
  let leftBefore: number;
  let paidLeavesEarned: number;
  let usedBefore: number;

  if (lastPayroll) {
    const lastEnd    = parseYmd(lastPayroll.period_end);
    const monthsSince = Math.max(
      0,
      (ct.getFullYear() - lastEnd.getFullYear()) * 12 + (ct.getMonth() - lastEnd.getMonth()),
    );
    leftBefore       = Number(lastPayroll.paid_leaves_left) + monthsSince * perMonth;
    paidLeavesEarned = leftBefore + Number(lastPayroll.paid_leaves_used);
    usedBefore       = Number(lastPayroll.paid_leaves_used);
  } else {
    const monthsFromJoin =
      (ct.getFullYear() - join.getFullYear()) * 12 +
      (ct.getMonth() - join.getMonth()) +
      (ct.getDate() >= join.getDate() ? 1 : 0);
    paidLeavesEarned  = Math.max(0, monthsFromJoin) * perMonth;
    const absentsBefore = empAtt.filter(a => a.status === 'absent'   && parseYmd(a.date) < cf).length;
    const halfBefore    = empAtt.filter(a => a.status === 'half_day' && parseYmd(a.date) < cf).length;
    usedBefore          = absentsBefore + halfBefore * 0.5;
    leftBefore          = paidLeavesEarned - usedBefore;
  }

  // ── This period's leave usage ──────────────────────────────────────────────
  const requestedThisPeriod      = absent + halfDay * 0.5;
  const paidLeavesUsedThisPeriod = Math.max(0, Math.min(requestedThisPeriod, leftBefore));
  const unpaidLeavesThisPeriod   = Math.max(0, requestedThisPeriod - paidLeavesUsedThisPeriod);
  const paidLeavesLeftAfter      = leftBefore - paidLeavesUsedThisPeriod;

  // ── Gross ──────────────────────────────────────────────────────────────────
  const n = (v: number | string) => Number(v) || 0;
  const monthlyGross = n(emp.basic_salary) + n(emp.hra) + n(emp.travel_allowance) + n(emp.special_allowance) + n(emp.other_allowance);
  const periodGross  = periodType === 'half_month' ? monthlyGross / 2 : monthlyGross;
  const gross        = periodGross * joinLeaveFactor;
  const perDay       = eligibleFullDays > 0 ? periodGross / eligibleFullDays : 0;

  // ── Unpaid leave deduction ─────────────────────────────────────────────────
  // Unpaid leave is always deducted automatically using the same daily rate as
  // the new working-days + Sundays + paid-leaves salary basis.
  const unpaidLeaveDeduction = perDay * unpaidLeavesThisPeriod;

  // ── Paid-leave payout (final payroll only) ─────────────────────────────────
  // Uses paidLeavesLeftAfter (not leftBefore) so leaves consumed THIS period are not double-paid:
  // those days were already paid as "present" via paid-leave cover, not deducted.
  const paidLeavePayout = 0;

  // Clamp factor to [0,1] — unpaidLeavesThisPeriod could theoretically exceed workingDays
  // if attendance data was entered incorrectly (e.g. absences on non-working days counted).
  const factor = workingDays > 0
    ? Math.max(0, Math.min(1, (workingDays - unpaidLeavesThisPeriod) / workingDays))
    : 0;
  const presentCounted = present + halfDay * 0.5;

  // ── Extra work pay ─────────────────────────────────────────────────────────
  const extraWorkPay = extraWorkDays * (n(emp.pay_per_extra_work_day));

  return {
    workingDays, fullPeriodWorkingDays, joinLeaveFactor,
    present: presentCounted, halfDay, absent, unmarked,
    extraWorkDays, extraWorkPay,
    paidLeavesEarned, paidLeavesUsedBefore: usedBefore, paidLeavesLeftBefore: leftBefore,
    paidLeavesUsedThisPeriod, unpaidLeavesThisPeriod, paidLeavesLeftAfter,
    factor, gross, perDay, unpaidLeaveDeduction, paidLeavePayout,
  };
}

export function loanRemaining(l: {
  total_payable: number;
  emi: number;
  paid_months: number;
  months: number;
  status: string;
}): number {
  if (l.status === 'paid') return 0;
  const paid = l.emi * l.paid_months;
  return Math.max(0, l.total_payable - paid);
}

/**
 * Compute true remaining balance from actual installment records.
 * Handles partial payments, skipped periods, and skip-generated tail installments correctly.
 *
 * pending                  → full amount outstanding
 * paid_partial_manual       → amount - paid_amount (payroll will deduct the rest)
 * skipped / partial_skipped → 0 on the original (obligation moved to a tail `pending` row)
 * payroll_partial_skipped   → 0 on the original (paid_amount via payroll; rest moved to tail pending)
 * paid_manual / paid_payroll → 0
 */
export function loanRemainingFromInstallments(
  insts: Array<{ status: string; amount: number; paid_amount?: number | null }>,
): number {
  return insts.reduce((sum, i) => {
    if (i.status === 'pending') return sum + Math.max(0, Number(i.amount));
    if (i.status === 'paid_partial_manual') {
      return sum + Math.max(0, Number(i.amount) - Number(i.paid_amount || 0));
    }
    return sum;
  }, 0);
}

/** Generate installment due dates for a loan. Returns array of { emi_number, due_year, due_month, due_date }. */
export function generateInstallmentSchedule(
  startDate: string,
  months: number,
  emiAmount: number,
): Array<{ emi_number: number; due_year: number; due_month: number; due_date: string; amount: number }> {
  const start = parseYmd(startDate);
  return Array.from({ length: months }, (_, i) => {
    const targetYear  = start.getFullYear();
    const targetMonth = start.getMonth() + i;
    // Clamp to the last day of the target month to avoid JS Date overflow
    // (e.g. Jan 31 + 1 month must be Feb 28, not Mar 3).
    const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const day = Math.min(start.getDate(), lastDayOfMonth);
    const d = new Date(targetYear, targetMonth, day);
    return {
      emi_number: i + 1,
      due_year:  d.getFullYear(),
      due_month: d.getMonth(),
      due_date:  ymd(d),
      amount:    emiAmount,
    };
  });
}
