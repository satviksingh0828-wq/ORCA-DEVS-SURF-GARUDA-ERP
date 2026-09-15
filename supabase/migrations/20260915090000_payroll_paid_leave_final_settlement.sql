-- Store the amount paid for all remaining paid leave when payroll is generated
-- for an employee's final (date_of_leaving) month.
ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS paid_leave_final_settlement_amount numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payrolls.paid_leave_final_settlement_amount IS
  'Final payroll payout for the employee''s remaining paid leave balance; zero for non-final payrolls.';
