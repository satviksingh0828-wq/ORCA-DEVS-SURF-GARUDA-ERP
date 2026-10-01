BEGIN;

-- Pre-posting payments update the operational advance/balance only. They do
-- not create journal entries; Trip Billing records the resulting advance when
-- the trip is posted later.
CREATE OR REPLACE FUNCTION public.record_unposted_rental_advance_payment_atomic(
  p_advance_id uuid,
  p_amount numeric,
  p_user_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_advance public.approval_charge_advances%rowtype;
  v_trip public.trips%rowtype;
  v_balance numeric;
  v_amount numeric;
BEGIN
  -- Read the trip key first, then take locks in the same trip-before-advance
  -- order used by trip posting to avoid conflicting edits while it posts.
  SELECT * INTO v_advance
  FROM public.approval_charge_advances
  WHERE id = p_advance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental advance was not found';
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = v_advance.trip_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip was not found';
  END IF;
  IF v_trip.posted_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Trip Billing is already posted; use journal-backed Rental Advance payment';
  END IF;

  SELECT * INTO v_advance
  FROM public.approval_charge_advances
  WHERE id = p_advance_id AND trip_id = v_trip.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental advance was changed while payment was being recorded';
  END IF;

  v_balance := round(greatest(coalesce(v_advance.balance, 0), 0), 2);
  v_amount := round(coalesce(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF v_amount > v_balance THEN
    RAISE EXCEPTION 'Payment amount cannot exceed the remaining rental balance';
  END IF;

  UPDATE public.approval_charge_advances
  SET advance = coalesce(advance, 0) + v_amount,
      balance = v_balance - v_amount,
      updated_at = now()
  WHERE id = v_advance.id;

  -- Intentionally return only the resulting balance; no journal_entries or
  -- journal_lines are written in this pre-posting path.
  RETURN v_balance - v_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.record_unposted_rental_advance_payment_atomic(uuid, numeric, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_unposted_rental_advance_payment_atomic(uuid, numeric, uuid)
  TO service_role;

COMMIT;
