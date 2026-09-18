BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS fixed_monthly_income_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fixed_yearly_income_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.fixed_income_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly')),
  income_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  income_ledger_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fixed_income_lines_contract_idx ON public.fixed_income_lines(contract_id);

ALTER TABLE public.incomes
  ADD COLUMN IF NOT EXISTS is_fixed_income BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fixed_income_line_id UUID REFERENCES public.fixed_income_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fixed_income_frequency TEXT,
  ADD COLUMN IF NOT EXISTS fixed_income_period TEXT,
  ADD COLUMN IF NOT EXISTS income_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS incomes_fixed_income_period_uidx
  ON public.incomes(fixed_income_line_id, fixed_income_period)
  WHERE is_fixed_income = true;

ALTER TABLE public.fixed_income_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app can manage fixed income lines" ON public.fixed_income_lines;
CREATE POLICY "app can manage fixed income lines" ON public.fixed_income_lines
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_income_lines TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.tms_validate_fixed_income_line()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch UUID;
BEGIN
  SELECT branch_id INTO v_branch FROM public.contracts WHERE id = NEW.contract_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Fixed income source must have a branch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = NEW.income_ledger_id AND branch_id = v_branch AND is_active AND ledger_type = 'income'
  ) THEN
    RAISE EXCEPTION 'Fixed income account must be an active income ledger from the source branch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS fixed_income_lines_validate ON public.fixed_income_lines;
CREATE TRIGGER fixed_income_lines_validate BEFORE INSERT OR UPDATE ON public.fixed_income_lines
FOR EACH ROW EXECUTE FUNCTION public.tms_validate_fixed_income_line();

CREATE OR REPLACE FUNCTION public.tms_mark_fixed_income_due(
  p_line_id UUID,
  p_period_start DATE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line public.fixed_income_lines%ROWTYPE;
  v_contract public.contracts%ROWTYPE;
  v_period TEXT := to_char(p_period_start, 'YYYY-MM');
  v_amount NUMERIC(14,2);
  v_income_id UUID;
  v_entry UUID;
  v_branch UUID;
BEGIN
  SELECT * INTO v_line FROM public.fixed_income_lines WHERE id = p_line_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixed income line not found or inactive'; END IF;
  SELECT * INTO v_contract FROM public.contracts WHERE id = v_line.contract_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixed income source is not active'; END IF;
  v_branch := v_contract.branch_id;
  IF v_line.frequency = 'monthly' THEN
    v_amount := v_line.amount;
  ELSE
    v_amount := round(v_line.amount / 12, 2);
  END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Fixed income amount must be greater than zero'; END IF;
  INSERT INTO public.incomes(
    income_name, amount, note, entry_date, branch_id, is_received, received_date,
    is_fixed_income, fixed_income_line_id, fixed_income_frequency, fixed_income_period,
    income_ledger_id, source_contract_id
  ) VALUES (
    v_line.income_name, v_amount::TEXT, v_line.note, p_period_start::TEXT, v_branch, false, '',
    true, v_line.id, v_line.frequency, v_period, v_line.income_ledger_id, v_contract.id
  ) ON CONFLICT (fixed_income_line_id, fixed_income_period) WHERE is_fixed_income = true
    DO NOTHING RETURNING id INTO v_income_id;
  IF v_income_id IS NULL THEN RAISE EXCEPTION 'This fixed income is already marked due for %', v_period; END IF;

  IF v_contract.source_asset_ledger_id IS NULL THEN RAISE EXCEPTION 'Map a Source Account before marking fixed income due'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_contract.source_asset_ledger_id AND branch_id = v_branch AND is_active AND ledger_type = 'asset') THEN
    RAISE EXCEPTION 'Source Account must be an active asset account from the source branch';
  END IF;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (p_period_start, v_branch, v_line.income_name || ' due', 'fixed_income_due:' || v_income_id, 'fixed_income', 'approved', now()) RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, v_branch, v_contract.source_asset_ledger_id, 'ledger', v_line.income_name || ' due from source', v_amount, 0),
    (v_entry, 2, v_branch, v_line.income_ledger_id, 'ledger', v_line.income_name, 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN v_income_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_fixed_income_received()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_contract public.contracts%ROWTYPE; v_payment RECORD; v_entry UUID; v_amount NUMERIC(14,2);
BEGIN
  IF NOT NEW.is_fixed_income OR NOT NEW.is_received OR OLD.is_received THEN RETURN NEW; END IF;
  IF NEW.payment_ledger_id IS NULL THEN RAISE EXCEPTION 'Select a cash or bank account for fixed income receipt'; END IF;
  SELECT * INTO v_contract FROM public.contracts WHERE id = NEW.source_contract_id;
  v_amount := round(nullif(trim(NEW.amount), '')::numeric, 2);
  SELECT * INTO v_payment FROM public.ledger_accounts WHERE id = NEW.payment_ledger_id AND branch_id = NEW.branch_id AND is_active AND ledger_type IN ('cash','bank');
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt account must be an active cash or bank account from the source branch'; END IF;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (COALESCE(nullif(NEW.received_date, '')::date, current_date), NEW.branch_id, NEW.income_name || ' received', 'fixed_income_received:' || NEW.id, 'fixed_income', 'approved', now()) RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, NEW.branch_id, v_payment.id, v_payment.account_kind, NEW.income_name || ' received in ' || v_payment.account_name, v_amount, 0),
    (v_entry, 2, NEW.branch_id, v_contract.source_asset_ledger_id, 'ledger', NEW.income_name || ' source receivable settled', 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS incomes_fixed_income_received ON public.incomes;
CREATE TRIGGER incomes_fixed_income_received AFTER UPDATE OF is_received ON public.incomes
FOR EACH ROW EXECUTE FUNCTION public.tms_fixed_income_received();

GRANT EXECUTE ON FUNCTION public.tms_mark_fixed_income_due(UUID, DATE) TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.incomes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contracts TO anon, authenticated;

COMMIT;
