BEGIN;

ALTER TABLE public.vehicle_insurance
  ADD COLUMN IF NOT EXISTS paid_by_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.vehicle_road_tax
  ADD COLUMN IF NOT EXISTS paid_by_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS vehicle_insurance_advance_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_insurance_expense_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_road_tax_advance_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_road_tax_expense_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tms_require_vehicle_coverage_mapping(
  p_branch_id UUID,
  p_kind TEXT
) RETURNS TABLE (advance_id UUID, expense_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map public.tms_account_ledger_mappings%ROWTYPE;
  v_advance UUID;
  v_expense UUID;
BEGIN
  SELECT * INTO v_map
  FROM public.tms_account_ledger_mappings
  WHERE branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TMS account mappings are missing for this branch';
  END IF;

  IF p_kind = 'insurance' THEN
    v_advance := v_map.vehicle_insurance_advance_ledger_id;
    v_expense := v_map.vehicle_insurance_expense_ledger_id;
  ELSIF p_kind = 'road_tax' THEN
    v_advance := v_map.vehicle_road_tax_advance_ledger_id;
    v_expense := v_map.vehicle_road_tax_expense_ledger_id;
  ELSE
    RAISE EXCEPTION 'Unknown vehicle coverage type: %', p_kind;
  END IF;

  IF v_advance IS NULL OR v_expense IS NULL THEN
    RAISE EXCEPTION 'Map Vehicle % Advance and Vehicle % Expense in TMS Accounts first',
      initcap(replace(p_kind, '_', ' ')), initcap(replace(p_kind, '_', ' '));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_advance AND branch_id = p_branch_id AND is_active AND ledger_type = 'asset'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_expense AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure'
  ) THEN
    RAISE EXCEPTION 'Vehicle % Advance must be an active asset and Vehicle % Expense must be an active expenditure ledger from the same branch',
      replace(p_kind, '_', ' '), replace(p_kind, '_', ' ');
  END IF;

  RETURN QUERY SELECT v_advance, v_expense;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_vehicle_insurance_payment_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_advance UUID;
  v_expense UUID;
  v_payment RECORD;
  v_entry UUID;
  v_branch UUID;
BEGIN
  SELECT branch_id INTO v_branch FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Vehicle branch is required for insurance accounting'; END IF;
  IF NEW.paid_by_ledger_id IS NULL THEN RAISE EXCEPTION 'Select the cash or bank account used to pay vehicle insurance'; END IF;
  SELECT * INTO v_payment FROM public.ledger_accounts
  WHERE id = NEW.paid_by_ledger_id AND branch_id = v_branch AND is_active AND ledger_type IN ('cash', 'bank');
  IF NOT FOUND THEN RAISE EXCEPTION 'Insurance payment account must be an active cash or bank account from the vehicle branch'; END IF;
  SELECT advance_id, expense_id INTO v_advance, v_expense
  FROM public.tms_require_vehicle_coverage_mapping(v_branch, 'insurance');

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (NEW.start_date, v_branch, 'Vehicle insurance paid in advance', 'vehicle_insurance_payment:' || NEW.id, 'auto', 'approved', now())
  RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, v_branch, v_advance, 'ledger', 'Vehicle insurance advance', round(NEW.total_amount, 2), 0),
    (v_entry, 2, v_branch, v_payment.id, v_payment.account_kind, 'Vehicle insurance paid from ' || v_payment.account_name, 0, round(NEW.total_amount, 2));
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_vehicle_road_tax_payment_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_advance UUID;
  v_expense UUID;
  v_payment RECORD;
  v_entry UUID;
  v_branch UUID;
