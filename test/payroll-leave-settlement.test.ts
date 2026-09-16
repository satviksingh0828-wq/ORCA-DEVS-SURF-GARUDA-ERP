import assert from "node:assert/strict";
import test from "node:test";
import { computePayroll } from "../src/lib/payroll-utils.ts";
import { computeLeavesBalance } from "../src/lib/attendance-utils.ts";
import type { Attendance, Employee, Payroll } from "../src/lib/types.ts";

const employee = {
  id: "employee-1",
  joining_date: "2026-01-01",
  date_of_leaving: null,
  paid_holidays_per_month: 1,
  basic_salary: 30000,
  hra: 0,
  travel_allowance: 0,
  special_allowance: 0,
  other_allowance: 0,
} as Employee;

function payrollFor(
  month: number,
  attendance: Attendance[],
  previous?: Payroll | null,
  emp: Employee = employee,
) {
  return computePayroll(
    emp,
    null,
    [],
    attendance,
    new Date(2026, month, 1),
    new Date(2026, month + 1, 0),
    "month",
    previous,
  );
}

function snapshot(month: number, paidLeavesLeft: number): Payroll {
  return {
    period_end: `2026-${String(month + 1).padStart(2, "0")}-${String(new Date(2026, month + 1, 0).getDate()).padStart(2, "0")}`,
    paid_leaves_left: paidLeavesLeft,
  } as Payroll;
}

test("uses one paid leave and two unpaid leaves when balance is one", () => {
  const attendance = [2, 3, 4].map((day) => ({
    employee_id: employee.id,
    date: `2026-02-${String(day).padStart(2, "0")}`,
    status: "absent" as const,
  }));
  const result = payrollFor(1, attendance, snapshot(0, 0));

  assert.equal(result.paidLeavesUsedThisPeriod, 1);
  assert.equal(result.unpaidLeavesThisPeriod, 2);
  assert.equal(result.paidLeavesLeftAfter, 0);
});

test("adds the next month's entitlement after the prior balance is exhausted", () => {
  const previous = snapshot(1, 0);
  const result = payrollFor(2, [], previous);

  assert.equal(result.paidLeavesUsedThisPeriod, 0);
  assert.equal(result.unpaidLeavesThisPeriod, 0);
  assert.equal(result.paidLeavesLeftBefore, 1);
  assert.equal(result.paidLeavesLeftAfter, 1);
});

test("continues carrying the new balance through later months", () => {
  const march = payrollFor(2, [], snapshot(1, 0));
  const april = payrollFor(3, [], snapshot(2, march.paidLeavesLeftAfter));

  assert.equal(march.paidLeavesLeftAfter, 1);
  assert.equal(april.paidLeavesLeftAfter, 2);
});

test("attendance balance counts only paid leave as used, not unpaid excess", () => {
  const attendance = [
    { employee_id: employee.id, date: "2026-01-05", status: "absent" as const },
    { employee_id: employee.id, date: "2026-02-02", status: "absent" as const },
    { employee_id: employee.id, date: "2026-02-03", status: "absent" as const },
    { employee_id: employee.id, date: "2026-02-04", status: "absent" as const },
  ];
  const result = computeLeavesBalance(employee, attendance, new Date(2026, 1, 28));

  assert.equal(result.earned, 2);
  assert.equal(result.used, 2);
  assert.equal(result.left, 0);
});

test("uses all prior accrual months when settling final paid leave", () => {
  const accruals = [
    { id: "jan", accrual_month: "2026-01-01", earned_units: 1, used_units: 0, daily_pay_rate: 800 },
    { id: "feb", accrual_month: "2026-02-01", earned_units: 1, used_units: 0, daily_pay_rate: 900 },
  ];
  const result = computePayroll(
    { ...employee, date_of_leaving: "2026-03-31" },
    null,
    [],
    [],
    new Date(2026, 2, 1),
    new Date(2026, 2, 31),
    "month",
    snapshot(1, 2),
    true,
    accruals as never,
    1000,
  );

  assert.equal(result.paidLeaveFinalSettlement, 3000);
  assert.deepEqual(
    result.paidLeaveFinalSettlementAllocations.map((row) => row.accrualMonth.slice(0, 7)),
    ["2026-01", "2026-02", "2026-03"],
  );
});

test("does not calculate final settlement until a rate is supplied", () => {
  const result = computePayroll(
    { ...employee, date_of_leaving: "2026-03-31" },
    null,
    [],
    [],
    new Date(2026, 2, 1),
    new Date(2026, 2, 31),
    "month",
    snapshot(1, 2),
    true,
    [],
  );
  assert.equal(result.paidLeaveFinalSettlement, 0);
});
