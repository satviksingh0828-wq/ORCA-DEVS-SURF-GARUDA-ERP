import assert from "node:assert/strict";
import test from "node:test";
import { computePayroll } from "../src/lib/payroll-utils.ts";
import type { Attendance, Employee, Payroll } from "../src/lib/types.ts";

const employee = {
  id: "employee-1",
  joining_date: "2026-01-01",
  date_of_leaving: null,
  paid_holidays_per_month: 2,
  basic_salary: 30000,
  hra: 0,
  travel_allowance: 0,
  special_allowance: 0,
  other_allowance: 0,
} as Employee;

const september = (attendance: Attendance[], lastPayroll?: Payroll) =>
  computePayroll(
    employee,
    null,
    [],
    attendance,
    new Date(2026, 8, 1),
    new Date(2026, 8, 30),
    "month",
    lastPayroll,
  );

test("adds the employee's configured paid leave allotment to the carried balance each month", () => {
  const lastPayroll = {
    period_end: "2026-08-31",
    paid_leaves_left: 5,
    paid_leaves_used: 0,
  } as Payroll;

  const result = september([], lastPayroll);

  assert.equal(result.paidLeavesLeftBefore, 7);
  assert.equal(result.paidLeavesLeftAfter, 7);
});

test("uses only available paid leave and classifies the excess as unpaid", () => {
  const lastPayroll = {
    period_end: "2026-08-31",
    paid_leaves_left: 1,
    paid_leaves_used: 0,
  } as Payroll;
  const attendance = [
    { employee_id: employee.id, date: "2026-09-01", status: "absent" },
    { employee_id: employee.id, date: "2026-09-02", status: "absent" },
    { employee_id: employee.id, date: "2026-09-03", status: "absent" },
    { employee_id: employee.id, date: "2026-09-04", status: "absent" },
  ] as Attendance[];

  const result = september(attendance, lastPayroll);

  assert.equal(result.paidLeavesLeftBefore, 3);
  assert.equal(result.paidLeavesUsedThisPeriod, 3);
  assert.equal(result.unpaidLeavesThisPeriod, 1);
  assert.equal(result.paidLeavesLeftAfter, 0);
});

test("never carries forward a negative paid-leave balance from historical payroll data", () => {
  const lastPayroll = {
    period_end: "2026-08-31",
    paid_leaves_left: -2,
    paid_leaves_used: 0,
  } as Payroll;

  const result = september([], lastPayroll);

  assert.equal(result.paidLeavesLeftBefore, 2);
  assert.equal(result.paidLeavesLeftAfter, 2);
});

test("accrues the configured leave allotment in the employee's final payroll month", () => {
  const lastPayroll = {
    period_end: "2026-08-31",
    paid_leaves_left: 5,
    paid_leaves_used: 0,
  } as Payroll;
  const result = computePayroll(
    { ...employee, date_of_leaving: "2026-09-30" },
    null,
    [],
    [],
    new Date(2026, 8, 1),
    new Date(2026, 8, 30),
    "month",
    lastPayroll,
    true,
    [],
    750,
  );

  assert.equal(result.paidLeavesLeftAfter, 7);
  assert.equal(result.paidLeaveFinalSettlement, 5250);
});

test("includes the final-month allotment when no earlier payroll exists", () => {
  const result = computePayroll(
    { ...employee, joining_date: "2026-09-01", date_of_leaving: "2026-09-30" },
    null,
    [],
    [],
    new Date(2026, 8, 1),
    new Date(2026, 8, 30),
    "month",
    undefined,
    true,
    [],
    750,
  );

  assert.equal(result.paidLeavesLeftAfter, 2);
  assert.equal(result.paidLeaveFinalSettlement, 1500);
});
