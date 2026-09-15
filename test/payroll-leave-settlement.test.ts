import assert from "node:assert/strict";
import test from "node:test";
import { computePayroll } from "../src/lib/payroll-utils.ts";
import type { Employee, PaidLeaveAccrual, Payroll } from "../src/lib/types.ts";

const employee = {
  id: "employee-1",
  joining_date: "2026-01-01",
  date_of_leaving: "2026-08-31",
  paid_holidays_per_month: 1,
  basic_salary: 30000,
  hra: 0,
  travel_allowance: 0,
  special_allowance: 0,
  other_allowance: 0,
} as Employee;

const lastPayroll = {
  period_end: "2026-07-31",
  paid_leaves_left: 6,
} as Payroll;

function accrual(month: string, used_units = 0): PaidLeaveAccrual {
  return {
    id: `accrual-${month}`,
    employee_id: employee.id,
    accrual_month: `${month}-01`,
    earned_units: 1,
    used_units,
    daily_pay_rate: 1000,
    source_payroll_id: null,
    created_at: "",
    updated_at: "",
  };
}

test("reconciles a February leave used in payroll history before final settlement", () => {
  const accruals = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map((month) =>
    accrual(month),
  );
  const result = computePayroll(
    employee,
    null,
    [],
    [],
    new Date(2026, 7, 1),
    new Date(2026, 7, 31),
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
    ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
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
    employee,
    null,
    [],
    [],
    new Date(2026, 7, 1),
    new Date(2026, 7, 31),
    "month",
    lastPayroll,
    true,
    accruals,
    1000,
  );

  assert.ok(result.paidLeaveFinalSettlement > 0);
  const current = result.paidLeaveFinalSettlementAllocations.find((row) =>
    row.accrualMonth.startsWith("2026-08"),
  );
  assert.ok(current);
  assert.equal(current.units, 1);
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

test("adds only one monthly leave after an August balance of five", () => {
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
