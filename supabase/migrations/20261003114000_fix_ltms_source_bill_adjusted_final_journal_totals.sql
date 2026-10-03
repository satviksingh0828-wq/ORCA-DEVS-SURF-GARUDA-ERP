BEGIN;

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
  v_line_no INTEGER := 1;
  v_source_kind TEXT;
  v_freight_kind TEXT;
  v_loading_kind TEXT;
BEGIN
  SELECT * INTO v_source FROM public.contracts WHERE id = p_source_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source does not belong to the selected branch'; END IF;
  IF v_source.source_asset_ledger_id IS NULL OR v_source.freight_income_ledger_id IS NULL OR v_source.loading_income_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map Source Account, Freight Account and Loading Account in the source master before generating a bill';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.source_asset_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'asset')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.freight_income_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'income')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.loading_income_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'income') THEN
    RAISE EXCEPTION 'Source, Freight and Loading accounts must be active accounts from the selected branch with Asset/Income ledger types';
  END IF;
  SELECT account_kind INTO v_source_kind FROM public.ledger_accounts WHERE id = v_source.source_asset_ledger_id;
  SELECT account_kind INTO v_freight_kind FROM public.ledger_accounts WHERE id = v_source.freight_income_ledger_id;
  SELECT account_kind INTO v_loading_kind FROM public.ledger_accounts WHERE id = v_source.loading_income_ledger_id;
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
    -- Journal and bill totals use the adjusted final amounts only.
    v_freight := v_freight + greatest(0, coalesce(NULLIF(v_item->>'final_freight', '')::NUMERIC, 0));
    v_loading := v_loading + greatest(0, coalesce(NULLIF(v_item->>'final_loading', '')::NUMERIC, 0));
    UPDATE public.consignments SET source_bill_id = v_bill_id, source_billed_at = now(), billing_status = 'billed' WHERE id = v_consign.id;
  END LOOP;

  UPDATE public.ltms_source_bills SET total_freight = round(v_freight, 2), total_loading = round(v_loading, 2) WHERE id = v_bill_id;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (p_bill_date, p_branch_id, 'Source bill ' || (SELECT bill_number FROM public.ltms_source_bills WHERE id = v_bill_id) || ' | Date: ' || p_bill_date::TEXT || ' | Freight: ' || round(v_freight, 2)::TEXT || ' | Loading: ' || round(v_loading, 2)::TEXT, 'ltms_source_bill:' || v_bill_id, 'ltms', 'approved', now())
  RETURNING id INTO v_journal;
  IF round(v_freight + v_loading, 2) <= 0 THEN
    RAISE EXCEPTION 'Adjusted final Freight and Loading total must be greater than zero before posting the journal entry';
  END IF;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES (v_journal, v_line_no, p_branch_id, v_source.source_asset_ledger_id, v_source_kind, 'Source account - source bill', round(v_freight + v_loading, 2), 0);
  IF round(v_freight, 2) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES (v_journal, v_line_no, p_branch_id, v_source.freight_income_ledger_id, v_freight_kind, 'Freight income - source bill', 0, round(v_freight, 2));
  END IF;
  IF round(v_loading, 2) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES (v_journal, v_line_no, p_branch_id, v_source.loading_income_ledger_id, v_loading_kind, 'Loading income - source bill', 0, round(v_loading, 2));
  END IF;
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

COMMIT;
