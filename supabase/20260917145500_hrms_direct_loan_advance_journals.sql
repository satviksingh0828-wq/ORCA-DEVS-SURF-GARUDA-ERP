-- Create loan and advance disbursement journals directly, matching Loss Deduction accounting.
-- This avoids dependence on the HRMS accounting queue/rule-posting path.
BEGIN;

CREATE OR REPLACE FUNCTION public.hrms_loan_journal_trigger()
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
  v_description text := 'Loan given';
BEGIN
  v_branch_id := public.hrms_branch_for_employee(NEW.employee_id);
  v_credit := NEW.disbursement_ledger_id;
  SELECT employee_loan_ledger_id INTO v_debit
  FROM public.hrms_account_ledger_mappings
  WHERE branch_id = v_branch_id;

  IF v_debit IS NULL OR v_credit IS NULL THEN
    RAISE EXCEPTION 'Loan journal requires Employee Loan asset and bank/cash disbursement ledger mappings';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_debit AND branch_id = v_branch_id AND ledger_type = 'asset' AND is_active
  ) THEN
    RAISE EXCEPTION 'Employee Loan mapping must be an active asset ledger from the employee Accounting Branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_credit AND branch_id = v_branch_id AND ledger_type IN ('bank', 'cash') AND is_active
  ) THEN
    RAISE EXCEPTION 'Loan disbursement account must be an active bank or cash ledger from the employee Accounting Branch';
  END IF;

  SELECT id INTO v_existing
  FROM public.journal_entries
  WHERE reference = 'hrms:loan:' || NEW.id::text AND source_module = 'auto';
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (NEW.start_date, v_branch_id, v_description, 'hrms:loan:' || NEW.id::text, 'auto', 'approved', now())
  RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, v_branch_id, v_debit, 'ledger', v_description, round(NEW.principal, 2), 0),
    (v_entry, 2, v_branch_id, v_credit, 'ledger', v_description, 0, round(NEW.principal, 2));

  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.hrms_advance_journal_trigger()
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
  v_description text := 'Advance given';
BEGIN
  v_branch_id := public.hrms_branch_for_employee(NEW.employee_id);
  v_credit := NEW.disbursement_ledger_id;
  SELECT employee_advance_ledger_id INTO v_debit
  FROM public.hrms_account_ledger_mappings
  WHERE branch_id = v_branch_id;

  IF v_debit IS NULL OR v_credit IS NULL THEN
    RAISE EXCEPTION 'Advance journal requires Employee Advance asset and bank/cash disbursement ledger mappings';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_debit AND branch_id = v_branch_id AND ledger_type = 'asset' AND is_active
  ) THEN
    RAISE EXCEPTION 'Employee Advance mapping must be an active asset ledger from the employee Accounting Branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_credit AND branch_id = v_branch_id AND ledger_type IN ('bank', 'cash') AND is_active
  ) THEN
    RAISE EXCEPTION 'Advance disbursement account must be an active bank or cash ledger from the employee Accounting Branch';
  END IF;

  SELECT id INTO v_existing
  FROM public.journal_entries
  WHERE reference = 'hrms:advance:' || NEW.id::text AND source_module = 'auto';
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (NEW.start_date, v_branch_id, v_description, 'hrms:advance:' || NEW.id::text, 'auto', 'approved', now())
  RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, v_branch_id, v_debit, 'ledger', v_description, round(NEW.principal, 2), 0),
    (v_entry, 2, v_branch_id, v_credit, 'ledger', v_description, 0, round(NEW.principal, 2));

  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loans_hrms_accounting ON public.loans;
CREATE TRIGGER loans_hrms_accounting
AFTER INSERT ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.hrms_loan_journal_trigger();

DROP TRIGGER IF EXISTS advances_hrms_accounting ON public.advances;
CREATE TRIGGER advances_hrms_accounting
AFTER INSERT ON public.advances
FOR EACH ROW EXECUTE FUNCTION public.hrms_advance_journal_trigger();

GRANT EXECUTE ON FUNCTION public.hrms_loan_journal_trigger(), public.hrms_advance_journal_trigger() TO anon, authenticated;

COMMIT;
