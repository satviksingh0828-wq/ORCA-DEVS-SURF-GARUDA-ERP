BEGIN;

ALTER TABLE public.ltms_source_bill_stock_inward_items
  ADD COLUMN IF NOT EXISTS calculated_source_income NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS source_income_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_source_income NUMERIC(14,2) NOT NULL DEFAULT 0;

UPDATE public.ltms_source_bill_stock_inward_items
SET calculated_source_income = source_income_amount
WHERE calculated_source_income IS NULL;

ALTER TABLE public.ltms_source_bill_stock_inward_items
  ALTER COLUMN calculated_source_income SET DEFAULT 0,
  ALTER COLUMN calculated_source_income SET NOT NULL,
  DROP CONSTRAINT IF EXISTS ltms_source_bill_stock_inward_items_source_income_amount_check,
  DROP CONSTRAINT IF EXISTS ltms_source_bill_stock_inward_items_source_income_amount_nonnegative_check,
  ADD CONSTRAINT ltms_source_bill_stock_inward_items_source_income_amount_nonnegative_check
    CHECK (source_income_amount >= 0);

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
  v_receipt public.stock_inward_receipts%ROWTYPE;
  v_source public.contracts%ROWTYPE;
  v_journal UUID;
  v_freight NUMERIC(14,2) := 0;
  v_loading NUMERIC(14,2) := 0;
  v_unloading_income NUMERIC(14,2) := 0;
  v_receipt_income NUMERIC(14,2) := 0;
  v_receipt_deduction NUMERIC(14,2) := 0;
  v_receipt_addition NUMERIC(14,2) := 0;
  v_final_receipt_income NUMERIC(14,2) := 0;
  v_line_no INTEGER := 1;
  v_source_kind TEXT;
  v_freight_kind TEXT;
  v_loading_kind TEXT;
  v_unloading_kind TEXT;
