-- ================================================================
-- GARUDA ERP: combined HRMS payroll, paid-leave ledger, and mapping
-- apply + verification script.
--
-- Run once in Supabase SQL Editor after the base tables exist:
--   public.branches
--   public.employees
--   public.departments
--   public.payrolls
--   public.ledger_accounts
--
-- This script is idempotent. It creates missing columns/tables and
-- installs validation for branch-specific HRMS ledger mappings.
-- ================================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. Employee accounting branch fallback
-- ---------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS accounting_branch_id uuid
  REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employees_accounting_branch_idx
  ON public.employees(accounting_branch_id);

CREATE OR REPLACE FUNCTION public.hrms_branch_for_employee(p_employee_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(e.accounting_branch_id, d.branch_id)
  FROM public.employees e
  LEFT JOIN public.departments d ON d.id = e.department_id
  WHERE e.id = p_employee_id
  LIMIT 1
$$;

-- ---------------------------------------------------------------
-- 2. HRMS account mappings, including Loss Deduction
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hrms_account_ledger_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  salary_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  salary_payable_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  employee_advance_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  employee_loan_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  incentive_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  incentive_payable_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  salary_deduction_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  loss_deduction_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  unpaid_leave_deduction_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  paid_leave_payout_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  extra_work_day_payout_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);

ALTER TABLE public.hrms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS salary_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS salary_payable_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_advance_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_loan_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS incentive_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS incentive_payable_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS salary_deduction_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loss_deduction_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unpaid_leave_deduction_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_leave_payout_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extra_work_day_payout_ledger_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.hrms_account_ledger_mappings(branch_id)
SELECT b.id FROM public.branches b
ON CONFLICT (branch_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.validate_hrms_account_ledger_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  field_name text;
  ledger_id uuid;
BEGIN
  -- Expense/income mappings, including Loss Deduction, must be active and
  -- belong to exactly the branch selected in the mapping.
  FOREACH field_name IN ARRAY ARRAY[
    'salary_ledger_id', 'incentive_ledger_id', 'salary_deduction_ledger_id',
    'loss_deduction_ledger_id', 'unpaid_leave_deduction_ledger_id',
    'paid_leave_payout_ledger_id', 'extra_work_day_payout_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_accounts l
      WHERE l.id = ledger_id
        AND l.branch_id = NEW.branch_id
        AND l.is_active = true
        AND l.ledger_type IN ('income', 'expenditure')
    ) THEN
      RAISE EXCEPTION '% must be an active income or expenditure ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  -- Salary Payable and Incentive Payable must be active liability ledgers
  -- from the same branch.
  FOREACH field_name IN ARRAY ARRAY[
    'salary_payable_ledger_id', 'incentive_payable_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_accounts l
      WHERE l.id = ledger_id
        AND l.branch_id = NEW.branch_id
        AND l.is_active = true
        AND l.ledger_type = 'liability'
    ) THEN
      RAISE EXCEPTION '% must be an active liability ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  -- Employee Advance and Employee Loan remain active asset ledgers.
  FOREACH field_name IN ARRAY ARRAY[
    'employee_advance_ledger_id', 'employee_loan_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_accounts l
      WHERE l.id = ledger_id
        AND l.branch_id = NEW.branch_id
        AND l.is_active = true
        AND l.ledger_type = 'asset'
    ) THEN
      RAISE EXCEPTION '% must be an active asset ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_hrms_account_ledger_mapping
  ON public.hrms_account_ledger_mappings;
CREATE TRIGGER validate_hrms_account_ledger_mapping
BEFORE INSERT OR UPDATE ON public.hrms_account_ledger_mappings
FOR EACH ROW EXECUTE FUNCTION public.validate_hrms_account_ledger_mapping();

-- Revalidate every existing mapping now. If this fails, inspect the invalid
-- mapping and correct it before rerunning this complete script.
UPDATE public.hrms_account_ledger_mappings SET updated_at = now();

ALTER TABLE public.hrms_account_ledger_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_account_ledger_mappings_app_access
  ON public.hrms_account_ledger_mappings;
CREATE POLICY hrms_account_ledger_mappings_app_access
ON public.hrms_account_ledger_mappings FOR ALL TO anon, authenticated
USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.hrms_account_ledger_mappings TO anon, authenticated;

-- ---------------------------------------------------------------
-- 3. Payroll final settlement and month-specific rate fields
-- ---------------------------------------------------------------
ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS paid_leave_final_settlement_amount
    numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_leave_daily_rate
    numeric(14,6) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------
-- 4. Paid-leave accrual and usage ledger
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paid_leave_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  accrual_month date NOT NULL,
  earned_units numeric(8,2) NOT NULL DEFAULT 0,
  used_units numeric(8,2) NOT NULL DEFAULT 0,
  daily_pay_rate numeric(14,6) NOT NULL DEFAULT 0,
  source_payroll_id uuid REFERENCES public.payrolls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, accrual_month)
);

