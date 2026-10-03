BEGIN;

-- Generated transporter bills are immutable. Calculate totals from the submitted
-- items before the initial INSERT so generation never needs to UPDATE those totals.
CREATE OR REPLACE FUNCTION public.generate_ltms_transporter_bill(
  p_branch_id UUID,
  p_transporter_id UUID,
  p_transporter_source_id UUID,
  p_system_date DATE,
  p_transporter_bill_number TEXT,
  p_transporter_bill_date DATE,
  p_period_from DATE DEFAULT NULL,
  p_period_to DATE DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
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
  v_source public.ltms_transporter_sources%ROWTYPE;
  v_journal UUID;
  v_freight NUMERIC(14, 2) := 0;
  v_loading NUMERIC(14, 2) := 0;
  v_freight_kind TEXT;
  v_loading_kind TEXT;
  v_source_kind TEXT;
BEGIN
  SELECT * INTO v_source
  FROM public.ltms_transporter_sources
  WHERE id = p_transporter_source_id
    AND transporter_id = p_transporter_id
    AND branch_id = p_branch_id
    AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected transporter source does not belong to the selected transporter and branch'; END IF;
  IF v_source.liability_ledger_id IS NULL OR v_source.freight_expenditure_ledger_id IS NULL OR v_source.loading_expenditure_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map Transporter source, Freight expenditure and Loading expenditure accounts before generating a bill';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.liability_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'liability')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.freight_expenditure_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.loading_expenditure_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure') THEN
    RAISE EXCEPTION 'Transporter source, Freight and Loading accounts must be active accounts from the selected branch with Liability/Expenditure ledger types';
  END IF;
  IF nullif(trim(p_transporter_bill_number), '') IS NULL OR p_transporter_bill_date IS NULL THEN
    RAISE EXCEPTION 'Transporter bill number and bill date are required';
  END IF;
  IF (p_period_from IS NULL) <> (p_period_to IS NULL) OR p_period_from > p_period_to THEN
    RAISE EXCEPTION 'Both duration dates are required and From Date cannot be after To Date';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN RAISE EXCEPTION 'Select at least one consignment'; END IF;

  -- Compute immutable bill totals before inserting the bill. Updating totals after
  -- insertion would correctly be rejected by the generated-bill immutability trigger.
  SELECT
    coalesce(sum(greatest(0, coalesce(NULLIF(item.value->>'final_freight', '')::NUMERIC, 0))), 0),
    coalesce(sum(greatest(0, coalesce(NULLIF(item.value->>'final_loading', '')::NUMERIC, 0))), 0)
  INTO v_freight, v_loading
  FROM jsonb_array_elements(coalesce(p_items, '[]'::JSONB)) AS item(value);

  SELECT account_kind INTO v_source_kind FROM public.ledger_accounts WHERE id = v_source.liability_ledger_id;
  SELECT account_kind INTO v_freight_kind FROM public.ledger_accounts WHERE id = v_source.freight_expenditure_ledger_id;
  SELECT account_kind INTO v_loading_kind FROM public.ledger_accounts WHERE id = v_source.loading_expenditure_ledger_id;

  INSERT INTO public.ltms_transporter_bills (
    branch_id, transporter_id, transporter_source_id, system_date,
    transporter_bill_number, transporter_bill_date, period_from, period_to,
    total_freight, total_loading, created_by
  ) VALUES (
    p_branch_id, p_transporter_id, p_transporter_source_id, coalesce(p_system_date, current_date),
    trim(p_transporter_bill_number), p_transporter_bill_date, p_period_from, p_period_to, round(v_freight, 2), round(v_loading, 2), p_created_by
  ) RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_consign FROM public.consignments
    WHERE id = NULLIF(v_item->>'consignment_id', '')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected consignment was not found'; END IF;
    IF v_consign.branch_id IS DISTINCT FROM p_branch_id OR v_consign.transporter_id IS DISTINCT FROM p_transporter_id OR v_consign.transporter_source_id IS DISTINCT FROM p_transporter_source_id THEN
      RAISE EXCEPTION 'Selected consignments must use the chosen branch, transporter and transporter source';
    END IF;
    IF v_consign.transporter_bill_id IS NOT NULL THEN RAISE EXCEPTION 'A selected consignment has already been transporter billed'; END IF;
    IF p_period_from IS NOT NULL AND (v_consign.consignment_date < p_period_from OR v_consign.consignment_date > p_period_to) THEN
      RAISE EXCEPTION 'Selected consignment is outside the transporter billing duration';
    END IF;

    INSERT INTO public.ltms_transporter_bill_items (
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
    UPDATE public.consignments SET transporter_bill_id = v_bill_id WHERE id = v_consign.id;
  END LOOP;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (p_transporter_bill_date, p_branch_id, 'Transporter bill ' || (SELECT transporter_bill_number FROM public.ltms_transporter_bills WHERE id = v_bill_id), 'ltms_transporter_bill:' || v_bill_id, 'ltms', 'approved', now())
  RETURNING id INTO v_journal;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_journal, 1, p_branch_id, v_source.freight_expenditure_ledger_id, v_freight_kind, 'Freight expenditure - transporter bill', round(v_freight, 2), 0),
    (v_journal, 2, p_branch_id, v_source.loading_expenditure_ledger_id, v_loading_kind, 'Loading expenditure - transporter bill', round(v_loading, 2), 0),
    (v_journal, 3, p_branch_id, v_source.liability_ledger_id, v_source_kind, 'Transporter source payable - transporter bill', 0, round(v_freight + v_loading, 2));
  PERFORM public.validate_journal_entry(v_journal);
  UPDATE public.ltms_transporter_bills SET journal_entry_id = v_journal WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE reference = 'ltms_transporter_bill:' || v_bill_id;
    DELETE FROM public.ltms_transporter_bill_items WHERE bill_id = v_bill_id;
    UPDATE public.consignments SET transporter_bill_id = NULL WHERE transporter_bill_id = v_bill_id;
    DELETE FROM public.ltms_transporter_bills WHERE id = v_bill_id;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_ltms_transporter_bill(UUID, UUID, UUID, DATE, TEXT, DATE, DATE, DATE, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_ltms_transporter_bill(UUID, UUID, UUID, DATE, TEXT, DATE, DATE, DATE, UUID, JSONB) TO anon, authenticated, service_role;

COMMIT;
