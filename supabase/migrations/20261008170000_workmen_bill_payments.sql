BEGIN;

ALTER TABLE public.workmen_bills
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_account_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workmen_bills_paid_amount_check'
      AND conrelid = 'public.workmen_bills'::regclass
  ) THEN
    ALTER TABLE public.workmen_bills
      ADD CONSTRAINT workmen_bills_paid_amount_check
      CHECK (paid_amount >= 0 AND paid_amount <= grand_total);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.workmen_bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.workmen_bills(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_ledger_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workmen_bill_payments_bill_idx
  ON public.workmen_bill_payments(bill_id, payment_date DESC, created_at DESC);

ALTER TABLE public.workmen_bill_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workmen_bill_payments_app ON public.workmen_bill_payments;
CREATE POLICY workmen_bill_payments_app ON public.workmen_bill_payments
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT ON public.workmen_bill_payments TO anon, authenticated;
GRANT ALL ON public.workmen_bill_payments TO service_role;

CREATE OR REPLACE FUNCTION public.record_workmen_bill_payment(
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
  v_bill public.workmen_bills%ROWTYPE;
  v_payment_account public.ledger_accounts%ROWTYPE;
  v_payable_ledger_id UUID;
  v_payable_kind TEXT;
  v_payment_id UUID;
  v_journal_id UUID;
  v_amount NUMERIC(14,2);
  v_new_paid NUMERIC(14,2);
BEGIN
  IF p_bill_id IS NULL THEN
    RAISE EXCEPTION 'Select a Workmen Bill to pay';
  END IF;

  SELECT * INTO v_bill
  FROM public.workmen_bills
  WHERE id = p_bill_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workmen Bill was not found or has been deleted';
  END IF;
  IF v_bill.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'This legacy Workmen Bill has no posted payable journal and cannot be paid';
  END IF;

  v_amount := round(coalesce(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF p_paid_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;
  IF round(coalesce(v_bill.paid_amount, 0) + v_amount, 2) > round(v_bill.grand_total, 2) THEN
    RAISE EXCEPTION 'Payment exceeds the Workmen Bill balance of %',
      round(v_bill.grand_total - coalesce(v_bill.paid_amount, 0), 2);
  END IF;

  SELECT * INTO v_payment_account
  FROM public.ledger_accounts
  WHERE id = p_payment_ledger_id
    AND branch_id = v_bill.branch_id
    AND is_active
    AND ledger_type IN ('bank', 'cash');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an active cash or bank account from the Workmen Bill branch';
  END IF;

  -- Settle the liability account used on the original bill posting, even if
  -- the branch mapping was changed after the bill was generated.
  SELECT ledger_account_id INTO v_payable_ledger_id
  FROM public.journal_lines
  WHERE journal_entry_id = v_bill.journal_entry_id
    AND line_description LIKE 'Workmen payable - %'
    AND credit > 0
  ORDER BY line_no
  LIMIT 1;
  IF v_payable_ledger_id IS NULL THEN
    RAISE EXCEPTION 'The Workmen Bill journal has no posted Workmen Payable line';
  END IF;

  SELECT account_kind INTO v_payable_kind
  FROM public.ledger_accounts
  WHERE id = v_payable_ledger_id
    AND branch_id = v_bill.branch_id
    AND is_active
    AND ledger_type = 'liability';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Workmen Payable ledger used by this bill is no longer active in its branch';
  END IF;

  v_new_paid := round(coalesce(v_bill.paid_amount, 0) + v_amount, 2);
  v_payment_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    entry_date, branch_id, description, reference, source_module, status, approved_at
  )
  VALUES (
    p_paid_date,
    v_bill.branch_id,
    'Workmen Bill ' || v_bill.bill_number || ' payment | ' || v_payment_account.account_name || ' | ' || v_amount::TEXT,
    'workmen_bill_payment:' || v_payment_id::TEXT,
    'ltms',
    'approved',
    now()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.workmen_bill_payments (
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
     'Workmen payable settled - ' || v_bill.bill_number, v_amount, 0),
    (v_journal_id, 2, v_bill.branch_id, v_payment_account.id, v_payment_account.account_kind,
     'Workmen payment from ' || v_payment_account.account_name || ' - ' || v_bill.bill_number, 0, v_amount);

  PERFORM public.validate_journal_entry(v_journal_id);

  UPDATE public.workmen_bills
  SET paid_amount = v_new_paid,
      paid_at = CASE WHEN v_new_paid = round(grand_total, 2) THEN now() ELSE NULL END,
      paid_account_id = p_payment_ledger_id,
      updated_at = now()
  WHERE id = p_bill_id;

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_workmen_bill_payment(UUID, UUID, NUMERIC, DATE, UUID)
  TO anon, authenticated, service_role;

COMMIT;
