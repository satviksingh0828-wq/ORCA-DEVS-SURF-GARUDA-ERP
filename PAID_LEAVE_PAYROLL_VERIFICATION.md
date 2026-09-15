# Paid Leave Payroll Verification

## Valuation rule

Every paid-leave accrual is stored by **employee and accrual month**. Each row contains earned units, used units, and the calendar-day salary rate for that month. Final settlement uses FIFO allocation from the oldest available accrual month:

```text
Final settlement = Σ (unused units from each accrual month × that month's saved daily pay rate)
```

The employee's final-month rate is used only for leave earned in the final month. It is not used to revalue older leave.

Regular period payroll earnings are:

```text
Gross salary for payable dates
+ extra-work payout
+ regular paid-leave payout
+ final paid-leave settlement, if leaving month
+ incentive
− PF − tax − unpaid-leave deduction − loan EMI − advance EMI − loss deduction
```

Regular paid-leave payout is calculated as paid leave used in the current period multiplied by the current payroll month's daily rate. The final settlement is calculated from the accrual ledger and can therefore contain multiple rates.

## Verification cases

The examples below use a monthly gross salary and calendar-day rate only to make the arithmetic easy to verify. Actual payroll also applies attendance, employment dates, PF, tax, loans, advances, loss deductions, extra work, and incentives.

| Case | Inputs | Expected leave result | Expected final-settlement result |
|---|---|---|---|
| 1. Normal month, no leave | Monthly gross ₹30,000; 30-day month; daily rate ₹1,000; 1 paid leave available; no leaving date | Paid leave used: 0; balance remains 1 | ₹0.00; no final settlement field is shown |
| 2. Normal month, paid leave used | Daily rate ₹1,000; 3 paid leaves available; 2 paid leaves used; no leaving date | Regular paid leave payout = 2 × ₹1,000 = ₹2,000; balance remains 1 | ₹0.00 |
| 3. Final month, all leave from one old month | January accrual: 2 units at ₹800; February accrual: 1 unit at ₹900; no current leave used; employee leaves in February | Balance available for settlement: 3 units | 2 × ₹800 + 1 × ₹900 = **₹2,500** |
| 4. Final month, old leave partly used | January accrual: 3 units at ₹800; February accrual: 2 units at ₹1,200; 2 paid leaves are used in February | FIFO uses 2 January units; remaining: 1 January unit and 2 February units | 1 × ₹800 + 2 × ₹1,200 = **₹3,200** |
| 5. Final month, current month rate differs | January: 2 units at ₹800; February: 1 unit at ₹1,000; March final month: 2 units at ₹1,500; no leave used in March | All 5 units remain | 2 × ₹800 + 1 × ₹1,000 + 2 × ₹1,500 = **₹7,100**, not 5 × ₹1,500 |
| 6. Final month, leave usage exceeds paid balance | Old balance: 1 unit at ₹800; final month has 3 absent days; only 1 is paid leave and 2 are unpaid | Regular paid-leave payout = 1 × current-month rate; 2 unpaid days are deducted | Final settlement is ₹0 because no paid balance remains |
| 7. Final month with half-day usage | February balance: 2 units at ₹900; final month uses one half-day paid leave | Remaining balance: 1.5 units | 1.5 × ₹900 = **₹1,350** |
| 8. Joining month | Employee joins on the 15th; accrual policy gives 1 unit for the month; daily rate is ₹1,000 | Only eligible employment-period attendance is considered | Settlement is based on the actual ledger balance, not a full pre-joining month |
| 9. Payroll generated twice for the same period | Same employee, same period start/end | Second generation is blocked as duplicate | No duplicate accrual or settlement allocation is created |
| 10. Old payroll before ledger migration | Existing payroll has aggregate `paid_leaves_left` but no month-level accrual rows | Existing aggregate remains available for display | Exact historic rate cannot be reconstructed if it was never saved; create an opening accrual using an approved rate before final settlement |

## What to inspect in Supabase

For each employee, verify `paid_leave_accruals`:

| Column | Meaning |
|---|---|
| `accrual_month` | Month in which the leave was earned |
| `earned_units` | Leave credited for that month |
| `used_units` | Leave consumed from that month |
| `daily_pay_rate` | Daily rate locked for that month |
| `source_payroll_id` | Payroll that recorded the month's rate |

Then verify `paid_leave_usage_allocations`:

| `usage_type` | Meaning |
|---|---|
| `leave_used` | Paid leave consumed during a normal/final payroll period |
| `final_settlement` | Remaining leave paid out at employee exit |

The sum of `amount` rows with `usage_type = 'final_settlement'` for a payroll must equal `payrolls.paid_leave_final_settlement_amount`.

## Important migration note

The new ledger correctly preserves rates for payrolls generated after the migration. If older payrolls did not store a daily rate, the database cannot mathematically recover the historical rate after a salary change. Before processing a final settlement for an employee with pre-migration leave, create or approve opening accrual rows with the correct historic rates. Do not automatically value those old leaves at the final month's rate.
