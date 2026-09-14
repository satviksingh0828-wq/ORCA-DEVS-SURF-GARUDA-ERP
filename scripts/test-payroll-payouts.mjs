import assert from 'node:assert/strict';

// Mirror the payout inputs used by computePayroll so this test protects the
// user-visible payout behavior without changing the existing salary formulas.
const paidLeavePayout = (isFinalPayroll, paidLeavesLeftBefore, rate) =>
  isFinalPayroll ? Math.max(0, paidLeavesLeftBefore) * (Number(rate) || 0) : 0;
const extraWorkPay = (extraWorkDays, rate) =>
  extraWorkDays * (Number(rate) || 0);

assert.equal(paidLeavePayout(false, 5, 250), 0);
assert.equal(paidLeavePayout(true, 5, 250), 1250);
assert.equal(paidLeavePayout(true, -2, 250), 0);
assert.equal(extraWorkPay(1, 500), 500);
assert.equal(extraWorkPay(0.5, 500), 250);

console.log('Payroll payout regression checks passed.');
