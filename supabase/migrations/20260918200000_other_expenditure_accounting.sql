BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS other_expenditure_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS other_expenditure_payable_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.expenditures
  ADD COLUMN IF NOT EXISTS expenditure_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expenditure_payable_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tms_resolve_other_expenditure_accounts(
  p_branch_id UUID,
  p_expenditure_ledger_id UUID DEFAULT NULL,
  p_payable_ledger_id UUID DEFAULT NULL
) RETURNS TABLE(expenditure_id UUID, payable_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_map public.tms_account_ledger_mappings%ROWTYPE;
BEGIN
  SELECT * INTO v_map FROM public.tms_account_ledger_mappings WHERE branch_id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TMS account mappings are missing for this branch'; END IF;
  expenditure_id := COALESCE(p_expenditure_ledger_id, v_map.other_expenditure_ledger_id);
  payable_id := COALESCE(p_payable_ledger_id, v_map.other_expenditure_payable_ledger_id);
  IF expenditure_id IS NULL OR payable_id IS NULL THEN
    RAISE EXCEPTION 'Map Other Expenditure and Other Expenditure Payable in TMS Accounts first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = expenditure_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure') THEN
    RAISE EXCEPTION 'Expenditure account must be an active expenditure ledger from the same branch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = payable_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'liability') THEN
    RAISE EXCEPTION 'Expenditure payable account must be an active liability ledger from the same branch';
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_other_expenditure_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_exp UUID;
  v_payable UUID;
  v_entry UUID;
  v_amount NUMERIC(14,2);
  v_paid RECORD;
  v_paid_date DATE;
BEGIN
  IF NEW.branch_id IS NULL OR COALESCE(NEW.is_emi, false) OR COALESCE(NEW.is_payroll, false)
     OR COALESCE(NEW.is_insurance, false) OR COALESCE(NEW.is_road_tax, false) THEN RETURN NEW; END IF;
  v_amount := round(nullif(trim(coalesce(NEW.amount, '')), '')::numeric, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Expenditure amount must be greater than zero'; END IF;
  SELECT expenditure_id, payable_id INTO v_exp, v_payable
    FROM public.tms_resolve_other_expenditure_accounts(NEW.branch_id, NEW.expenditure_ledger_id, NEW.expenditure_payable_ledger_id);
  UPDATE public.expenditures SET expenditure_ledger_id = v_exp, expenditure_payable_ledger_id = v_payable WHERE id = NEW.id;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (nullif(trim(NEW.entry_date), '')::date, NEW.branch_id, NEW.expenditure_name, 'other_expenditure_accrual:' || NEW.id, 'auto', 'approved', now())
  ON CONFLICT DO NOTHING RETURNING id INTO v_entry;
  IF v_entry IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, NEW.branch_id, v_exp, 'ledger', NEW.expenditure_name, v_amount, 0),
    (v_entry, 2, NEW.branch_id, v_payable, 'ledger', NEW.expenditure_name || ' payable', 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  IF NEW.is_paid THEN
    IF NEW.payment_ledger_id IS NULL THEN RAISE EXCEPTION 'Select a cash or bank account for a paid expenditure'; END IF;
    SELECT * INTO v_paid FROM public.ledger_accounts WHERE id = NEW.payment_ledger_id AND branch_id = NEW.branch_id AND is_active AND ledger_type IN ('cash', 'bank');
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment account must be an active cash or bank account from the same branch'; END IF;
    v_paid_date := nullif(trim(coalesce(NEW.paid_date, '')), '')::date;
    INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
    VALUES (COALESCE(v_paid_date, current_date), NEW.branch_id, NEW.expenditure_name || ' payment', 'other_expenditure_payment:' || NEW.id, 'auto', 'approved', now())
    RETURNING id INTO v_entry;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES
      (v_entry, 1, NEW.branch_id, v_payable, 'ledger', NEW.expenditure_name || ' payable settled', v_amount, 0),
      (v_entry, 2, NEW.branch_id, v_paid.id, v_paid.account_kind, NEW.expenditure_name || ' paid from ' || v_paid.account_name, 0, v_amount);
    PERFORM public.validate_journal_entry(v_entry);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_other_expenditure_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payable UUID;
  v_paid RECORD;
  v_entry UUID;
  v_amount NUMERIC(14,2);
BEGIN
  IF NEW.branch_id IS NULL OR COALESCE(NEW.is_emi, false) OR COALESCE(NEW.is_payroll, false)
     OR COALESCE(NEW.is_insurance, false) OR COALESCE(NEW.is_road_tax, false)
     OR NOT NEW.is_paid OR OLD.is_paid THEN RETURN NEW; END IF;
  v_amount := round(nullif(trim(coalesce(NEW.amount, '')), '')::numeric, 2);
  IF NEW.payment_ledger_id IS NULL THEN RAISE EXCEPTION 'Select a cash or bank account for this expenditure payment'; END IF;
  SELECT * INTO v_paid FROM public.ledger_accounts WHERE id = NEW.payment_ledger_id AND branch_id = NEW.branch_id AND is_active AND ledger_type IN ('cash', 'bank');
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment account must be an active cash or bank account from the same branch'; END IF;
  SELECT payable_id INTO v_payable FROM public.tms_resolve_other_expenditure_accounts(NEW.branch_id, NEW.expenditure_ledger_id, NEW.expenditure_payable_ledger_id);
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (COALESCE(nullif(trim(NEW.paid_date), '')::date, current_date), NEW.branch_id, NEW.expenditure_name || ' payment', 'other_expenditure_payment:' || NEW.id, 'auto', 'approved', now())
  ON CONFLICT DO NOTHING RETURNING id INTO v_entry;
  IF v_entry IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, NEW.branch_id, v_payable, 'ledger', NEW.expenditure_name || ' payable settled', v_amount, 0),
    (v_entry, 2, NEW.branch_id, v_paid.id, v_paid.account_kind, NEW.expenditure_name || ' paid from ' || v_paid.account_name, 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenditures_other_accounting_created ON public.expenditures;
CREATE TRIGGER expenditures_other_accounting_created AFTER INSERT ON public.expenditures
FOR EACH ROW EXECUTE FUNCTION public.tms_other_expenditure_created();
DROP TRIGGER IF EXISTS expenditures_other_accounting_paid ON public.expenditures;
CREATE TRIGGER expenditures_other_accounting_paid AFTER UPDATE OF is_paid ON public.expenditures
FOR EACH ROW EXECUTE FUNCTION public.tms_other_expenditure_paid();

GRANT EXECUTE ON FUNCTION public.tms_resolve_other_expenditure_accounts(UUID, UUID, UUID) TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tms_account_ledger_mappings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.expenditures TO anon, authenticated;

COMMIT;
