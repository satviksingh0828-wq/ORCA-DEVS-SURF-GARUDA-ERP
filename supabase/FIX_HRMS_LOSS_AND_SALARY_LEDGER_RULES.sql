-- GARUDA ERP HRMS ledger rule fix
-- Run in Supabase SQL Editor after the HRMS accounting tables exist.
-- Rules enforced:
--   * Loss Deduction: active income ledger from the employee branch.
--   * Salary Payable mapping: active liability ledger from the employee branch.
--   * Runtime Salary paid debit: active expenditure ledger from the employee branch.

BEGIN;

-- Ensure the HRMS mapping column exists.
ALTER TABLE public.hrms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS loss_deduction_ledger_id uuid
  REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

-- Validate HRMS account mappings used by the Settings > HRMS Accounts screen.
CREATE OR REPLACE FUNCTION public.validate_hrms_account_ledger_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  field_name text;
  ledger_id uuid;
BEGIN
  -- Loss Deduction is an income ledger specifically.
  ledger_id := NEW.loss_deduction_ledger_id;
  IF ledger_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts l
    WHERE l.id = ledger_id
      AND l.branch_id = NEW.branch_id
      AND l.is_active = true
      AND l.ledger_type = 'income'
  ) THEN
    RAISE EXCEPTION 'loss_deduction_ledger_id must be an active income ledger from employee branch %', NEW.branch_id;
  END IF;

  -- Other deduction/expense mappings may be income or expenditure.
  FOREACH field_name IN ARRAY ARRAY[
    'salary_ledger_id', 'incentive_ledger_id', 'salary_deduction_ledger_id',
    'unpaid_leave_deduction_ledger_id', 'paid_leave_payout_ledger_id',
    'extra_work_day_payout_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_accounts l
      WHERE l.id = ledger_id
        AND l.branch_id = NEW.branch_id
        AND l.is_active = true
        AND l.ledger_type IN ('income', 'expenditure')
    ) THEN
      RAISE EXCEPTION '% must be an active income or expenditure ledger from employee branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  -- Salary Payable and Incentive Payable are liabilities.
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
      RAISE EXCEPTION '% must be an active liability ledger from employee branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_hrms_account_ledger_mapping
  ON public.hrms_account_ledger_mappings;
CREATE TRIGGER validate_hrms_account_ledger_mapping
BEFORE INSERT OR UPDATE ON public.hrms_account_ledger_mappings
FOR EACH ROW EXECUTE FUNCTION public.validate_hrms_account_ledger_mapping();

-- Revalidate existing HRMS mappings now. If this fails, fix the reported
-- branch/type/inactive ledger and rerun this script.
UPDATE public.hrms_account_ledger_mappings SET updated_at = now();

-- Validate the runtime Auto Rule used when salary is marked paid.
DO $$
DECLARE
  bad_rule record;
BEGIN
  IF to_regclass('public.hrms_accounting_rules') IS NULL THEN
    RETURN;
  END IF;
  SELECT r.branch_id, r.rule_key, r.debit_ledger_id, l.account_name, l.ledger_type, l.is_active
  INTO bad_rule
  FROM public.hrms_accounting_rules r
  LEFT JOIN public.ledger_accounts l ON l.id = r.debit_ledger_id
  WHERE r.rule_key = 'payroll_paid'
    AND r.debit_ledger_id IS NOT NULL
    AND NOT (l.branch_id = r.branch_id AND l.is_active = true AND l.ledger_type = 'expenditure')
  LIMIT 1;
  IF bad_rule IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_paid rule must use an active expenditure ledger from its employee branch; branch %, ledger %, type %', bad_rule.branch_id, bad_rule.account_name, bad_rule.ledger_type;
  END IF;
END $$;

