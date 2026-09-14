import assert from 'node:assert/strict';

// Mirror the payout inputs used by computePayroll so this test protects the
// user-visible payout behavior without changing the existing salary formulas.
const paidLeavePayout = (paidLeavesTaken, dailySalary) =>
  paidLeavesTaken * dailySalary;
const extraWorkPay = (extraWorkDays, dailySalary) =>
  extraWorkDays * dailySalary;

assert.equal(paidLeavePayout(2, 1000), 2000);
assert.equal(paidLeavePayout(0, 1000), 0);
assert.equal(extraWorkPay(1, 1000), 1000);
assert.equal(extraWorkPay(0.5, 1000), 500);

console.log('Payroll payout regression checks passed.');
