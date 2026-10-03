BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS freight_income_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loading_income_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.validate_contract_source_billing_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_asset_ledger_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = NEW.source_asset_ledger_id AND branch_id = NEW.branch_id AND ledger_type = 'asset' AND is_active
  ) THEN
    RAISE EXCEPTION 'Source Account must be an active asset account from the selected branch';
  END IF;
  IF NEW.freight_income_ledger_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = NEW.freight_income_ledger_id AND branch_id = NEW.branch_id AND ledger_type = 'income' AND is_active
  ) THEN
    RAISE EXCEPTION 'Freight Account must be an active income account from the selected branch';
  END IF;
  IF NEW.loading_income_ledger_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = NEW.loading_income_ledger_id AND branch_id = NEW.branch_id AND ledger_type = 'income' AND is_active
  ) THEN
    RAISE EXCEPTION 'Loading Account must be an active income account from the selected branch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS contracts_validate_source_billing_accounts ON public.contracts;
CREATE TRIGGER contracts_validate_source_billing_accounts
  BEFORE INSERT OR UPDATE OF branch_id, freight_income_ledger_id, loading_income_ledger_id
  ON public.contracts FOR EACH ROW
  EXECUTE FUNCTION public.validate_contract_source_billing_accounts();

ALTER TABLE public.ltms_source_bills
  ADD COLUMN IF NOT EXISTS source_company_name TEXT,
  ADD COLUMN IF NOT EXISTS source_legal_business_name TEXT,
  ADD COLUMN IF NOT EXISTS source_gstin TEXT,
  ADD COLUMN IF NOT EXISTS source_address TEXT,
  ADD COLUMN IF NOT EXISTS source_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS source_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS source_city TEXT,
  ADD COLUMN IF NOT EXISTS source_state TEXT,
  ADD COLUMN IF NOT EXISTS source_country TEXT,
  ADD COLUMN IF NOT EXISTS source_pin_code TEXT,
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.prevent_ltms_source_bill_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.bill_number IS DISTINCT FROM OLD.bill_number
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.bill_date IS DISTINCT FROM OLD.bill_date
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.period_from IS DISTINCT FROM OLD.period_from
     OR NEW.period_to IS DISTINCT FROM OLD.period_to
     OR NEW.total_freight IS DISTINCT FROM OLD.total_freight
     OR NEW.total_loading IS DISTINCT FROM OLD.total_loading
     OR NEW.source_company_name IS DISTINCT FROM OLD.source_company_name
     OR NEW.source_legal_business_name IS DISTINCT FROM OLD.source_legal_business_name
     OR NEW.source_gstin IS DISTINCT FROM OLD.source_gstin
     OR NEW.source_address IS DISTINCT FROM OLD.source_address
     OR NEW.source_address_line1 IS DISTINCT FROM OLD.source_address_line1
     OR NEW.source_address_line2 IS DISTINCT FROM OLD.source_address_line2
     OR NEW.source_city IS DISTINCT FROM OLD.source_city
     OR NEW.source_state IS DISTINCT FROM OLD.source_state
     OR NEW.source_country IS DISTINCT FROM OLD.source_country
     OR NEW.source_pin_code IS DISTINCT FROM OLD.source_pin_code
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN
    RAISE EXCEPTION 'Generated source bills are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_source_bill_mutation ON public.ltms_source_bills;
CREATE TRIGGER prevent_source_bill_mutation
  BEFORE UPDATE ON public.ltms_source_bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ltms_source_bill_mutation();

-- A source bill prevents deletion only. Source, transporter source, package type and other
-- operational data remain editable; the Source Report shows the source-billed indicator.
CREATE OR REPLACE FUNCTION public.prevent_ltms_billed_consignment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.source_bill_id IS NOT NULL
     OR OLD.transporter_bill_id IS NOT NULL
     OR OLD.billing_status IN ('billed', 'billed_and_paid') THEN
    RAISE EXCEPTION 'A billed consignment cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS prevent_billed_consignment_mutation ON public.consignments;
DROP TRIGGER IF EXISTS prevent_ltms_billed_consignment_mutation ON public.consignments;
CREATE TRIGGER prevent_ltms_billed_consignment_delete
  BEFORE DELETE ON public.consignments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ltms_billed_consignment_delete();

