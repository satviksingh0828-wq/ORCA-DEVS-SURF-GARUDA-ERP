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

test("does not carry prior-month leave into final settlement", () => {
  const accruals = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map((month) =>
    accrual(month),
  );
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
    accruals,
    1000,
  );

  assert.ok(result.paidLeaveFinalSettlement > 0);
  assert.deepEqual(
    result.paidLeaveFinalSettlementAllocations
      .filter((row) => row.accrualMonth.startsWith("2026-"))
      .map((row) => row.accrualMonth.slice(0, 7)),
    ["2026-08"],
  );
});

test("includes the current-month accrual in the final settlement", () => {
  const accruals = [
    ...["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map((month) =>
      accrual(month),
    ),
    { ...accrual("2026-08"), earned_units: 0 },
  ];
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
    accruals,
    1000,
  );

  assert.equal(result.paidLeavesLeftAfter, 2);
  assert.equal(result.paidLeaveFinalSettlement, 1500);
});

test("uses the payroll user's final-settlement rate instead of automatically using salary rate", () => {
  const result = computePayroll(
    employee, null, [], [], new Date(2026, 7, 1), new Date(2026, 7, 31), "month", lastPayroll, true,
    ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map(month => accrual(month)),
    750,
  );

  assert.equal(result.paidLeavesLeftAfter, 1);
  assert.equal(result.paidLeaveFinalSettlement, 750);
  assert.ok(result.paidLeaveFinalSettlementAllocations.every(row => row.dailyRate === 750));
});

test("does not calculate a final settlement until the user supplies a rate", () => {
  const result = computePayroll(
    employee, null, [], [], new Date(2026, 7, 1), new Date(2026, 7, 31), "month", lastPayroll, true,
    ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map(month => accrual(month)),
  );

  assert.equal(result.paidLeaveFinalSettlement, 0);
});

test("resets the paid-leave allowance to one in a new month", () => {
  const septemberLastPayroll = {
    period_end: "2026-08-31",
    paid_leaves_left: 5,
  } as Payroll;
  const result = computePayroll(
    { ...employee, date_of_leaving: null }, null, [], [],
    new Date(2026, 8, 1), new Date(2026, 8, 30), "month", septemberLastPayroll,
  );

  assert.equal(result.paidLeavesLeftBefore, 1);
  assert.equal(result.paidLeavesLeftAfter, 1);
});

test("gives one leave in every new month after prior leave is exhausted", () => {
  let previous: Payroll | null = null;
  const results = [];
  for (const [month, absences] of [[0, 1], [1, 3], [2, 0], [3, 0], [4, 0]]) {
    const attendance = Array.from({ length: absences }, (_, day) => ({
      employee_id: employee.id,
      date: `2026-${String(month + 1).padStart(2, "0")}-${String(day + (month === 1 ? 2 : 1)).padStart(2, "0")}`,
      status: "absent" as const,
    }));
    const result = computePayroll(
      { ...employee, date_of_leaving: null }, null, [], attendance,
      new Date(2026, month, 1), new Date(2026, month + 1, 0), "month", previous,
    );
    results.push([result.paidLeavesUsedThisPeriod, result.paidLeavesLeftAfter, result.unpaidLeavesThisPeriod]);
    previous = { period_end: `2026-${String(month + 1).padStart(2, "0")}-${String(new Date(2026, month + 1, 0).getDate()).padStart(2, "0")}`, paid_leaves_left: result.paidLeavesLeftAfter } as Payroll;
  }

  assert.deepEqual(results, [[1, 0, 0], [1, 0, 2], [0, 1, 0], [0, 1, 0], [0, 1, 0]]);
});

test("adds the allowed leave in September when September is the final payroll month", () => {
  const augustPayroll = { period_end: "2026-08-31", paid_leaves_left: 5 } as Payroll;
  const result = computePayroll(
    { ...employee, date_of_leaving: "2026-09-30" }, null, [], [],
    new Date(2026, 8, 1), new Date(2026, 8, 30), "month", augustPayroll, true, [], 750,
  );

  assert.equal(result.paidLeavesUsedThisPeriod, 0);
  assert.equal(result.paidLeavesLeftAfter, 1);
  assert.equal(result.paidLeaveFinalSettlement, 750);
});

test("uses the payroll user's final-settlement rate instead of automatically using salary rate", () => {
  const result = computePayroll(
    employee, null, [], [], new Date(2026, 7, 1), new Date(2026, 7, 31), "month", lastPayroll, true,
    ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map(month => accrual(month)),
    750,
  );

  assert.equal(result.paidLeavesLeftAfter, 7);
  assert.equal(result.paidLeaveFinalSettlement, 5250);
  assert.ok(result.paidLeaveFinalSettlementAllocations.every(row => row.dailyRate === 750));
});

test("does not calculate a final settlement until the user supplies a rate", () => {
  const result = computePayroll(
    employee, null, [], [], new Date(2026, 7, 1), new Date(2026, 7, 31), "month", lastPayroll, true,
    ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map(month => accrual(month)),
  );

  assert.equal(result.paidLeaveFinalSettlement, 0);
});

test("carries an August balance forward and adds one September leave", () => {
  const septemberLastPayroll = {
    period_end: "2026-08-31",
    paid_leaves_left: 5,
  } as Payroll;
  const result = computePayroll(
    { ...employee, date_of_leaving: null }, null, [], [],
    new Date(2026, 8, 1), new Date(2026, 8, 30), "month", septemberLastPayroll,
  );

  assert.equal(result.paidLeavesLeftBefore, 6);
  assert.equal(result.paidLeavesLeftAfter, 6);
});

test("carries unused paid leaves forward after prior leave is exhausted", () => {
  let previous: Payroll | null = null;
  const results = [];
  for (const [month, absences] of [[0, 1], [1, 3], [2, 0], [3, 0], [4, 0]]) {
    const attendance = Array.from({ length: absences }, (_, day) => ({
      employee_id: employee.id,
      date: `2026-${String(month + 1).padStart(2, "0")}-${String(day + (month === 1 ? 2 : 1)).padStart(2, "0")}`,
      status: "absent" as const,
    }));
    const result = computePayroll(
      { ...employee, date_of_leaving: null }, null, [], attendance,
      new Date(2026, month, 1), new Date(2026, month + 1, 0), "month", previous,
    );
    results.push([result.paidLeavesUsedThisPeriod, result.paidLeavesLeftAfter, result.unpaidLeavesThisPeriod]);
    previous = { period_end: `2026-${String(month + 1).padStart(2, "0")}-${String(new Date(2026, month + 1, 0).getDate()).padStart(2, "0")}`, paid_leaves_left: result.paidLeavesLeftAfter } as Payroll;
  }

  assert.deepEqual(results, [[1, 0, 0], [1, 0, 2], [0, 1, 0], [0, 2, 0], [0, 3, 0]]);
});

test("adds the allowed leave in September when September is the final payroll month", () => {
  const augustPayroll = { period_end: "2026-08-31", paid_leaves_left: 5 } as Payroll;
  const result = computePayroll(
    { ...employee, date_of_leaving: "2026-09-30" }, null, [], [],
    new Date(2026, 8, 1), new Date(2026, 8, 30), "month", augustPayroll, true, [], 750,
  );

  assert.equal(result.paidLeavesUsedThisPeriod, 0);
  assert.equal(result.paidLeavesLeftAfter, 6);
  assert.equal(result.paidLeaveFinalSettlement, 4500);
});
