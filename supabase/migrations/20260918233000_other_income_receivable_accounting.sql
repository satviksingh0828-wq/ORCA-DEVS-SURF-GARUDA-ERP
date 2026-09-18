BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS other_income_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS other_income_receivable_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.incomes
  ADD COLUMN IF NOT EXISTS income_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS income_receivable_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tms_resolve_other_income_accounts(
  p_branch_id UUID,
  p_income_ledger_id UUID DEFAULT NULL,
  p_receivable_ledger_id UUID DEFAULT NULL
) RETURNS TABLE(income_id UUID, receivable_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_map public.tms_account_ledger_mappings%ROWTYPE;
BEGIN
  SELECT * INTO v_map FROM public.tms_account_ledger_mappings WHERE branch_id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TMS account mappings are missing for this branch'; END IF;
  income_id := COALESCE(p_income_ledger_id, v_map.other_income_ledger_id);
  receivable_id := COALESCE(p_receivable_ledger_id, v_map.other_income_receivable_ledger_id);
  IF income_id IS NULL OR receivable_id IS NULL THEN RAISE EXCEPTION 'Map Other Income and Other Income Receivable in TMS Accounts first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = income_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'income') THEN RAISE EXCEPTION 'Income account must be an active income ledger from the same branch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = receivable_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'asset') THEN RAISE EXCEPTION 'Income receivable account must be an active asset ledger from the same branch'; END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_other_income_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_income UUID; v_receivable UUID; v_entry UUID; v_amount NUMERIC(14,2); v_payment RECORD;
BEGIN
  IF COALESCE(NEW.is_fixed_income, false) OR NEW.branch_id IS NULL THEN RETURN NEW; END IF;
  v_amount := round(nullif(trim(coalesce(NEW.amount, '')), '')::numeric, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Income amount must be greater than zero'; END IF;
  SELECT income_id, receivable_id INTO v_income, v_receivable FROM public.tms_resolve_other_income_accounts(NEW.branch_id, NEW.income_ledger_id, NEW.income_receivable_ledger_id);
  UPDATE public.incomes SET income_ledger_id = v_income, income_receivable_ledger_id = v_receivable WHERE id = NEW.id;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (nullif(trim(NEW.entry_date), '')::date, NEW.branch_id, NEW.income_name || ' due', 'other_income_accrual:' || NEW.id, 'auto', 'approved', now()) RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, NEW.branch_id, v_receivable, 'ledger', NEW.income_name || ' receivable', v_amount, 0),
    (v_entry, 2, NEW.branch_id, v_income, 'ledger', NEW.income_name, 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  IF NEW.is_received THEN
    IF NEW.payment_ledger_id IS NULL THEN RAISE EXCEPTION 'Select a cash or bank account for received income'; END IF;
    SELECT * INTO v_payment FROM public.ledger_accounts WHERE id = NEW.payment_ledger_id AND branch_id = NEW.branch_id AND is_active AND ledger_type IN ('cash','bank');
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt account must be an active cash or bank account from the same branch'; END IF;
    INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
    VALUES (COALESCE(nullif(trim(NEW.received_date), '')::date, current_date), NEW.branch_id, NEW.income_name || ' received', 'other_income_received:' || NEW.id, 'auto', 'approved', now()) RETURNING id INTO v_entry;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES (v_entry, 1, NEW.branch_id, v_payment.id, v_payment.account_kind, NEW.income_name || ' received in ' || v_payment.account_name, v_amount, 0),
           (v_entry, 2, NEW.branch_id, v_receivable, 'ledger', NEW.income_name || ' receivable settled', 0, v_amount);
    PERFORM public.validate_journal_entry(v_entry);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_other_income_received()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payment RECORD; v_entry UUID; v_amount NUMERIC(14,2);
BEGIN
  IF NEW.is_fixed_income OR NOT NEW.is_received OR OLD.is_received THEN RETURN NEW; END IF;
  IF NEW.payment_ledger_id IS NULL THEN RAISE EXCEPTION 'Select a cash or bank account for received income'; END IF;
  v_amount := round(nullif(trim(coalesce(NEW.amount, '')), '')::numeric, 2);
  SELECT * INTO v_payment FROM public.ledger_accounts WHERE id = NEW.payment_ledger_id AND branch_id = NEW.branch_id AND is_active AND ledger_type IN ('cash','bank');
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt account must be an active cash or bank account from the same branch'; END IF;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (COALESCE(nullif(trim(NEW.received_date), '')::date, current_date), NEW.branch_id, NEW.income_name || ' received', 'other_income_received:' || NEW.id, 'auto', 'approved', now()) RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES (v_entry, 1, NEW.branch_id, v_payment.id, v_payment.account_kind, NEW.income_name || ' received in ' || v_payment.account_name, v_amount, 0),
         (v_entry, 2, NEW.branch_id, NEW.income_receivable_ledger_id, 'ledger', NEW.income_name || ' receivable settled', 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incomes_other_income_created ON public.incomes;
CREATE TRIGGER incomes_other_income_created AFTER INSERT ON public.incomes
FOR EACH ROW EXECUTE FUNCTION public.tms_other_income_created();
DROP TRIGGER IF EXISTS incomes_other_income_received ON public.incomes;
CREATE TRIGGER incomes_other_income_received AFTER UPDATE OF is_received ON public.incomes
FOR EACH ROW EXECUTE FUNCTION public.tms_other_income_received();

GRANT EXECUTE ON FUNCTION public.tms_resolve_other_income_accounts(UUID, UUID, UUID) TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tms_account_ledger_mappings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.incomes TO anon, authenticated;

COMMIT;
