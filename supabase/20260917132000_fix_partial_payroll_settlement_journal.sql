-- Post only the newly paid salary amount when a partial payroll is settled.
-- payment_amount is cumulative on payrolls; journal entries must contain each payment delta.
BEGIN;

CREATE OR REPLACE FUNCTION public.hrms_create_payroll_paid_journal(
  p_payroll public.payrolls,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_map public.hrms_account_ledger_mappings%rowtype;
  v_cash uuid;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_ref text := 'hrms:payroll-paid:' || p_payroll.id::text || ':'
    || coalesce(p_payroll.payment_date, p_payroll.period_end)::text || ':'
    || v_amount::text;
  v_description text := 'Salary paid - ' || p_payroll.period_start || ' to ' || p_payroll.period_end;
BEGIN
  IF v_amount <= 0 THEN RETURN NULL; END IF;
  v_branch := public.hrms_branch_for_employee(p_payroll.employee_id);
  SELECT * INTO v_map
  FROM public.hrms_account_ledger_mappings
  WHERE branch_id = v_branch;
  v_cash := p_payroll.payment_ledger_id;
  IF v_cash IS NULL THEN
    SELECT default_bank_cash_ledger_id INTO v_cash
    FROM public.hrms_accounting_rules
    WHERE branch_id = v_branch AND rule_key = 'payroll_paid';
  END IF;
  PERFORM public.hrms_require_payroll_ledger(v_map.salary_payable_ledger_id, v_branch, 'Salary Payable', ARRAY['liability']);
  PERFORM public.hrms_require_payroll_ledger(v_cash, v_branch, 'Payroll bank/cash account', ARRAY['bank','cash']);
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_cash AND branch_id = v_branch AND is_active AND ledger_type IN ('bank', 'cash')
  ) THEN
    RAISE EXCEPTION 'Payroll payment account must be an active cash or bank ledger from the employee accounting branch';
  END IF;
  SELECT id INTO v_entry
  FROM public.journal_entries
  WHERE reference = v_ref AND source_module = 'auto';
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (coalesce(p_payroll.payment_date, p_payroll.period_end), v_branch, v_description, v_ref, 'auto', 'approved', now())
  RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, v_branch, v_map.salary_payable_ledger_id, 'ledger', v_description, v_amount, 0),
    (v_entry, 2, v_branch, v_cash, (SELECT account_kind FROM public.ledger_accounts WHERE id = v_cash), v_description, 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.hrms_payroll_accounting_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_paid numeric := 0;
  v_current_paid numeric;
  v_delta numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.hrms_create_payroll_generated_journal(NEW);
  END IF;
  IF NEW.payment_status IN ('paid'::public.payroll_payment_status, 'partial_paid'::public.payroll_payment_status) THEN
    v_current_paid := round(coalesce(nullif(NEW.payment_amount, 0), NEW.net), 2);
    IF TG_OP = 'UPDATE' THEN
      v_previous_paid := round(coalesce(OLD.payment_amount, 0), 2);
    END IF;
    v_delta := round(v_current_paid - v_previous_paid, 2);
    IF TG_OP = 'INSERT'
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
       OR NEW.payment_ledger_id IS DISTINCT FROM OLD.payment_ledger_id THEN
      PERFORM public.hrms_create_payroll_paid_journal(NEW, v_delta);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payrolls_hrms_accounting ON public.payrolls;
CREATE TRIGGER payrolls_hrms_accounting
AFTER INSERT OR UPDATE OF payment_status, payment_date, payment_amount, payment_ledger_id ON public.payrolls
FOR EACH ROW EXECUTE FUNCTION public.hrms_payroll_accounting_trigger();

GRANT EXECUTE ON FUNCTION public.hrms_create_payroll_paid_journal(public.payrolls, numeric), public.hrms_payroll_accounting_trigger() TO anon, authenticated;

COMMIT;
