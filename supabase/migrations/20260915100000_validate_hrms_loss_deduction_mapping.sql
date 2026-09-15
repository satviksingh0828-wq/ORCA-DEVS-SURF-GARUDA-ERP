-- Loss deductions must post to an active income/expenditure ledger in the
-- employee's resolved accounting branch.
ALTER TABLE public.hrms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS loss_deduction_ledger_id uuid
  REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

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
      SELECT 1
      FROM public.ledger_accounts l
      WHERE l.id = ledger_id
        AND l.branch_id = NEW.branch_id
        AND l.is_active = true
        AND l.ledger_type IN ('income', 'expenditure')
    ) THEN
      RAISE EXCEPTION '% must be an active income or expenditure ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  FOREACH field_name IN ARRAY ARRAY[
    'salary_payable_ledger_id', 'incentive_payable_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.ledger_accounts l
      WHERE l.id = ledger_id
        AND l.branch_id = NEW.branch_id
        AND l.is_active = true
        AND l.ledger_type = 'liability'
    ) THEN
      RAISE EXCEPTION '% must be an active liability ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  FOREACH field_name IN ARRAY ARRAY[
    'employee_advance_ledger_id', 'employee_loan_ledger_id'
  ] LOOP
    ledger_id := (to_jsonb(NEW)->>field_name)::uuid;
    IF ledger_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.ledger_accounts l
      WHERE l.id = ledger_id
        AND l.branch_id = NEW.branch_id
        AND l.is_active = true
        AND l.ledger_type = 'asset'
    ) THEN
      RAISE EXCEPTION '% must be an active asset ledger from branch %', field_name, NEW.branch_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_hrms_account_ledger_mapping ON public.hrms_account_ledger_mappings;
CREATE TRIGGER validate_hrms_account_ledger_mapping
BEFORE INSERT OR UPDATE ON public.hrms_account_ledger_mappings
FOR EACH ROW EXECUTE FUNCTION public.validate_hrms_account_ledger_mapping();

-- Revalidate existing mappings immediately; this fails loudly if an old mapping
-- points to another branch, an inactive ledger, or the wrong ledger type.
UPDATE public.hrms_account_ledger_mappings SET updated_at = now();
