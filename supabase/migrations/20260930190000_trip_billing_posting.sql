BEGIN;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS trips_posted_journal_entry_key
  ON public.trips(posted_journal_entry_id)
  WHERE posted_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trips_posted_status_idx
  ON public.trips(closed, posted_journal_entry_id, end_date);

CREATE OR REPLACE FUNCTION public.post_trip_billing_atomic(
  p_trip_id uuid,
  p_income jsonb,
  p_expenses jsonb,
  p_approval jsonb,
  p_posted_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_trip public.trips%rowtype;
  v_map public.tms_account_ledger_mappings%rowtype;
  v_rental public.rentals%rowtype;
  v_entry uuid;
  v_branch_id uuid;
  v_line_no integer := 0;
  v_amount numeric;
  v_advance numeric;
  v_balance numeric;
  v_payment_ledger uuid;
  v_debit_ledger uuid;
  v_credit_ledger uuid;
  v_name text;
  v_ref text;
  v_row record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_trip_id::text, 0));

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip was not found';
  END IF;
  IF coalesce(v_trip.closed, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only closed trips can be posted';
  END IF;
  IF v_trip.posted_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This trip has already been posted';
  END IF;

  v_branch_id := v_trip.branch_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Trip branch is required before posting';
  END IF;

  SELECT * INTO v_map
  FROM public.tms_account_ledger_mappings
  WHERE branch_id = v_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LTMS account mapping is missing for this trip branch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(p_income, '[]'::jsonb)) AS x(payment_ledger_id uuid)
    WHERE x.payment_ledger_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.ledger_accounts l
        WHERE l.id = x.payment_ledger_id
          AND l.branch_id = v_branch_id
          AND l.is_active
          AND l.ledger_type IN ('cash', 'bank')
      )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) AS x(payment_ledger_id uuid)
    WHERE x.payment_ledger_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.ledger_accounts l
        WHERE l.id = x.payment_ledger_id
          AND l.branch_id = v_branch_id
          AND l.is_active
          AND l.ledger_type IN ('cash', 'bank')
      )
  ) THEN
    RAISE EXCEPTION 'Every selected payment account must be an active cash or bank ledger from the trip branch';
  END IF;

  DELETE FROM public.trip_other_income WHERE trip_id = p_trip_id;
  DELETE FROM public.trip_expenses WHERE trip_id = p_trip_id;
  DELETE FROM public.approval_charge_advances WHERE trip_id = p_trip_id;

  INSERT INTO public.trip_other_income
    (trip_id, income_name, amount, note, payment_ledger_id)
  SELECT p_trip_id, x.name, x.amount, x.note, x.payment_ledger_id
  FROM jsonb_to_recordset(coalesce(p_income, '[]'::jsonb)) AS x(
    name text, amount text, note text, payment_ledger_id uuid, advance text
  );

  INSERT INTO public.trip_expenses
    (trip_id, expense_name, amount, note, payment_ledger_id, sort_order)
  SELECT p_trip_id, x.name, x.amount, x.note, x.payment_ledger_id,
    row_number() OVER ()::integer
  FROM jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) AS x(
    name text, amount text, note text, payment_ledger_id uuid, advance text
  );

  IF p_approval IS NOT NULL THEN
    INSERT INTO public.approval_charge_advances
      (trip_id, trip_code, rental_id, advance, balance)
    VALUES (
      p_trip_id,
      p_approval->>'trip_code',
      NULLIF(p_approval->>'rental_id', '')::uuid,
      coalesce(NULLIF(p_approval->>'advance', '')::numeric, 0),
      coalesce(NULLIF(p_approval->>'balance', '')::numeric, 0)
    );
  END IF;

  v_ref := 'ltms:trip:' || p_trip_id::text || ':posted';
  INSERT INTO public.journal_entries
    (entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (
    coalesce(nullif(v_trip.end_date, '')::date, current_date),
    v_branch_id,
    'LTMS Trip Billing - ' || v_trip.trip_code,
    v_ref,
    'ltms',
    'approved',
    now()
  )
  RETURNING id INTO v_entry;

  FOR v_row IN
    SELECT * FROM jsonb_to_recordset(coalesce(p_income, '[]'::jsonb)) AS x(
      name text, amount text, note text, payment_ledger_id uuid, advance text
    )
  LOOP
    v_amount := round(coalesce(nullif(v_row.amount, '')::numeric, 0), 2);
    IF v_amount <= 0 THEN CONTINUE; END IF;
    v_name := lower(trim(v_row.name));
    IF v_name <> 'approval charge' THEN
      RAISE EXCEPTION 'No LTMS income mapping exists for %', v_row.name;
    END IF;
    IF v_row.payment_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Select a cash or bank account for %', v_row.name;
    END IF;
    IF v_map.approval_charge_income_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Approval Charge income account is not mapped for this branch';
    END IF;
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines
      (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES
      (v_entry, v_line_no, v_branch_id, v_row.payment_ledger_id,
       (SELECT account_kind FROM public.ledger_accounts WHERE id = v_row.payment_ledger_id),
       'Approval Charge received - ' || v_trip.trip_code, v_amount, 0);
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines
      (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES
      (v_entry, v_line_no, v_branch_id, v_map.approval_charge_income_ledger_id, 'ledger',
       'Approval Charge income - ' || v_trip.trip_code, 0, v_amount);
  END LOOP;

  FOR v_row IN
    SELECT * FROM jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) AS x(
      name text, amount text, note text, payment_ledger_id uuid, advance text
    )
  LOOP
    v_amount := round(coalesce(nullif(v_row.amount, '')::numeric, 0), 2);
    IF v_amount <= 0 THEN CONTINUE; END IF;
    v_name := lower(trim(v_row.name));

    -- Regular Toll Charges are informational only and never enter the journal.
    IF v_name = 'toll charges' THEN CONTINUE; END IF;

    v_debit_ledger := CASE v_name
      WHEN 'fuel expense' THEN v_map.trip_fuel_expense_ledger_id
      WHEN 'toll charges (paid in cash)' THEN v_map.trip_toll_cash_ledger_id
      WHEN 'driver bata' THEN v_map.trip_driver_bata_ledger_id
      WHEN 'morning exp.' THEN v_map.trip_morning_exp_ledger_id
      WHEN 'night exp.' THEN v_map.trip_night_exp_ledger_id
      WHEN 'sunday' THEN v_map.trip_sunday_ledger_id
      WHEN 'parking charges' THEN v_map.trip_parking_charges_ledger_id
      WHEN 'dala charges' THEN v_map.trip_dala_charges_ledger_id
      WHEN 'unloading' THEN v_map.trip_unloading_ledger_id
      WHEN 'hire charges' THEN v_map.trip_hire_charges_ledger_id
      ELSE NULL
    END;
    IF v_debit_ledger IS NULL THEN
      RAISE EXCEPTION 'No LTMS expenditure mapping exists for %', v_row.name;
    END IF;

    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines
      (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES
      (v_entry, v_line_no, v_branch_id, v_debit_ledger, 'ledger',
       v_row.name || ' - ' || v_trip.trip_code, v_amount, 0);

    IF v_name = 'hire charges' THEN
      v_advance := round(coalesce(nullif(v_row.advance, '')::numeric, 0), 2);
      IF v_advance < 0 OR v_advance > v_amount THEN
        RAISE EXCEPTION 'Hire Charges advance must be between zero and the Hire Charges amount';
      END IF;
      v_balance := round(v_amount - v_advance, 2);
      IF v_advance > 0 THEN
        IF v_row.payment_ledger_id IS NULL THEN
          RAISE EXCEPTION 'Select a cash or bank account for Hire Charges advance';
        END IF;
        v_line_no := v_line_no + 1;
        INSERT INTO public.journal_lines
          (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
        VALUES
          (v_entry, v_line_no, v_branch_id, v_row.payment_ledger_id,
           (SELECT account_kind FROM public.ledger_accounts WHERE id = v_row.payment_ledger_id),
           'Hire Charges advance paid - ' || v_trip.trip_code, 0, v_advance);
      END IF;
      IF v_balance > 0 THEN
        SELECT * INTO v_rental
        FROM public.rentals
        WHERE id = v_trip.rental_id AND branch_id = v_branch_id;
        IF NOT FOUND OR v_rental.liability_ledger_id IS NULL THEN
          RAISE EXCEPTION 'Rental liability account is missing for this trip rental';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.ledger_accounts l
          WHERE l.id = v_rental.liability_ledger_id
            AND l.branch_id = v_branch_id
            AND l.is_active AND l.ledger_type = 'liability'
        ) THEN
          RAISE EXCEPTION 'Rental liability account is invalid for this trip branch';
        END IF;
        v_line_no := v_line_no + 1;
        INSERT INTO public.journal_lines
          (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
        VALUES
          (v_entry, v_line_no, v_branch_id, v_rental.liability_ledger_id, 'ledger',
           'Hire Charges balance payable - ' || v_trip.trip_code, 0, v_balance);
      END IF;
    ELSE
      IF v_row.payment_ledger_id IS NULL THEN
        RAISE EXCEPTION 'Select a cash or bank account for %', v_row.name;
      END IF;
      v_line_no := v_line_no + 1;
      INSERT INTO public.journal_lines
        (journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
      VALUES
        (v_entry, v_line_no, v_branch_id, v_row.payment_ledger_id,
         (SELECT account_kind FROM public.ledger_accounts WHERE id = v_row.payment_ledger_id),
         v_row.name || ' paid - ' || v_trip.trip_code, 0, v_amount);
    END IF;
  END LOOP;

  PERFORM public.validate_journal_entry(v_entry);

  UPDATE public.trips
  SET posted_at = now(), posted_by = p_posted_by, posted_journal_entry_id = v_entry
  WHERE id = p_trip_id AND posted_journal_entry_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip was posted by another user';
  END IF;
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.post_trip_billing_atomic(uuid, jsonb, jsonb, jsonb, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_trip_billing_atomic(uuid, jsonb, jsonb, jsonb, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_posted_trip_reopen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.posted_journal_entry_id IS NOT NULL
     AND NEW.closed IS DISTINCT FROM OLD.closed
     AND NEW.closed IS FALSE THEN
    RAISE EXCEPTION 'A posted trip cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_posted_trip_reopen ON public.trips;
CREATE TRIGGER prevent_posted_trip_reopen
  BEFORE UPDATE OF closed ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_trip_reopen();

COMMIT;
