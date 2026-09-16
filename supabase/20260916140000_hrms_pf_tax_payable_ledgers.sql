-- PF and tax withheld from employees are amounts owed to statutory authorities.
-- They must therefore use liability ledgers, not income/expenditure ledgers.
-- Run this in the Supabase SQL Editor after 20260916130000_hrms_payroll_journal_breakdown.sql.
BEGIN;

-- Existing mappings to a non-liability, inactive, or cross-branch account can
-- no longer be used. Clear them so the branch admin can select the correct
-- PF Payable and Tax Payable ledgers in Settings > HRMS Accounts.
UPDATE public.hrms_account_ledger_mappings AS mapping
   SET pf_ledger_id = NULL
 WHERE pf_ledger_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.ledger_accounts AS ledger
      WHERE ledger.id = mapping.pf_ledger_id
        AND ledger.branch_id = mapping.branch_id
        AND ledger.is_active = true
        AND ledger.ledger_type = 'liability'
   );

UPDATE public.hrms_account_ledger_mappings AS mapping
   SET tax_ledger_id = NULL
 WHERE tax_ledger_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.ledger_accounts AS ledger
      WHERE ledger.id = mapping.tax_ledger_id
        AND ledger.branch_id = mapping.branch_id
        AND ledger.is_active = true
        AND ledger.ledger_type = 'liability'
   );

CREATE OR REPLACE FUNCTION public.validate_hrms_account_ledger_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  field_name text;
  ledger_id uuid;
BEGIN
  FOREACH field_name IN ARRAY ARRAY[
    'salary_ledger_id', 'incentive_ledger_id', 'salary_deduction_ledger_id',
    'unpaid_leave_deduction_ledger_id', 'paid_leave_payout_ledger_id',
    'extra_work_day_payout_ledger_id', 'loss_deduction_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_accounts AS ledger
       WHERE ledger.id = ledger_id AND ledger.branch_id = NEW.branch_id
         AND ledger.is_active = true
         AND ledger.ledger_type IN ('income', 'expenditure')
    ) THEN
      RAISE EXCEPTION '% must be an active income or expenditure ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  FOREACH field_name IN ARRAY ARRAY[
    'salary_payable_ledger_id', 'incentive_payable_ledger_id',
    'pf_ledger_id', 'tax_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_accounts AS ledger
       WHERE ledger.id = ledger_id AND ledger.branch_id = NEW.branch_id
         AND ledger.is_active = true AND ledger.ledger_type = 'liability'
    ) THEN
      RAISE EXCEPTION '% must be an active liability ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  FOREACH field_name IN ARRAY ARRAY[
    'employee_advance_ledger_id', 'employee_loan_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.ledger_accounts AS ledger
       WHERE ledger.id = ledger_id AND ledger.branch_id = NEW.branch_id
         AND ledger.is_active = true AND ledger.ledger_type = 'asset'
    ) THEN
      RAISE EXCEPTION '% must be an active asset ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Payroll generation independently enforces the rule, protecting posting if
-- a mapping predates the validation trigger or was altered outside the app.
CREATE OR REPLACE FUNCTION public.hrms_require_payroll_ledger(
  p_ledger_id uuid,
  p_branch_id uuid,
  p_label text,
  p_allowed_types text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
BEGIN
  IF p_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map % for the employee Accounting Branch before generating payroll', p_label;
  END IF;

  SELECT ledger_type INTO v_type
    FROM public.ledger_accounts
   WHERE id = p_ledger_id AND branch_id = p_branch_id AND is_active;

  IF p_label IN ('PF', 'Tax') THEN
    p_allowed_types := ARRAY['liability'];
  END IF;

  IF v_type IS NULL OR NOT (v_type = ANY(p_allowed_types)) THEN
    RAISE EXCEPTION '% must be an active % ledger in the employee Accounting Branch',
      p_label,
      CASE WHEN p_label IN ('PF', 'Tax') THEN 'liability' ELSE 'permitted' END;
  END IF;
END;
$$;

COMMIT;
