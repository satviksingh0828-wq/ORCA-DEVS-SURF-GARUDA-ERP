BEGIN;

ALTER TABLE public.fastag_transactions
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS fastag_transactions_payment_ledger_idx
  ON public.fastag_transactions(payment_ledger_id)
  WHERE payment_ledger_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tms_fastag_recharge_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id UUID;
  v_map public.tms_account_ledger_mappings%ROWTYPE;
  v_payment public.ledger_accounts%ROWTYPE;
  v_entry_id UUID;
  v_amount NUMERIC(14,2);
BEGIN
  IF NEW.transaction_type <> 'recharge' THEN
    RETURN NEW;
  END IF;

  v_amount := round(COALESCE(NEW.amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Fastag recharge amount must be greater than zero';
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.vehicles
  WHERE id = NEW.vehicle_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Fastag recharge vehicle or vehicle branch was not found';
  END IF;

  IF NEW.payment_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Select the cash or bank account used for the Fastag recharge';
  END IF;

  SELECT * INTO v_payment
  FROM public.ledger_accounts
  WHERE id = NEW.payment_ledger_id
    AND branch_id = v_branch_id
    AND is_active
    AND ledger_type IN ('cash', 'bank');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fastag payment account must be an active cash or bank account from the vehicle branch';
  END IF;

  SELECT * INTO v_map
  FROM public.tms_account_ledger_mappings
  WHERE branch_id = v_branch_id;
  IF NOT FOUND OR v_map.fastag_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map Fastag Ledger in TMS Accounts first';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ledger_accounts
    WHERE id = v_map.fastag_ledger_id
      AND branch_id = v_branch_id
      AND is_active
      AND ledger_type = 'expenditure'
  ) THEN
    RAISE EXCEPTION 'Fastag Ledger must be an active expenditure ledger from the vehicle branch';
  END IF;

  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  )
  VALUES (
    NEW.transaction_date::date,
    v_branch_id,
    'Fastag recharge - ' || COALESCE(NEW.note, 'Vehicle recharge'),
    'tms:fastag-recharge:' || NEW.id,
    'auto',
    'approved',
    now()
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    bank_account_id, cash_account_id, line_description, debit, credit
  )
  VALUES
    (
      v_entry_id, 1, v_branch_id, v_map.fastag_ledger_id, 'ledger',
      NULL, NULL, 'Fastag expenditure', v_amount, 0
    ),
    (
      v_entry_id, 2, v_branch_id, v_payment.id, v_payment.account_kind,
      CASE WHEN v_payment.account_kind = 'bank' THEN v_payment.source_bank_account_id ELSE NULL END,
      CASE WHEN v_payment.account_kind = 'cash' THEN v_payment.source_cash_account_id ELSE NULL END,
      'Fastag recharge paid from ' || v_payment.account_name, 0, v_amount
    );

  PERFORM public.validate_journal_entry(v_entry_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fastag_recharge_journal_created ON public.fastag_transactions;
CREATE TRIGGER fastag_recharge_journal_created
AFTER INSERT ON public.fastag_transactions
FOR EACH ROW
EXECUTE FUNCTION public.tms_fastag_recharge_journal();

GRANT EXECUTE ON FUNCTION public.tms_fastag_recharge_journal() TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fastag_transactions TO anon, authenticated;

COMMIT;
