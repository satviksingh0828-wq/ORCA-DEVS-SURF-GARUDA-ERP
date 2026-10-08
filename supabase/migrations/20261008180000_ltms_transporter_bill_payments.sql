BEGIN;

ALTER TABLE public.ltms_transporter_bills
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_account_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ltms_transporter_bills_paid_amount_check'
      AND conrelid = 'public.ltms_transporter_bills'::regclass
  ) THEN
    ALTER TABLE public.ltms_transporter_bills
      ADD CONSTRAINT ltms_transporter_bills_paid_amount_check
      CHECK (paid_amount >= 0 AND paid_amount <= total_freight + total_loading);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.ltms_transporter_bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.ltms_transporter_bills(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_ledger_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ltms_transporter_bill_payments_bill_idx
  ON public.ltms_transporter_bill_payments(bill_id, payment_date DESC, created_at DESC);

ALTER TABLE public.ltms_transporter_bill_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ltms_transporter_bill_payments_app ON public.ltms_transporter_bill_payments;
CREATE POLICY ltms_transporter_bill_payments_app ON public.ltms_transporter_bill_payments
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.ltms_transporter_bill_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ltms_transporter_bill_payments TO anon, authenticated;
GRANT ALL ON public.ltms_transporter_bill_payments TO service_role;

CREATE OR REPLACE FUNCTION public.validate_ltms_transporter_bill_payment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid_total NUMERIC(14,2);
  v_last_account UUID;
  v_bill_total NUMERIC(14,2);
BEGIN
  SELECT round(coalesce(sum(amount), 0), 2),
         (array_agg(payment_ledger_id ORDER BY created_at DESC, id DESC))[1]
    INTO v_paid_total, v_last_account
  FROM public.ltms_transporter_bill_payments
  WHERE bill_id = NEW.id;

  v_bill_total := round(coalesce(NEW.total_freight, 0) + coalesce(NEW.total_loading, 0), 2);
  IF round(coalesce(NEW.paid_amount, 0), 2) <> v_paid_total THEN
    RAISE EXCEPTION 'Transporter Bill paid amount must match its posted payment history';
  END IF;
  IF NEW.paid_amount = 0 THEN
    IF NEW.paid_at IS NOT NULL OR NEW.paid_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'An unpaid Transporter Bill cannot have payment metadata';
    END IF;
  ELSE
    IF NEW.paid_account_id IS DISTINCT FROM v_last_account THEN
      RAISE EXCEPTION 'Transporter Bill payment account must match its latest posted payment';
    END IF;
    IF (NEW.paid_amount = v_bill_total) IS DISTINCT FROM (NEW.paid_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Transporter Bill paid timestamp must match its fully-paid status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_ltms_transporter_bill_payment_totals ON public.ltms_transporter_bills;
CREATE TRIGGER validate_ltms_transporter_bill_payment_totals
  BEFORE UPDATE OF paid_amount, paid_at, paid_account_id ON public.ltms_transporter_bills
  FOR EACH ROW EXECUTE FUNCTION public.validate_ltms_transporter_bill_payment_totals();
REVOKE ALL ON FUNCTION public.validate_ltms_transporter_bill_payment_totals() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.prevent_paid_ltms_transporter_bill_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleted_at IS NULL
     AND NEW.deleted_at IS NOT NULL
     AND (coalesce(OLD.paid_amount, 0) > 0 OR EXISTS (
       SELECT 1 FROM public.ltms_transporter_bill_payments WHERE bill_id = OLD.id
     )) THEN
    RAISE EXCEPTION 'A transporter bill with recorded payments cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_paid_ltms_transporter_bill_soft_delete ON public.ltms_transporter_bills;
CREATE TRIGGER prevent_paid_ltms_transporter_bill_soft_delete
  BEFORE UPDATE OF deleted_at ON public.ltms_transporter_bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_ltms_transporter_bill_soft_delete();

CREATE OR REPLACE FUNCTION public.record_ltms_transporter_bill_payment(
  p_bill_id UUID,
  p_payment_ledger_id UUID,
  p_amount NUMERIC,
  p_paid_date DATE DEFAULT CURRENT_DATE,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.ltms_transporter_bills%ROWTYPE;
  v_payment_account public.ledger_accounts%ROWTYPE;
  v_payable_ledger_id UUID;
  v_payable_kind TEXT;
  v_payment_id UUID;
  v_journal_id UUID;
  v_amount NUMERIC(14,2);
  v_bill_total NUMERIC(14,2);
  v_new_paid NUMERIC(14,2);
BEGIN
  IF p_bill_id IS NULL THEN
    RAISE EXCEPTION 'Select a Transporter Bill to pay';
  END IF;

  SELECT * INTO v_bill
  FROM public.ltms_transporter_bills
  WHERE id = p_bill_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transporter Bill was not found or has been deleted';
  END IF;
  IF v_bill.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'This Transporter Bill has no posted payable journal and cannot be paid';
  END IF;

  v_amount := round(coalesce(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF p_paid_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  v_bill_total := round(coalesce(v_bill.total_freight, 0) + coalesce(v_bill.total_loading, 0), 2);
  IF round(coalesce(v_bill.paid_amount, 0) + v_amount, 2) > v_bill_total THEN
    RAISE EXCEPTION 'Payment exceeds the Transporter Bill balance of %',
      round(v_bill_total - coalesce(v_bill.paid_amount, 0), 2);
  END IF;

  SELECT * INTO v_payment_account
  FROM public.ledger_accounts
  WHERE id = p_payment_ledger_id
    AND branch_id = v_bill.branch_id
    AND is_active
    AND ledger_type IN ('bank', 'cash');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an active cash or bank account from the Transporter Bill branch';
  END IF;

  -- Settle the liability account credited on this original bill, even if the
  -- transporter source's account mapping was changed after bill generation.
  SELECT ledger_account_id INTO v_payable_ledger_id
  FROM public.journal_lines
  WHERE journal_entry_id = v_bill.journal_entry_id
    AND line_description LIKE 'Transporter source payable - transporter bill%'
    AND credit > 0
  ORDER BY line_no
  LIMIT 1;
  IF v_payable_ledger_id IS NULL THEN
    RAISE EXCEPTION 'The Transporter Bill journal has no posted transporter source payable line';
  END IF;

  SELECT account_kind INTO v_payable_kind
  FROM public.ledger_accounts
  WHERE id = v_payable_ledger_id
    AND branch_id = v_bill.branch_id
    AND is_active
    AND ledger_type = 'liability';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The transporter payable ledger used by this bill is no longer active in its branch';
  END IF;

  v_new_paid := round(coalesce(v_bill.paid_amount, 0) + v_amount, 2);
  v_payment_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    entry_date, branch_id, description, reference, source_module, status, approved_at
  )
  VALUES (
    p_paid_date,
    v_bill.branch_id,
    'Transporter Bill ' || v_bill.transporter_bill_number || ' payment | ' || v_payment_account.account_name || ' | ' || v_amount::TEXT,
    'ltms_transporter_bill_payment:' || v_payment_id::TEXT,
    'ltms',
    'approved',
    now()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.ltms_transporter_bill_payments (
    id, bill_id, payment_date, amount, payment_ledger_id, journal_entry_id, created_by
  )
  VALUES (
    v_payment_id, p_bill_id, p_paid_date, v_amount,
    p_payment_ledger_id, v_journal_id, p_created_by
  );

  INSERT INTO public.journal_lines (
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_bill.branch_id, v_payable_ledger_id, v_payable_kind,
     'Transporter source payable settled - ' || v_bill.transporter_bill_number, v_amount, 0),
    (v_journal_id, 2, v_bill.branch_id, v_payment_account.id, v_payment_account.account_kind,
     'Transporter payment from ' || v_payment_account.account_name || ' - ' || v_bill.transporter_bill_number, 0, v_amount);

  PERFORM public.validate_journal_entry(v_journal_id);

  UPDATE public.ltms_transporter_bills
  SET paid_amount = v_new_paid,
      paid_at = CASE WHEN v_new_paid = v_bill_total THEN now() ELSE NULL END,
      paid_account_id = p_payment_ledger_id
  WHERE id = p_bill_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ltms_transporter_bill_payment(UUID, UUID, NUMERIC, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ltms_transporter_bill_payment(UUID, UUID, NUMERIC, DATE, UUID)
  TO anon, authenticated, service_role;

COMMIT;
