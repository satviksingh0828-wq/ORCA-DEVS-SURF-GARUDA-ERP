import type { Attendance, Department, Employee, Holiday, InterestMethod, Payroll, PaidLeaveAccrual } from './types.ts';
import { countWorkingDays, isWorkingDay, parseYmd, ymd } from './attendance-utils.ts';

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
  /** Separate payout for paid leave taken in this payroll period. */
  paidLeavePayout: number;
  /** Payout of all remaining paid leave balance in the employee's final payroll. */
  paidLeaveFinalSettlement: number;
  payableDates: number;
  calendarDaysInMonth: number;
  paidLeaveFinalSettlementAllocations: Array<{ accrualId: string; accrualMonth: string; units: number; dailyRate: number; amount: number }>;
  paidLeaveUsedAllocations: Array<{ accrualId: string; units: number; amount: number }>;
}

export function allocatePaidLeaveByAccrual(
  accruals: Array<Pick<PaidLeaveAccrual, 'id' | 'accrual_month' | 'earned_units' | 'used_units' | 'daily_pay_rate'>>,
  leaveUsedThisPeriod: number,
  finalSettlement: boolean,
  finalSettlementRate?: number,
) {
  let remainingUsage = Math.max(0, leaveUsedThisPeriod);
  const rows = accruals.slice().sort((a, b) => a.accrual_month.localeCompare(b.accrual_month));
  const usedAllocations: Array<{ accrualId: string; units: number; amount: number }> = [];
  for (const row of rows) {
    const available = Math.max(0, Number(row.earned_units) - Number(row.used_units));
    const units = Math.min(available, remainingUsage);
    if (units > 0) {
      usedAllocations.push({ accrualId: row.id, units, amount: units * Number(row.daily_pay_rate) });
      remainingUsage -= units;
    }
  }
  const settlementAllocations = finalSettlement
    ? rows.map(row => {
        const alreadyUsed = usedAllocations.find(a => a.accrualId === row.id)?.units ?? 0;
        const units = Math.max(0, Number(row.earned_units) - Number(row.used_units) - alreadyUsed);
        const dailyRate = finalSettlementRate ?? Number(row.daily_pay_rate);
        return { accrualId: row.id, accrualMonth: row.accrual_month, units, dailyRate, amount: units * dailyRate };
      }).filter(row => row.units > 0)
    : [];
  return {
    usedAllocations,
    settlementAllocations,
    settlementAmount: settlementAllocations.reduce((sum, row) => sum + row.amount, 0),
    remainingUnits: settlementAllocations.reduce((sum, row) => sum + row.units, 0),
  };
}