CREATE OR REPLACE FUNCTION public.generate_ltms_source_bill(
  p_branch_id UUID,
  p_source_id UUID,
  p_bill_date DATE,
  p_due_date DATE,
  p_period_from DATE,
  p_period_to DATE,
  p_items JSONB,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_id UUID;
  v_item JSONB;
  v_consign public.consignments%ROWTYPE;
  v_source public.contracts%ROWTYPE;
  v_journal UUID;
  v_freight NUMERIC(14,2) := 0;
  v_loading NUMERIC(14,2) := 0;
BEGIN
  SELECT * INTO v_source FROM public.contracts WHERE id = p_source_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source does not belong to the selected branch'; END IF;
  IF v_source.source_asset_ledger_id IS NULL OR v_source.freight_income_ledger_id IS NULL OR v_source.loading_income_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map Source Account, Freight Account and Loading Account in the source master before generating a bill';
  END IF;
  IF p_bill_date IS NULL OR p_due_date IS NULL OR p_period_from IS NULL OR p_period_to IS NULL
     OR p_period_from > p_period_to OR p_bill_date < p_period_from OR p_due_date < p_bill_date THEN
    RAISE EXCEPTION 'Invalid bill dates';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN RAISE EXCEPTION 'Select at least one consignment'; END IF;

  INSERT INTO public.ltms_source_bills (
    branch_id, source_id, bill_date, due_date, period_from, period_to,
    source_company_name, source_legal_business_name, source_gstin, source_address,
    source_address_line1, source_address_line2, source_city, source_state, source_country, source_pin_code,
    total_freight, total_loading, created_by
  ) VALUES (
    p_branch_id, p_source_id, p_bill_date, p_due_date, p_period_from, p_period_to,
    v_source.company_name, v_source.legal_business_name, v_source.gstin,
    concat_ws(', ', nullif(v_source.address_line1, ''), nullif(v_source.address_line2, ''), nullif(v_source.city, ''), nullif(v_source.state, ''), nullif(v_source.country, ''), nullif(v_source.pin_code, '')),
    v_source.address_line1, v_source.address_line2, v_source.city, v_source.state, v_source.country, v_source.pin_code,
    0, 0, p_created_by
  ) RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_consign FROM public.consignments
    WHERE id = NULLIF(v_item->>'consignment_id', '')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected consignment was not found'; END IF;
    IF v_consign.branch_id IS DISTINCT FROM p_branch_id OR v_consign.source_id IS DISTINCT FROM p_source_id THEN
      RAISE EXCEPTION 'Selected consignments must use the chosen branch and source';
    END IF;
    IF v_consign.consignment_date IS NULL OR v_consign.consignment_date < p_period_from OR v_consign.consignment_date > p_period_to THEN
      RAISE EXCEPTION 'Selected consignment is outside the billing period';
    END IF;
    IF v_consign.source_bill_id IS NOT NULL THEN RAISE EXCEPTION 'A selected consignment has already been source billed'; END IF;

    INSERT INTO public.ltms_source_bill_items (
      bill_id, consignment_id, consignment_number, consignment_date, from_pin_code, to_pin_code,
      calculated_freight, freight_deduction, additional_freight, final_freight,
      calculated_loading, loading_deduction, additional_loading, final_loading
    ) VALUES (
      v_bill_id, v_consign.id, v_consign.consignment_number, v_consign.consignment_date,
      coalesce(v_item->>'from_pin_code', v_consign.from_pin_code, ''), coalesce(v_item->>'to_pin_code', v_consign.to_pin_code, ''),
      round(coalesce(NULLIF(v_item->>'calculated_freight', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'freight_deduction', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'additional_freight', '')::NUMERIC, 0), 2),
      round(greatest(0, coalesce(NULLIF(v_item->>'final_freight', '')::NUMERIC, 0)), 2),
      round(coalesce(NULLIF(v_item->>'calculated_loading', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'loading_deduction', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'additional_loading', '')::NUMERIC, 0), 2),
      round(greatest(0, coalesce(NULLIF(v_item->>'final_loading', '')::NUMERIC, 0)), 2)
    );
    v_freight := v_freight + greatest(0, coalesce(NULLIF(v_item->>'final_freight', '')::NUMERIC, 0));
    v_loading := v_loading + greatest(0, coalesce(NULLIF(v_item->>'final_loading', '')::NUMERIC, 0));
    UPDATE public.consignments SET source_bill_id = v_bill_id, source_billed_at = now(), billing_status = 'billed' WHERE id = v_consign.id;
  END LOOP;

  UPDATE public.ltms_source_bills SET total_freight = round(v_freight, 2), total_loading = round(v_loading, 2) WHERE id = v_bill_id;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (p_bill_date, p_branch_id, 'Source bill ' || (SELECT bill_number FROM public.ltms_source_bills WHERE id = v_bill_id), 'ltms_source_bill:' || v_bill_id, 'ltms', 'approved', now())
  RETURNING id INTO v_journal;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_journal, 1, p_branch_id, v_source.source_asset_ledger_id, 'ledger', 'Source account - source bill', round(v_freight + v_loading, 2), 0),
    (v_journal, 2, p_branch_id, v_source.freight_income_ledger_id, 'ledger', 'Freight income - source bill', 0, round(v_freight, 2)),
    (v_journal, 3, p_branch_id, v_source.loading_income_ledger_id, 'ledger', 'Loading income - source bill', 0, round(v_loading, 2));
  PERFORM public.validate_journal_entry(v_journal);
  UPDATE public.ltms_source_bills SET journal_entry_id = v_journal WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE reference = 'ltms_source_bill:' || v_bill_id;
    DELETE FROM public.ltms_source_bill_items WHERE bill_id = v_bill_id;
    UPDATE public.consignments SET source_bill_id = NULL, source_billed_at = NULL, billing_status = 'to_be_billed' WHERE source_bill_id = v_bill_id;
    DELETE FROM public.ltms_source_bills WHERE id = v_bill_id;
  END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_ltms_source_bill(p_bill_id UUID, p_deleted_by UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_journal UUID;
BEGIN
  SELECT journal_entry_id INTO v_journal FROM public.ltms_source_bills WHERE id = p_bill_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source bill was not found or already deleted'; END IF;
  DELETE FROM public.journal_entries WHERE id = v_journal OR reference = 'ltms_source_bill:' || p_bill_id;
  UPDATE public.consignments SET source_bill_id = NULL, source_billed_at = NULL, billing_status = 'to_be_billed' WHERE source_bill_id = p_bill_id;
  DELETE FROM public.ltms_source_bill_items WHERE bill_id = p_bill_id;
  UPDATE public.ltms_source_bills SET deleted_at = now(), deleted_by = coalesce(p_deleted_by, deleted_by), journal_entry_id = NULL WHERE id = p_bill_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_ltms_consignment_values(
  p_branch_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_kind TEXT,
  p_current_id UUID,
  p_replacement_id UUID,
  p_consignment_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count INTEGER := 0; v_item RECORD; v_package RECORD;
BEGIN
  IF p_branch_id IS NULL OR p_current_id IS NULL OR p_replacement_id IS NULL OR coalesce(array_length(p_consignment_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Branch, current value, replacement value and selected consignments are required';
  END IF;
  IF p_kind = 'source' THEN
    UPDATE public.consignments SET source_id = p_replacement_id
    WHERE id = ANY(p_consignment_ids) AND branch_id = p_branch_id AND source_id = p_current_id AND consignment_date BETWEEN p_from_date AND p_to_date;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_kind = 'transporter_source' THEN
    UPDATE public.consignments SET transporter_source_id = p_replacement_id
    WHERE id = ANY(p_consignment_ids) AND branch_id = p_branch_id AND transporter_source_id = p_current_id AND consignment_date BETWEEN p_from_date AND p_to_date;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_kind = 'package_type' THEN
    FOR v_package IN SELECT p.id FROM public.consignment_package_information p WHERE p.consignment_id = ANY(p_consignment_ids) AND p.package_rate_type_id = p_current_id LOOP
      UPDATE public.consignment_package_information q
      SET package_rate_type_id = r.id, package_type = r.package_type, basis = r.basis
      FROM public.package_rate_types r
      WHERE q.id = v_package.id AND r.id = p_replacement_id AND r.branch_id = p_branch_id;
      v_count := v_count + 1;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unsupported replacement kind';
  END IF;
  IF v_count = 0 THEN RAISE EXCEPTION 'No selected records matched the current value and date range'; END IF;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_ltms_source_bill(UUID, UUID, DATE, DATE, DATE, DATE, JSONB, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_ltms_source_bill(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_ltms_consignment_values(UUID, DATE, DATE, TEXT, UUID, UUID, UUID[]) TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.contracts TO anon, authenticated;

COMMIT;
