BEGIN;

ALTER TABLE public.approval_charge_advances
  ADD COLUMN IF NOT EXISTS settlement_journal_entry_id uuid
    REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- Keep browser roles read-only; balance changes are made by the service-role
-- trip-line and settlement functions so they cannot bypass journal posting.
DROP POLICY IF EXISTS "app can manage approval charge advances"
  ON public.approval_charge_advances;
CREATE POLICY "app can read approval charge advances"
  ON public.approval_charge_advances FOR SELECT
  TO anon, authenticated
  USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.approval_charge_advances
  FROM anon, authenticated;
GRANT SELECT ON public.approval_charge_advances TO anon, authenticated;

CREATE INDEX IF NOT EXISTS approval_charge_advances_settlement_journal_idx
  ON public.approval_charge_advances(settlement_journal_entry_id)
  WHERE settlement_journal_entry_id IS NOT NULL;

-- Replace the original three-argument function so every recorded payment,
-- including partial payments entered in Rental Advance, posts a journal.
DROP FUNCTION IF EXISTS public.settle_rental_balance_atomic(uuid, uuid, uuid);

CREATE FUNCTION public.settle_rental_balance_atomic(
  p_advance_id uuid,
  p_payment_ledger_id uuid,
  p_user_id uuid,
  p_amount numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_advance public.approval_charge_advances%rowtype;
  v_trip public.trips%rowtype;
  v_rental public.rentals%rowtype;
  v_entry uuid;
  v_amount numeric;
  v_balance numeric;
  v_line_no integer := 0;
  v_reference text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_advance_id::text, 0));

  SELECT * INTO v_advance
  FROM public.approval_charge_advances
  WHERE id = p_advance_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental advance was not found';
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = v_advance.trip_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Live trip was not found';
  END IF;
  IF v_trip.posted_journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Cash or bank account cannot be changed before Trip Billing is posted';
  END IF;
  IF v_trip.branch_id IS NULL THEN
    RAISE EXCEPTION 'Trip branch is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ledger_accounts l
    WHERE l.id = p_payment_ledger_id
      AND l.branch_id = v_trip.branch_id
      AND l.is_active
      AND l.ledger_type IN ('cash', 'bank')
  ) THEN
    RAISE EXCEPTION 'Selected account must be an active Cash or Bank account from the trip branch';
  END IF;

  SELECT * INTO v_rental
  FROM public.rentals
  WHERE id = coalesce(v_trip.rental_id, v_advance.rental_id)
    AND branch_id = v_trip.branch_id;
  IF NOT FOUND OR v_rental.liability_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Rental liability account is missing for this trip';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts l
    WHERE l.id = v_rental.liability_ledger_id
      AND l.branch_id = v_trip.branch_id
      AND l.is_active
      AND l.ledger_type = 'liability'
  ) THEN
    RAISE EXCEPTION 'Rental liability account is invalid for the trip branch';
  END IF;

  v_balance := round(greatest(coalesce(v_advance.balance, 0), 0), 2);
  v_amount := round(coalesce(p_amount, v_balance), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF v_amount > v_balance THEN
    RAISE EXCEPTION 'Payment amount cannot exceed the remaining rental balance';
  END IF;

  -- Keep the Hire Charges row synchronized with the account actually paid from.
  UPDATE public.trip_expenses
  SET payment_ledger_id = p_payment_ledger_id
  WHERE trip_id = v_trip.id
    AND lower(trim(expense_name)) = 'hire charges';

  v_reference := 'ltms:rental-balance:' || v_advance.id::text || ':' || gen_random_uuid()::text;
  INSERT INTO public.journal_entries
    (entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES
    (coalesce(nullif(v_trip.end_date, '')::date, current_date),
     v_trip.branch_id,
     'LTMS Rental Balance Payment - ' || v_trip.trip_code,
     v_reference,
     'ltms',
     'approved',
     now())
  RETURNING id INTO v_entry;

  v_line_no := v_line_no + 1;
  INSERT INTO public.journal_lines
    (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, v_line_no, v_trip.branch_id, v_rental.liability_ledger_id, 'ledger',
     'Rental balance settled - ' || v_trip.trip_code, v_amount, 0);

  v_line_no := v_line_no + 1;
  INSERT INTO public.journal_lines
    (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, v_line_no, v_trip.branch_id, p_payment_ledger_id,
     (SELECT account_kind FROM public.ledger_accounts WHERE id = p_payment_ledger_id),
     'Rental balance paid - ' || v_trip.trip_code, 0, v_amount);

  PERFORM public.validate_journal_entry(v_entry);

  UPDATE public.approval_charge_advances
  SET advance = coalesce(advance, 0) + v_amount,
      balance = v_balance - v_amount,
      settlement_journal_entry_id = v_entry,
      updated_at = now()
  WHERE id = v_advance.id;

  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_rental_balance_atomic(uuid, uuid, uuid, numeric)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_rental_balance_atomic(uuid, uuid, uuid, numeric)
  TO service_role;

COMMIT;