CREATE TABLE IF NOT EXISTS public.paid_leave_usage_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  payroll_id uuid NOT NULL REFERENCES public.payrolls(id) ON DELETE CASCADE,
  accrual_id uuid NOT NULL REFERENCES public.paid_leave_accruals(id) ON DELETE CASCADE,
  usage_type text NOT NULL CHECK (usage_type IN ('leave_used', 'final_settlement')),
  units numeric(8,2) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_id, accrual_id, usage_type)
);

ALTER TABLE public.paid_leave_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paid_leave_usage_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paid_leave_accruals_app_access
  ON public.paid_leave_accruals;
CREATE POLICY paid_leave_accruals_app_access
ON public.paid_leave_accruals FOR ALL TO anon, authenticated
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS paid_leave_usage_app_access
  ON public.paid_leave_usage_allocations;
CREATE POLICY paid_leave_usage_app_access
ON public.paid_leave_usage_allocations FOR ALL TO anon, authenticated
USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.paid_leave_accruals, public.paid_leave_usage_allocations
TO anon, authenticated;

COMMIT;

-- ================================================================
-- VERIFICATION QUERIES
-- Run these after the apply section. They do not change data.
-- ================================================================

-- A. Required columns/tables exist.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'hrms_account_ledger_mappings' AND column_name IN (
      'loss_deduction_ledger_id', 'salary_payable_ledger_id'
    ))
    OR (table_name = 'payrolls' AND column_name IN (
      'paid_leave_final_settlement_amount', 'paid_leave_daily_rate'
    ))
  )
ORDER BY table_name, column_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('paid_leave_accruals', 'paid_leave_usage_allocations')
ORDER BY table_name;

-- B. Invalid existing income/expenditure mappings.
-- This should return zero rows.
SELECT m.branch_id, m.id AS mapping_id, x.field_name, x.ledger_id,
       l.branch_id AS ledger_branch_id, l.ledger_type, l.is_active
FROM public.hrms_account_ledger_mappings m
CROSS JOIN LATERAL (VALUES
  ('salary_ledger_id', m.salary_ledger_id),
  ('incentive_ledger_id', m.incentive_ledger_id),
  ('salary_deduction_ledger_id', m.salary_deduction_ledger_id),
  ('loss_deduction_ledger_id', m.loss_deduction_ledger_id),
  ('unpaid_leave_deduction_ledger_id', m.unpaid_leave_deduction_ledger_id),
  ('paid_leave_payout_ledger_id', m.paid_leave_payout_ledger_id),
  ('extra_work_day_payout_ledger_id', m.extra_work_day_payout_ledger_id)
) x(field_name, ledger_id)
LEFT JOIN public.ledger_accounts l ON l.id = x.ledger_id
WHERE x.ledger_id IS NOT NULL
  AND NOT (l.branch_id = m.branch_id AND l.is_active = true
           AND l.ledger_type IN ('income', 'expenditure'))
ORDER BY m.branch_id, x.field_name;

-- C. Invalid Salary Payable/Incentive Payable mappings.
-- This should return zero rows.
SELECT m.branch_id, m.id AS mapping_id, x.field_name, x.ledger_id,
       l.branch_id AS ledger_branch_id, l.ledger_type, l.is_active
FROM public.hrms_account_ledger_mappings m
CROSS JOIN LATERAL (VALUES
  ('salary_payable_ledger_id', m.salary_payable_ledger_id),
  ('incentive_payable_ledger_id', m.incentive_payable_ledger_id)
) x(field_name, ledger_id)
LEFT JOIN public.ledger_accounts l ON l.id = x.ledger_id
WHERE x.ledger_id IS NOT NULL
  AND NOT (l.branch_id = m.branch_id AND l.is_active = true
           AND l.ledger_type = 'liability')
ORDER BY m.branch_id, x.field_name;

-- D. Invalid employee accounting branches.
-- This should return zero rows.
SELECT e.id AS employee_id, e.first_name, e.last_name,
       e.accounting_branch_id, d.branch_id AS department_branch_id
FROM public.employees e
LEFT JOIN public.departments d ON d.id = e.department_id
WHERE e.accounting_branch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = e.accounting_branch_id
  );

-- E. Paid-leave balance by accrual month.
-- remaining_units is the FIFO balance available for use/settlement.
SELECT employee_id, accrual_month, earned_units, used_units,
       earned_units - used_units AS remaining_units,
       daily_pay_rate, source_payroll_id
FROM public.paid_leave_accruals
ORDER BY employee_id, accrual_month;

-- F. Final settlement stored amount must equal allocation amount.
-- This should return zero rows.
SELECT p.id AS payroll_id, p.employee_id, p.period_start, p.period_end,
       p.paid_leave_final_settlement_amount,
       COALESCE(SUM(u.amount), 0) AS allocated_final_settlement
FROM public.payrolls p
LEFT JOIN public.paid_leave_usage_allocations u
  ON u.payroll_id = p.id
 AND u.usage_type = 'final_settlement'
GROUP BY p.id, p.employee_id, p.period_start, p.period_end,
         p.paid_leave_final_settlement_amount
HAVING ABS(p.paid_leave_final_settlement_amount - COALESCE(SUM(u.amount), 0)) > 0.01
ORDER BY p.period_start;
