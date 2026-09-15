-- Fix HRMS loss-deduction journal posting.
-- Salary Payable is the liability that is debited; Loss Deduction is the
-- income/expenditure ledger that is credited. Both must belong to the
-- employee's resolved Accounting Branch and be active.
BEGIN;

ALTER TABLE public.hrms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS loss_deduction_ledger_id uuid
  REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

-- Keep existing installations working: before the dedicated field existed,
-- the loss journal used salary_deduction_ledger_id for the credit account.
UPDATE public.hrms_account_ledger_mappings
   SET loss_deduction_ledger_id = salary_deduction_ledger_id
 WHERE loss_deduction_ledger_id IS NULL
   AND salary_deduction_ledger_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.hrms_loss_deduction_journal_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_debit uuid;
  v_credit uuid;
  v_entry uuid;
  v_existing uuid;
  v_description text;
BEGIN
  v_branch_id := public.hrms_branch_for_employee(NEW.employee_id);
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Employee has no Accounting Branch or department branch';
  END IF;

  SELECT salary_payable_ledger_id, loss_deduction_ledger_id
    INTO v_debit, v_credit
    FROM public.hrms_account_ledger_mappings
   WHERE branch_id = v_branch_id;

  IF v_debit IS NULL OR v_credit IS NULL THEN
    RAISE EXCEPTION 'Map Salary Payable and Loss Deduction ledgers for the employee Accounting Branch before adding a loss deduction';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.ledger_accounts
     WHERE id = v_debit
       AND branch_id = v_branch_id
       AND is_active = true
       AND ledger_type = 'liability'
  ) THEN
    RAISE EXCEPTION 'Salary Payable must be an active liability ledger from the employee branch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.ledger_accounts
     WHERE id = v_credit
       AND branch_id = v_branch_id
       AND is_active = true
       AND ledger_type IN ('income', 'expenditure')
  ) THEN
    RAISE EXCEPTION 'Loss Deduction must be an active income or expenditure ledger from the employee branch';
  END IF;

  v_description := 'Loss deduction' || CASE
    WHEN NULLIF(TRIM(NEW.reason), '') IS NULL THEN ''
    ELSE ' - ' || TRIM(NEW.reason)
  END;

  SELECT id
    INTO v_existing
    FROM public.journal_entries
   WHERE reference = 'hrms:loss-deduction:' || NEW.id::text
     AND source_module = 'auto';
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) VALUES (
    NEW.journal_date, v_branch_id, v_description,
    'hrms:loss-deduction:' || NEW.id::text, 'auto', 'approved', now()
  ) RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) VALUES
    (v_entry, 1, v_branch_id, v_debit, 'ledger', v_description, round(NEW.amount, 2), 0),
    (v_entry, 2, v_branch_id, v_credit, 'ledger', v_description, 0, round(NEW.amount, 2));

  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loss_deductions_hrms_journal ON public.loss_deductions;
CREATE TRIGGER loss_deductions_hrms_journal
AFTER INSERT ON public.loss_deductions
FOR EACH ROW EXECUTE FUNCTION public.hrms_loss_deduction_journal_trigger();

GRANT EXECUTE ON FUNCTION public.hrms_loss_deduction_journal_trigger() TO anon, authenticated;

COMMIT;
