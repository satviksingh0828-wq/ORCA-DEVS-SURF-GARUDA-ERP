BEGIN;

CREATE TABLE IF NOT EXISTS public.tms_account_ledger_mappings (
  branch_id UUID PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  driver_salary_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  driver_salary_payable_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  driver_advance_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_advances
  ADD COLUMN IF NOT EXISTS disbursement_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.driver_payrolls
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.expenditures
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.tms_account_ledger_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON public.tms_account_ledger_mappings;
CREATE POLICY service_role_all ON public.tms_account_ledger_mappings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tms_validate_ledger(
  p_ledger_id UUID,
  p_branch_id UUID,
  p_types TEXT[]
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ledger_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = p_ledger_id AND branch_id = p_branch_id
      AND is_active AND ledger_type = ANY(p_types)
  ) THEN
    RAISE EXCEPTION 'Selected ledger must be an active %, belonging to the same branch', array_to_string(p_types, ' or ');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_driver_payroll_generated_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_map public.tms_account_ledger_mappings%ROWTYPE;
  v_entry UUID;
  v_existing UUID;
  v_advance NUMERIC := round(COALESCE(NEW.advance_deduction, 0), 2);
  v_net NUMERIC := round(COALESCE(NEW.net_amount, 0), 2);
  v_salary NUMERIC := round(COALESCE(NEW.salary_amount, 0), 2);
  v_description TEXT := 'Driver salary - ' || NEW.month;
BEGIN
  SELECT * INTO v_map FROM public.tms_account_ledger_mappings WHERE branch_id = NEW.branch_id;
  IF v_map.driver_salary_ledger_id IS NULL
     OR v_map.driver_salary_payable_ledger_id IS NULL
     OR v_map.driver_advance_ledger_id IS NULL THEN
    RAISE EXCEPTION 'TMS Accounts mapping is incomplete for this branch. Map Driver Salary, Driver Salary Payable, and Driver Advance first';
  END IF;
  PERFORM public.tms_validate_ledger(v_map.driver_salary_ledger_id, NEW.branch_id, ARRAY['expenditure']);
  PERFORM public.tms_validate_ledger(v_map.driver_salary_payable_ledger_id, NEW.branch_id, ARRAY['liability']);
  PERFORM public.tms_validate_ledger(v_map.driver_advance_ledger_id, NEW.branch_id, ARRAY['asset']);
  IF round(v_salary, 2) <> round(v_net + v_advance, 2) THEN
    RAISE EXCEPTION 'Driver payroll amounts are not balanced: salary %, net %, advance deduction %', v_salary, v_net, v_advance;
  END IF;
  SELECT id INTO v_existing FROM public.journal_entries
    WHERE reference = 'tms:driver-payroll:generated:' || NEW.id::text AND source_module = 'auto';
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (to_date(NEW.month || '-01', 'YYYY-MM-DD'), NEW.branch_id, v_description,
          'tms:driver-payroll:generated:' || NEW.id::text, 'auto', 'approved', now())
  RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, NEW.branch_id, v_map.driver_salary_ledger_id, 'ledger', v_description, v_salary, 0),
    (v_entry, 2, NEW.branch_id, v_map.driver_salary_payable_ledger_id, 'ledger', v_description, 0, v_net),
    (v_entry, 3, NEW.branch_id, v_map.driver_advance_ledger_id, 'ledger', v_description, 0, v_advance);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_driver_advance_given_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_map public.tms_account_ledger_mappings%ROWTYPE;
  v_entry UUID;
  v_existing UUID;
  v_description TEXT := 'Driver advance given';