/**
 * Compute a payroll period.
 *
 * Leave logic:
 * - Unpaid leaves are strictly per-period (reset to 0 after each period — no carry-forward).
 * - If `emp.unpaid_leave_deduction_rate > 0`, deduction = rate × unpaidLeaves (0.5 rate for half-days
 *   is already handled because unpaidLeavesThisPeriod uses 0.5 for half-days).
 * - Otherwise falls back to pro-rata (gross / workingDays × unpaidLeaves).
 * - `paidLeavePayout` = paid leaves used this period × calendar-day salary rate.
 * - `paidLeaveFinalSettlement` = remaining paid-leave balance × calendar-day salary rate,
 *   only when this is the employee's leaving period and a final-settlement
 *   rate has been supplied by the payroll user.
 * - `extraWorkPay` = extra work days × calendar-day salary rate.
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
  paidLeaveAccruals: PaidLeaveAccrual[] = [],
  finalSettlementRate?: number,
): PayrollComputation {
  const fullPeriodWorkingDays = countWorkingDays(from, to, dept, holidays);
  const { from: cf, to: ct } = clampToEmployment(from, to, emp);
  const workingDays = countWorkingDays(cf, ct, dept, holidays);
  const calendarDaysInMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  const eligiblePeriodDays = cf <= ct ? Math.floor((ct.getTime() - cf.getTime()) / 86400000) + 1 : 0;
  const joinLeaveFactor = calendarDaysInMonth > 0 ? eligiblePeriodDays / calendarDaysInMonth : 0;
  const empAtt = allAttendance.filter(a => a.employee_id === emp.id);
  const byDate = new Map(empAtt.map(a => [a.date, a] as const));
  const payable = new Set<string>();
  let present = 0, halfDay = 0, absent = 0, extraWorkDays = 0;
  const cur = new Date(cf);
  while (cur <= ct) {
    const key = ymd(cur);
    const r = byDate.get(key);
    // Working days and configured weekly offs cover every eligible calendar date.
    // Holidays, paid leave, and extra work are overlays; Set semantics count a date once.
    payable.add(key);
    if (isWorkingDay(cur, dept, holidays)) {
      if (r?.status === 'present') present++;
      else if (r?.status === 'half_day') halfDay++;
      else if (r?.status === 'absent') absent++;
    } else if (r?.status === 'extra_work') {
      extraWorkDays++;
    } else if (r?.status === 'half_extra_work') {
      extraWorkDays += 0.5;
    }
    cur.setDate(cur.getDate() + 1);
  }
  const marked = present + halfDay + absent;
  const unmarked = Math.max(0, workingDays - marked);

  const perMonth = emp.paid_holidays_per_month ?? 0;
  const join = parseYmd(emp.joining_date);
  let leftBefore: number;
  let paidLeavesEarned: number;
  let usedBefore: number;
  if (lastPayroll) {
    const lastEnd = parseYmd(lastPayroll.period_end);
    const monthsSince = Math.max(0, (ct.getFullYear() - lastEnd.getFullYear()) * 12 + (ct.getMonth() - lastEnd.getMonth()));
    // A leaving month pays out the balance accumulated through the previous
    // payroll; it does not earn another monthly paid-leave unit.
    const accruedMonthsSinceLastPayroll = Math.max(0, monthsSince - (isFinalPayroll ? 1 : 0));
    leftBefore = Number(lastPayroll.paid_leaves_left) + accruedMonthsSinceLastPayroll * perMonth;
    const monthsFromJoin = (cf.getFullYear() - join.getFullYear()) * 12 + (cf.getMonth() - join.getMonth()) + (cf.getDate() >= join.getDate() ? 1 : 0) - (isFinalPayroll ? 1 : 0);
    paidLeavesEarned = Math.max(0, monthsFromJoin) * perMonth;
    // The saved field is period-only, not cumulative. Derive cumulative
    // historical usage from the earned balance so stale accrual rows do not
    // make already-used leave look available for final settlement.
    usedBefore = Math.max(0, paidLeavesEarned - leftBefore);
  } else {
    const monthsFromJoin = (ct.getFullYear() - join.getFullYear()) * 12 + (ct.getMonth() - join.getMonth()) + (ct.getDate() >= join.getDate() ? 1 : 0) - (isFinalPayroll ? 1 : 0);
    paidLeavesEarned = Math.max(0, monthsFromJoin) * perMonth;
    const absentsBefore = empAtt.filter(a => a.status === 'absent' && parseYmd(a.date) < cf).length;
    const halfBefore = empAtt.filter(a => a.status === 'half_day' && parseYmd(a.date) < cf).length;
    usedBefore = absentsBefore + halfBefore * 0.5;
    leftBefore = paidLeavesEarned - usedBefore;
  }
  const requestedThisPeriod = absent + halfDay * 0.5;
  const paidLeavesUsedThisPeriod = Math.max(0, Math.min(requestedThisPeriod, leftBefore));
  const unpaidLeavesThisPeriod = Math.max(0, requestedThisPeriod - paidLeavesUsedThisPeriod);
  const paidLeavesLeftAfter = leftBefore - paidLeavesUsedThisPeriod;

  const n = (v: number | string) => Number(v) || 0;
  const monthlyGross = n(emp.basic_salary) + n(emp.hra) + n(emp.travel_allowance) + n(emp.special_allowance) + n(emp.other_allowance);
  const perDay = calendarDaysInMonth > 0 ? monthlyGross / calendarDaysInMonth : 0;
  const gross = perDay * payable.size;
  const unpaidLeaveDeduction = perDay * unpaidLeavesThisPeriod;
  // Paid leave payout is a separate earning: paid leave taken this period
  // multiplied by the employee's calculated calendar-day salary rate.
  const paidLeavePayout = paidLeavesUsedThisPeriod * perDay;
  const currentMonth = ymd(new Date(from.getFullYear(), from.getMonth(), 1));
  const currentAccrual = { id: '__current__', accrual_month: currentMonth, earned_units: isFinalPayroll ? 0 : perMonth, used_units: 0, daily_pay_rate: perDay };
  // Accrual rows can be created by an earlier half-month payroll or by a
  // partially migrated database. Keep the settlement ledger chronological and
  // ensure the selected month has its configured monthly entitlement. The
  // current month is the only accrual that may be synthesized here; future
  // rows must never be paid in an earlier final settlement.
  const historicalAccruals = paidLeaveAccruals
    .filter(row => isFinalPayroll
      ? row.accrual_month.slice(0, 7) < currentMonth.slice(0, 7)
      : row.accrual_month.slice(0, 7) <= currentMonth.slice(0, 7))
    .map(row => row.accrual_month.slice(0, 7) === currentMonth.slice(0, 7)
      ? { ...row, earned_units: Math.max(Number(row.earned_units) || 0, perMonth), daily_pay_rate: Number(row.daily_pay_rate) || perDay }
      : row);
  let missingHistoricalUsage = Math.max(
    0,
    usedBefore - historicalAccruals.reduce((sum, row) => sum + Number(row.used_units || 0), 0),
  );
  const reconciledAccruals = historicalAccruals.map((row) => {
    if (missingHistoricalUsage <= 0) return row;
    const available = Math.max(0, Number(row.earned_units) - Number(row.used_units || 0));
    const consume = Math.min(available, missingHistoricalUsage);
    missingHistoricalUsage -= consume;
    return consume > 0 ? { ...row, used_units: Number(row.used_units || 0) + consume } : row;
  });
  const hasCurrentAccrual = reconciledAccruals.some(row => row.accrual_month.slice(0, 7) === currentMonth.slice(0, 7));
  const accrualRows = hasCurrentAccrual ? reconciledAccruals : [...reconciledAccruals, currentAccrual];
  const manualFinalSettlementRate = Number(finalSettlementRate);
  const hasFinalSettlementRate = Number.isFinite(manualFinalSettlementRate) && manualFinalSettlementRate >= 0;
  const shouldSettlePaidLeave = isFinalPayroll && hasFinalSettlementRate;
  const allocation = accrualRows.length > 0
    ? allocatePaidLeaveByAccrual(accrualRows, paidLeavesUsedThisPeriod, shouldSettlePaidLeave, manualFinalSettlementRate)
    : { settlementAllocations: [], settlementAmount: 0 };
  if (shouldSettlePaidLeave) {
    const allocatedUnits = allocation.settlementAllocations.reduce((sum, row) => sum + row.units, 0);
    const untrackedUnits = Math.max(0, paidLeavesLeftAfter - allocatedUnits);
    if (untrackedUnits > 0) {
      allocation.settlementAllocations.push({
        accrualId: '__untracked__',
        accrualMonth: 'Balance carried forward',
        units: untrackedUnits,
        dailyRate: manualFinalSettlementRate,
        amount: untrackedUnits * manualFinalSettlementRate,
      });
      allocation.settlementAmount += untrackedUnits * manualFinalSettlementRate;
    }
  }
  const paidLeaveFinalSettlement = allocation.settlementAmount;
  const factor = payable.size > 0 ? Math.max(0, Math.min(1, (payable.size - unpaidLeavesThisPeriod) / payable.size)) : 0;
  const presentCounted = present + halfDay * 0.5;
  // Extra work is also paid separately at the calculated daily salary rate;
  // do not use the employee's fixed extra-work amount field here.
  const extraWorkPay = extraWorkDays * perDay;

  return {
    workingDays, fullPeriodWorkingDays, joinLeaveFactor,
    present: presentCounted, halfDay, absent, unmarked,
    extraWorkDays, extraWorkPay,
    paidLeavesEarned, paidLeavesUsedBefore: usedBefore, paidLeavesLeftBefore: leftBefore,
    paidLeavesUsedThisPeriod, unpaidLeavesThisPeriod, paidLeavesLeftAfter,
    factor, gross, perDay, unpaidLeaveDeduction, paidLeavePayout, paidLeaveFinalSettlement,
    paidLeaveFinalSettlementAllocations: allocation.settlementAllocations,
    paidLeaveUsedAllocations: allocation.usedAllocations,
    payableDates: payable.size, calendarDaysInMonth,
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