BEGIN
  SELECT * INTO v_source FROM public.contracts WHERE id = p_source_id AND branch_id = p_branch_id FOR SHARE;
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
  IF jsonb_typeof(coalesce(p_items, '[]'::JSONB)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Billing items must be supplied as a JSON array';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN
    RAISE EXCEPTION 'Select at least one consignment or Stock Inward source-income entry';
  END IF;

  INSERT INTO public.ltms_source_bills (
    branch_id, source_id, bill_date, due_date, period_from, period_to,
    source_company_name, source_legal_business_name, source_gstin, source_address,
    source_address_line1, source_address_line2, source_city, source_state, source_country, source_pin_code,
    total_freight, total_loading, total_unloading_income, created_by
  ) VALUES (
    p_branch_id, p_source_id, p_bill_date, p_due_date, p_period_from, p_period_to,
    v_source.company_name, v_source.legal_business_name, v_source.gstin,
    concat_ws(', ', nullif(v_source.address_line1, ''), nullif(v_source.address_line2, ''), nullif(v_source.city, ''), nullif(v_source.state, ''), nullif(v_source.country, ''), nullif(v_source.pin_code, '')),
    v_source.address_line1, v_source.address_line2, v_source.city, v_source.state, v_source.country, v_source.pin_code,
    0, 0, 0, p_created_by
  ) RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF NULLIF(v_item->>'stock_inward_receipt_id', '') IS NOT NULL THEN
      IF NULLIF(v_item->>'consignment_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'A billing line cannot reference both a consignment and a Stock Inward receipt';
      END IF;
      SELECT * INTO v_receipt
      FROM public.stock_inward_receipts
      WHERE id = NULLIF(v_item->>'stock_inward_receipt_id', '')::UUID
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A selected Stock Inward receipt was not found'; END IF;
      IF v_receipt.branch_id IS DISTINCT FROM p_branch_id THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt must belong to the chosen branch';
      END IF;
      IF v_receipt.receipt_date < p_period_from OR v_receipt.receipt_date > p_period_to THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt is outside the billing period';
      END IF;
      IF v_receipt.additional_income_mode NOT IN ('source', 'both') THEN
        RAISE EXCEPTION 'Only Stock Inward entries with Additional Income Type Source or Both can be billed as source income';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.stock_inward_sources s
        WHERE s.receipt_id = v_receipt.id AND s.source_id = p_source_id
      ) THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt is not linked to the selected source';
      END IF;
      PERFORM 1 FROM public.stock_inward_sources s
      WHERE s.receipt_id = v_receipt.id AND s.source_id = p_source_id
      FOR SHARE;
      PERFORM 1 FROM public.stock_inward_packages p
      WHERE p.receipt_id = v_receipt.id AND p.source_id = p_source_id
      FOR SHARE;
      IF EXISTS (
        SELECT 1 FROM public.ltms_source_bill_stock_inward_items i
        WHERE i.stock_inward_receipt_id = v_receipt.id AND i.source_id = p_source_id
      ) THEN
        RAISE EXCEPTION 'This Stock Inward source-income entry has already been billed';
      END IF;

      SELECT round(coalesce(sum(
        CASE
          WHEN t.charge_mode = 'rate' THEN coalesce(slab.amount, 0) *
            CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
          ELSE coalesce(slab.amount, 0)
        END
      ), 0), 2)
      INTO v_receipt_income
      FROM public.stock_inward_packages p
      JOIN public.package_rate_types t ON t.id = p.package_rate_type_id
      LEFT JOIN LATERAL (
        SELECT e.amount
        FROM public.package_rate_entries e
        WHERE e.package_rate_type_id = p.package_rate_type_id
          AND e.rate_kind = 'unloading'
          AND e.from_value <= CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
          AND (e.to_value IS NULL OR CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END <= e.to_value)
        ORDER BY e.from_value DESC
        LIMIT 1
      ) slab ON true
      WHERE p.receipt_id = v_receipt.id AND p.source_id = p_source_id;

      IF v_receipt_income <= 0 THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt has no calculated unloading source income for this source';
      END IF;
      IF round(coalesce(NULLIF(v_item->>'calculated_source_income', '')::NUMERIC, 0), 2) IS DISTINCT FROM v_receipt_income THEN
        RAISE EXCEPTION 'Calculated Source Income changed after selection. Reload Stock Inward entries and try again';
      END IF;
      v_receipt_deduction := round(coalesce(NULLIF(v_item->>'source_income_deduction', '')::NUMERIC, 0), 2);
      v_receipt_addition := round(coalesce(NULLIF(v_item->>'additional_source_income', '')::NUMERIC, 0), 2);
      IF v_receipt_deduction < 0 OR v_receipt_addition < 0 THEN
        RAISE EXCEPTION 'Source-income additions and deductions cannot be negative';
      END IF;
      v_final_receipt_income := greatest(0, round(v_receipt_income - v_receipt_deduction + v_receipt_addition, 2));
      IF round(coalesce(NULLIF(v_item->>'source_income_amount', '')::NUMERIC, 0), 2) IS DISTINCT FROM v_final_receipt_income THEN
        RAISE EXCEPTION 'Adjusted Source Income changed after selection. Review the addition and deduction values and try again';
      END IF;
      IF v_source.unloading_income_ledger_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.ledger_accounts
        WHERE id = v_source.unloading_income_ledger_id
          AND branch_id = p_branch_id AND is_active AND ledger_type = 'income'
      ) THEN
        RAISE EXCEPTION 'Map an active Unloading Account (Income) for this source and branch before billing Stock Inward source income';
      END IF;

      INSERT INTO public.ltms_source_bill_stock_inward_items (
        bill_id, stock_inward_receipt_id, source_id, receipt_number, receipt_date,
        calculated_source_income, source_income_deduction, additional_source_income, source_income_amount
      ) VALUES (
        v_bill_id, v_receipt.id, p_source_id, coalesce(v_receipt.receipt_number, v_receipt.id::TEXT), v_receipt.receipt_date,
        v_receipt_income, v_receipt_deduction, v_receipt_addition, v_final_receipt_income
      );
      v_unloading_income := v_unloading_income + v_final_receipt_income;
    ELSE
      IF NULLIF(v_item->>'consignment_id', '') IS NULL THEN
        RAISE EXCEPTION 'Each billing line must reference a consignment or Stock Inward receipt';
      END IF;
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
      UPDATE public.consignments
      SET source_bill_id = v_bill_id, source_billed_at = now(), billing_status = 'billed'
      WHERE id = v_consign.id;
    END IF;
  END LOOP;

  UPDATE public.ltms_source_bills
  SET total_freight = round(v_freight, 2),
      total_loading = round(v_loading, 2),
      total_unloading_income = round(v_unloading_income, 2)
  WHERE id = v_bill_id;

  IF round(v_freight + v_loading + v_unloading_income, 2) <= 0 THEN
    RAISE EXCEPTION 'Source bill total must be greater than zero before posting the journal entry';
  END IF;
  IF v_unloading_income > 0 THEN
    SELECT account_kind INTO v_unloading_kind
    FROM public.ledger_accounts WHERE id = v_source.unloading_income_ledger_id;
  END IF;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (
    p_bill_date,
    p_branch_id,
    'Source bill ' || (SELECT bill_number FROM public.ltms_source_bills WHERE id = v_bill_id)
      || ' | Date: ' || p_bill_date::TEXT
      || ' | Freight: ' || round(v_freight, 2)::TEXT
      || ' | Loading: ' || round(v_loading, 2)::TEXT
      || ' | Unloading income: ' || round(v_unloading_income, 2)::TEXT,
    'ltms_source_bill:' || v_bill_id,
    'ltms',
    'approved',
    now()
  ) RETURNING id INTO v_journal;

  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES (
    v_journal, v_line_no, p_branch_id, v_source.source_asset_ledger_id, v_source_kind,
    'Source account - source bill', round(v_freight + v_loading + v_unloading_income, 2), 0
  );
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
  IF round(v_unloading_income, 2) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES (v_journal, v_line_no, p_branch_id, v_source.unloading_income_ledger_id, v_unloading_kind, 'Unloading income - Stock Inward source income', 0, round(v_unloading_income, 2));
  END IF;
  PERFORM public.validate_journal_entry(v_journal);
  UPDATE public.ltms_source_bills SET journal_entry_id = v_journal WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE reference = 'ltms_source_bill:' || v_bill_id;
    DELETE FROM public.ltms_source_bill_stock_inward_items WHERE bill_id = v_bill_id;
    DELETE FROM public.ltms_source_bill_items WHERE bill_id = v_bill_id;
    UPDATE public.consignments
    SET source_bill_id = NULL, source_billed_at = NULL, billing_status = 'to_be_billed'
    WHERE source_bill_id = v_bill_id;
    DELETE FROM public.ltms_source_bills WHERE id = v_bill_id;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_ltms_source_bill(UUID, UUID, DATE, DATE, DATE, DATE, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_ltms_source_bill(UUID, UUID, DATE, DATE, DATE, DATE, JSONB, UUID) TO anon, authenticated, service_role;

COMMIT;