BEGIN
  SELECT branch_id INTO v_branch FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Vehicle branch is required for road-tax accounting'; END IF;
  IF NEW.paid_by_ledger_id IS NULL THEN RAISE EXCEPTION 'Select the cash or bank account used to pay road tax'; END IF;
  SELECT * INTO v_payment FROM public.ledger_accounts
  WHERE id = NEW.paid_by_ledger_id AND branch_id = v_branch AND is_active AND ledger_type IN ('cash', 'bank');
  IF NOT FOUND THEN RAISE EXCEPTION 'Road-tax payment account must be an active cash or bank account from the vehicle branch'; END IF;
  SELECT advance_id, expense_id INTO v_advance, v_expense
  FROM public.tms_require_vehicle_coverage_mapping(v_branch, 'road_tax');

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (NEW.start_date, v_branch, 'Vehicle road tax paid in advance', 'vehicle_road_tax_payment:' || NEW.id, 'auto', 'approved', now())
  RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, v_branch, v_advance, 'ledger', 'Vehicle road-tax advance', round(NEW.total_amount, 2), 0),
    (v_entry, 2, v_branch, v_payment.id, v_payment.account_kind, 'Vehicle road tax paid from ' || v_payment.account_name, 0, round(NEW.total_amount, 2));
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_vehicle_coverage_expense_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_advance UUID;
  v_expense UUID;
  v_kind TEXT;
  v_entry UUID;
  v_amount NUMERIC(14,2);
BEGIN
  IF NEW.is_insurance THEN v_kind := 'insurance';
  ELSIF NEW.is_road_tax THEN v_kind := 'road_tax';
  ELSE RETURN NEW;
  END IF;
  IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'Vehicle coverage expense requires a branch'; END IF;
  v_amount := round(nullif(trim(coalesce(NEW.amount, '')), '')::numeric, 2);
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Vehicle coverage expense amount must be greater than zero'; END IF;
  SELECT advance_id, expense_id INTO v_advance, v_expense
  FROM public.tms_require_vehicle_coverage_mapping(NEW.branch_id, v_kind);

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (
    nullif(trim(NEW.entry_date), '')::date, NEW.branch_id,
    CASE WHEN v_kind = 'insurance' THEN 'Vehicle insurance expense' ELSE 'Vehicle road-tax expense' END,
    'vehicle_' || v_kind || '_expense:' || NEW.id, 'auto', 'approved', now()
  ) RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, NEW.branch_id, v_expense, 'ledger', initcap(replace(v_kind, '_', ' ')) || ' expense', v_amount, 0),
    (v_entry, 2, NEW.branch_id, v_advance, 'ledger', initcap(replace(v_kind, '_', ' ')) || ' advance released', 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_vehicle_coverage_journal_deleted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'vehicle_insurance' THEN
    DELETE FROM public.journal_entries WHERE reference = 'vehicle_insurance_payment:' || OLD.id AND source_module = 'auto';
  ELSIF TG_TABLE_NAME = 'vehicle_road_tax' THEN
    DELETE FROM public.journal_entries WHERE reference = 'vehicle_road_tax_payment:' || OLD.id AND source_module = 'auto';
  ELSIF TG_TABLE_NAME = 'expenditures' THEN
    DELETE FROM public.journal_entries
    WHERE (reference = 'vehicle_insurance_expense:' || OLD.id OR reference = 'vehicle_road_tax_expense:' || OLD.id)
      AND source_module = 'auto';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_insurance_payment_accounting ON public.vehicle_insurance;
CREATE TRIGGER vehicle_insurance_payment_accounting AFTER INSERT ON public.vehicle_insurance
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_insurance_payment_created();
DROP TRIGGER IF EXISTS vehicle_road_tax_payment_accounting ON public.vehicle_road_tax;
CREATE TRIGGER vehicle_road_tax_payment_accounting AFTER INSERT ON public.vehicle_road_tax
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_road_tax_payment_created();
DROP TRIGGER IF EXISTS vehicle_coverage_expense_accounting ON public.expenditures;
CREATE TRIGGER vehicle_coverage_expense_accounting AFTER INSERT ON public.expenditures
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_coverage_expense_created();
DROP TRIGGER IF EXISTS vehicle_insurance_payment_journal_deleted ON public.vehicle_insurance;
CREATE TRIGGER vehicle_insurance_payment_journal_deleted AFTER DELETE ON public.vehicle_insurance
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_coverage_journal_deleted();
DROP TRIGGER IF EXISTS vehicle_road_tax_payment_journal_deleted ON public.vehicle_road_tax;
CREATE TRIGGER vehicle_road_tax_payment_journal_deleted AFTER DELETE ON public.vehicle_road_tax
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_coverage_journal_deleted();
DROP TRIGGER IF EXISTS vehicle_coverage_expense_journal_deleted ON public.expenditures;
CREATE TRIGGER vehicle_coverage_expense_journal_deleted AFTER DELETE ON public.expenditures
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_coverage_journal_deleted();

COMMIT;