BEGIN
  SELECT * INTO v_map FROM public.tms_account_ledger_mappings WHERE branch_id = NEW.branch_id;
  IF v_map.driver_advance_ledger_id IS NULL THEN
    RAISE EXCEPTION 'TMS Accounts mapping is missing Driver Advance for this branch';
  END IF;
  PERFORM public.tms_validate_ledger(v_map.driver_advance_ledger_id, NEW.branch_id, ARRAY['asset']);
  PERFORM public.tms_validate_ledger(NEW.disbursement_ledger_id, NEW.branch_id, ARRAY['cash', 'bank']);
  SELECT id INTO v_existing FROM public.journal_entries
    WHERE reference = 'tms:driver-advance:' || NEW.id::text AND source_module = 'auto';
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (NEW.payment_date::date, NEW.branch_id, v_description,
          'tms:driver-advance:' || NEW.id::text, 'auto', 'approved', now())
  RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, NEW.branch_id, v_map.driver_advance_ledger_id, 'ledger', v_description, round(NEW.amount, 2), 0),
    (v_entry, 2, NEW.branch_id, NEW.disbursement_ledger_id, 'ledger', v_description, 0, round(NEW.amount, 2));
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_record_driver_salary_payment(
  p_payroll_id UUID,
  p_payment_ledger_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.driver_payrolls%ROWTYPE;
  v_map public.tms_account_ledger_mappings%ROWTYPE;
  v_entry UUID;
  v_existing UUID;
  v_description TEXT;
BEGIN
  SELECT * INTO p FROM public.driver_payrolls WHERE id = p_payroll_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Driver payroll was not found'; END IF;
  IF p.is_paid THEN
    SELECT id INTO v_existing FROM public.journal_entries
      WHERE reference = 'tms:driver-payroll:paid:' || p.id::text AND source_module = 'auto';
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    RAISE EXCEPTION 'Driver payroll is already marked paid';
  END IF;
  SELECT * INTO v_map FROM public.tms_account_ledger_mappings WHERE branch_id = p.branch_id;
  IF v_map.driver_salary_payable_ledger_id IS NULL THEN
    RAISE EXCEPTION 'TMS Accounts mapping is missing Driver Salary Payable for this branch';
  END IF;
  PERFORM public.tms_validate_ledger(v_map.driver_salary_payable_ledger_id, p.branch_id, ARRAY['liability']);
  PERFORM public.tms_validate_ledger(p_payment_ledger_id, p.branch_id, ARRAY['cash', 'bank']);
  v_description := 'Driver salary paid - ' || p.month;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (current_date, p.branch_id, v_description,
          'tms:driver-payroll:paid:' || p.id::text, 'auto', 'approved', now())
  ON CONFLICT DO NOTHING RETURNING id INTO v_entry;
  IF v_entry IS NULL THEN
    SELECT id INTO v_entry FROM public.journal_entries
      WHERE reference = 'tms:driver-payroll:paid:' || p.id::text AND source_module = 'auto';
  ELSE
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES
      (v_entry, 1, p.branch_id, v_map.driver_salary_payable_ledger_id, 'ledger', v_description, round(p.net_amount, 2), 0),
      (v_entry, 2, p.branch_id, p_payment_ledger_id, 'ledger', v_description, 0, round(p.net_amount, 2));
    PERFORM public.validate_journal_entry(v_entry);
  END IF;
  UPDATE public.driver_payrolls
    SET is_paid = true, paid_date = current_date::text, payment_ledger_id = p_payment_ledger_id, updated_at = now()
    WHERE id = p.id;
  UPDATE public.expenditures
    SET is_paid = true, paid_date = current_date::text, payment_ledger_id = p_payment_ledger_id
    WHERE payroll_id = p.id;
  RETURN v_entry;
END;
$$;

DROP TRIGGER IF EXISTS tms_driver_payroll_generated ON public.driver_payrolls;
CREATE TRIGGER tms_driver_payroll_generated
AFTER INSERT ON public.driver_payrolls FOR EACH ROW
EXECUTE FUNCTION public.tms_driver_payroll_generated_journal();

DROP TRIGGER IF EXISTS tms_driver_advance_given ON public.driver_advances;
CREATE TRIGGER tms_driver_advance_given
AFTER INSERT ON public.driver_advances FOR EACH ROW
EXECUTE FUNCTION public.tms_driver_advance_given_journal();

GRANT EXECUTE ON FUNCTION public.tms_record_driver_salary_payment(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tms_validate_ledger(UUID, UUID, TEXT[]) TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tms_account_ledger_mappings TO anon, authenticated;

COMMIT;
