BEGIN;

ALTER TABLE public.ltms_source_bills
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by UUID,
  ADD COLUMN IF NOT EXISTS received_account_id UUID REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS received_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ltms_source_bills_received_idx
  ON public.ltms_source_bills(received_at)
  WHERE received_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.receive_ltms_source_bill(
  p_bill_id UUID,
  p_received_account_id UUID,
  p_received_by UUID DEFAULT NULL,
  p_received_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.ltms_source_bills%ROWTYPE;
  v_source public.contracts%ROWTYPE;
  v_account public.ledger_accounts%ROWTYPE;
  v_journal UUID;
  v_total NUMERIC(14,2);
  v_source_kind TEXT;
  v_account_kind TEXT;
BEGIN
  SELECT * INTO v_bill
  FROM public.ltms_source_bills
  WHERE id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND OR v_bill.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Source bill was not found or is deleted';
  END IF;
  IF v_bill.received_at IS NOT NULL OR v_bill.received_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This source bill has already been marked received';
  END IF;
  IF p_received_account_id IS NULL THEN
    RAISE EXCEPTION 'Select the cash or bank account in which the bill was received';
  END IF;
  IF p_received_date IS NULL THEN
    RAISE EXCEPTION 'Receipt date is required';
  END IF;

  v_total := round(coalesce(v_bill.total_freight, 0) + coalesce(v_bill.total_loading, 0) + coalesce(v_bill.total_unloading_income, 0), 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Source bill total must be greater than zero';
  END IF;

  SELECT * INTO v_source FROM public.contracts WHERE id = v_bill.source_id AND branch_id = v_bill.branch_id;
  IF NOT FOUND OR v_source.source_asset_ledger_id IS NULL THEN
    RAISE EXCEPTION 'The source receivable account is not mapped for this bill';
  END IF;
  SELECT * INTO v_account
  FROM public.ledger_accounts
  WHERE id = p_received_account_id
    AND branch_id = v_bill.branch_id
    AND is_active
    AND ledger_type IN ('bank', 'cash');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Received account must be an active cash or bank account from the bill branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_source.source_asset_ledger_id
      AND branch_id = v_bill.branch_id AND is_active AND ledger_type = 'asset'
  ) THEN
    RAISE EXCEPTION 'The source receivable account must be an active asset account from the bill branch';
  END IF;

  SELECT account_kind INTO v_source_kind FROM public.ledger_accounts WHERE id = v_source.source_asset_ledger_id;
  v_account_kind := v_account.account_kind;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (
    p_received_date,
    v_bill.branch_id,
    'Source bill received ' || v_bill.bill_number || ' | Account: ' || v_account.account_name || ' | Amount: ' || v_total::TEXT,
    'ltms_source_bill_received:' || p_bill_id,
    'ltms',
    'approved',
    now()
  )
  RETURNING id INTO v_journal;

  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_journal, 1, v_bill.branch_id, v_account.id, v_account_kind, 'Cash / bank received against source bill', v_total, 0),
    (v_journal, 2, v_bill.branch_id, v_source.source_asset_ledger_id, v_source_kind, 'Source receivable settled', 0, v_total);

  PERFORM public.validate_journal_entry(v_journal);

  UPDATE public.ltms_source_bills
  SET received_at = now(), received_by = p_received_by,
      received_account_id = p_received_account_id, received_journal_entry_id = v_journal
  WHERE id = p_bill_id;

  RETURN v_journal;
EXCEPTION WHEN OTHERS THEN
  IF v_journal IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE id = v_journal;
  END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_ltms_source_bill(p_bill_id UUID, p_deleted_by UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_journal UUID;
  v_received_journal UUID;
BEGIN
  SELECT journal_entry_id, received_journal_entry_id
    INTO v_journal, v_received_journal
  FROM public.ltms_source_bills
  WHERE id = p_bill_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source bill was not found or already deleted'; END IF;
  IF v_received_journal IS NOT NULL THEN
    RAISE EXCEPTION 'A received source bill cannot be deleted';
  END IF;
  DELETE FROM public.journal_entries WHERE id = v_journal OR reference = 'ltms_source_bill:' || p_bill_id;
  UPDATE public.consignments SET source_bill_id = NULL, source_billed_at = NULL, billing_status = 'to_be_billed' WHERE source_bill_id = p_bill_id;
  DELETE FROM public.ltms_source_bill_items WHERE bill_id = p_bill_id;
  DELETE FROM public.ltms_source_bill_stock_inward_items WHERE bill_id = p_bill_id;
  UPDATE public.ltms_source_bills SET deleted_at = now(), deleted_by = coalesce(p_deleted_by, deleted_by), journal_entry_id = NULL WHERE id = p_bill_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_ltms_source_bill(UUID, UUID, UUID, DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_ltms_source_bill(UUID, UUID) TO anon, authenticated, service_role;

COMMIT;