-- Replace the runtime queue function so future Salary paid events enforce the
-- same expenditure rule, employee-branch rule, and active bank/cash credit.
CREATE OR REPLACE FUNCTION public.hrms_queue_event(
  p_event_type text,
  p_source_id uuid,
  p_branch_id uuid,
  p_event_date date,
  p_amount numeric,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_enabled boolean;
  v_requires boolean;
  v_debit uuid;
  v_credit uuid;
BEGIN
  IF p_branch_id IS NULL OR COALESCE(p_amount, 0) <= 0 THEN RETURN NULL; END IF;

  SELECT enabled, requires_verification, debit_ledger_id, default_bank_cash_ledger_id
  INTO v_enabled, v_requires, v_debit, v_credit
  FROM public.hrms_accounting_rules
  WHERE branch_id = p_branch_id AND rule_key = p_event_type;

  IF NOT COALESCE(v_enabled, false) OR v_debit IS NULL OR v_credit IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_debit AND branch_id = p_branch_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'HRMS rule requires an active debit ledger from the employee branch';
  END IF;

  IF p_event_type = 'payroll_paid' AND NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_debit AND branch_id = p_branch_id
      AND is_active = true AND ledger_type = 'expenditure'
  ) THEN
    RAISE EXCEPTION 'Salary paid must debit an active expenditure ledger from the employee branch';
  END IF;

  IF p_event_type IN ('loan_given', 'advance_given') AND NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_debit AND branch_id = p_branch_id
      AND is_active = true AND ledger_type IN ('asset', 'capital')
  ) THEN
    RAISE EXCEPTION 'Loan and advance rules must debit an active asset or capital ledger from the employee branch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_credit AND branch_id = p_branch_id
      AND is_active = true AND ledger_type IN ('bank', 'cash')
  ) THEN
    RAISE EXCEPTION 'HRMS rule requires an active bank or cash credit account from the employee branch';
  END IF;

  INSERT INTO public.hrms_accounting_queue(event_type, source_id, branch_id, event_date, amount, description)
  VALUES (p_event_type, p_source_id, p_branch_id, COALESCE(p_event_date, current_date), ROUND(p_amount, 2), p_description)
  ON CONFLICT (event_type, source_id) DO UPDATE SET
    branch_id = excluded.branch_id,
    event_date = excluded.event_date,
    amount = excluded.amount,
    description = excluded.description,
    status = CASE WHEN hrms_accounting_queue.status = 'posted' THEN 'posted' ELSE 'pending' END
  RETURNING id INTO v_id;

  IF NOT COALESCE(v_requires, true) THEN
    PERFORM public.post_hrms_accounting_queue_item(v_id);
  END IF;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hrms_queue_event(text, uuid, uuid, date, numeric, text)
TO anon, authenticated;

COMMIT;

-- Verification: every returned row is a problem.
SELECT m.branch_id, 'loss_deduction_ledger_id' AS field_name,
       l.account_name, l.branch_id AS ledger_branch_id, l.ledger_type, l.is_active
FROM public.hrms_account_ledger_mappings m
LEFT JOIN public.ledger_accounts l ON l.id = m.loss_deduction_ledger_id
WHERE m.loss_deduction_ledger_id IS NOT NULL
  AND NOT (l.branch_id = m.branch_id AND l.is_active = true AND l.ledger_type = 'income');

SELECT m.branch_id, 'salary_payable_ledger_id' AS field_name,
       l.account_name, l.branch_id AS ledger_branch_id, l.ledger_type, l.is_active
FROM public.hrms_account_ledger_mappings m
LEFT JOIN public.ledger_accounts l ON l.id = m.salary_payable_ledger_id
WHERE m.salary_payable_ledger_id IS NOT NULL
  AND NOT (l.branch_id = m.branch_id AND l.is_active = true AND l.ledger_type = 'liability');

SELECT r.branch_id, r.rule_key, l.account_name, l.branch_id AS ledger_branch_id,
       l.ledger_type, l.is_active
FROM public.hrms_accounting_rules r
LEFT JOIN public.ledger_accounts l ON l.id = r.debit_ledger_id
WHERE r.rule_key = 'payroll_paid'
  AND NOT (l.branch_id = r.branch_id AND l.is_active = true AND l.ledger_type = 'expenditure');
