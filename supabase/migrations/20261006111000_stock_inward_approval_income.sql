BEGIN;

ALTER TABLE public.stock_inward_receipts
  ADD COLUMN IF NOT EXISTS approval_income_payment_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_income_journal_entry_id UUID
    REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approval_income_by UUID
    REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_income_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS stock_inward_approval_income_journal_unique
  ON public.stock_inward_receipts(approval_income_journal_entry_id)
  WHERE approval_income_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_inward_approval_income_pending_idx
  ON public.stock_inward_receipts(branch_id, unloading_date DESC)
  WHERE approval_amount > 0
    AND additional_income_mode IN ('approval', 'both')
    AND approval_income_journal_entry_id IS NULL;

CREATE OR REPLACE FUNCTION public.prevent_posted_stock_inward_unloading_receipt_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.unloading_received_journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'A Stock Inward receipt with a posted unloading receipt cannot be deleted';
    END IF;
    IF OLD.approval_income_journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'A Stock Inward receipt with posted Approval Income cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.unloading_received_journal_entry_id IS NOT NULL
     AND (
       NEW.unloading_amount_received IS DISTINCT FROM OLD.unloading_amount_received
       OR NEW.unloading_received_payment_ledger_id IS DISTINCT FROM OLD.unloading_received_payment_ledger_id
       OR NEW.unloading_received_journal_entry_id IS DISTINCT FROM OLD.unloading_received_journal_entry_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     ) THEN
    RAISE EXCEPTION 'A posted unloading receipt is locked; reverse it through accounting before changing it';
  END IF;

  IF OLD.approval_income_journal_entry_id IS NOT NULL
     AND (
       NEW.approval_amount IS DISTINCT FROM OLD.approval_amount
       OR NEW.additional_income_mode IS DISTINCT FROM OLD.additional_income_mode
       OR NEW.approval_income_payment_ledger_id IS DISTINCT FROM OLD.approval_income_payment_ledger_id
       OR NEW.approval_income_journal_entry_id IS DISTINCT FROM OLD.approval_income_journal_entry_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     ) THEN
    RAISE EXCEPTION 'Posted Approval Income is locked; reverse it through accounting before changing it';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_stock_inward_approval_income(
  p_receipt_id UUID,
  p_payment_ledger_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.stock_inward_receipts%ROWTYPE;
  v_payment public.ledger_accounts%ROWTYPE;
  v_income_account public.ledger_accounts%ROWTYPE;
  v_income_ledger_id UUID;
  v_journal_id UUID;
  v_amount NUMERIC(14,2);
  v_reference TEXT;
BEGIN
  SELECT * INTO v_receipt
  FROM public.stock_inward_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock Inward receipt not found'; END IF;
  IF coalesce(v_receipt.approval_amount, 0) <= 0
     OR v_receipt.additional_income_mode NOT IN ('approval', 'both') THEN
    RAISE EXCEPTION 'This receipt has no positive Approval Amount to post';
  END IF;
  IF v_receipt.approval_income_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This Stock Inward Approval Income has already been posted';
  END IF;
  IF v_receipt.branch_id IS NULL THEN
    RAISE EXCEPTION 'Stock Inward receipt branch is required before posting';
  END IF;

  SELECT * INTO v_payment
  FROM public.ledger_accounts
  WHERE id = p_payment_ledger_id
    AND branch_id = v_receipt.branch_id
    AND is_active
    AND ledger_type IN ('cash', 'bank');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an active Cash or Bank account from this receipt branch';
  END IF;

  SELECT m.approval_charge_income_ledger_id
  INTO v_income_ledger_id
  FROM public.tms_account_ledger_mappings m
  WHERE m.branch_id = v_receipt.branch_id;
  IF v_income_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map the branch Approval Charge Income account before posting';
  END IF;

  SELECT * INTO v_income_account
  FROM public.ledger_accounts
  WHERE id = v_income_ledger_id
    AND branch_id = v_receipt.branch_id
    AND is_active
    AND ledger_type = 'income';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The mapped Approval Charge Income account is not an active income account for this branch';
  END IF;

  v_amount := round(v_receipt.approval_amount, 2);
  v_reference := 'stock_inward_approval_income:' || v_receipt.id::TEXT;
  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at, created_by
  ) VALUES (
    coalesce(v_receipt.unloading_date, v_receipt.receipt_date, current_date),
    v_receipt.branch_id,
    'Stock Inward Approval Income - ' || coalesce(v_receipt.receipt_number, v_receipt.id::TEXT),
    v_reference,
    'ltms', 'approved', now(), p_created_by
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) VALUES
    (
      v_journal_id, 1, v_receipt.branch_id, v_payment.id, v_payment.account_kind,
      'Cash/Bank received - ' || coalesce(v_receipt.receipt_number, v_receipt.id::TEXT),
      v_amount, 0
    ),
    (
      v_journal_id, 2, v_receipt.branch_id, v_income_account.id, v_income_account.account_kind,
      'Approval Charge income - ' || coalesce(v_receipt.receipt_number, v_receipt.id::TEXT),
      0, v_amount
    );

  PERFORM public.validate_journal_entry(v_journal_id);

  UPDATE public.stock_inward_receipts
  SET approval_income_payment_ledger_id = p_payment_ledger_id,
      approval_income_journal_entry_id = v_journal_id,
      approval_income_by = p_created_by,
      approval_income_at = now()
  WHERE id = v_receipt.id;

  RETURN v_journal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_stock_inward_approval_income(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_inward_approval_income(UUID, UUID, UUID)
  TO service_role;

COMMIT;
