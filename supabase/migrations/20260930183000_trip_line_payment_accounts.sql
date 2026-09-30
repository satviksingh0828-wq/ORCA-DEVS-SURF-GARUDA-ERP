BEGIN;

ALTER TABLE public.trip_other_income
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.trip_expenses
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS trip_other_income_payment_ledger_idx
  ON public.trip_other_income(payment_ledger_id);

CREATE INDEX IF NOT EXISTS trip_expenses_payment_ledger_idx
  ON public.trip_expenses(payment_ledger_id);

CREATE OR REPLACE FUNCTION public.replace_trip_lines_atomic(
  p_trip_id uuid,
  p_income jsonb,
  p_expenses jsonb,
  p_approval jsonb default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_trip_id::text, 0));

  SELECT branch_id INTO v_branch_id
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Trip is no longer open';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(p_income, '[]'::jsonb))
      AS x(payment_ledger_id uuid)
    WHERE x.payment_ledger_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ledger_accounts l
        WHERE l.id = x.payment_ledger_id
          AND l.branch_id = v_branch_id
          AND l.is_active
          AND l.ledger_type IN ('cash', 'bank')
      )
  ) THEN
    RAISE EXCEPTION 'Other Income account must be an active cash or bank ledger from the trip branch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb))
      AS x(payment_ledger_id uuid)
    WHERE x.payment_ledger_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ledger_accounts l
        WHERE l.id = x.payment_ledger_id
          AND l.branch_id = v_branch_id
          AND l.is_active
          AND l.ledger_type IN ('cash', 'bank')
      )
  ) THEN
    RAISE EXCEPTION 'Expense account must be an active cash or bank ledger from the trip branch';
  END IF;

  DELETE FROM public.trip_other_income WHERE trip_id = p_trip_id;
  DELETE FROM public.trip_expenses WHERE trip_id = p_trip_id;
  DELETE FROM public.approval_charge_advances WHERE trip_id = p_trip_id;

  INSERT INTO public.trip_other_income
    (trip_id, income_name, amount, note, payment_ledger_id)
  SELECT p_trip_id, x.income_name, x.amount, x.note, x.payment_ledger_id
  FROM jsonb_to_recordset(coalesce(p_income, '[]'::jsonb)) AS x(
    income_name text,
    amount text,
    note text,
    payment_ledger_id uuid
  );

  INSERT INTO public.trip_expenses
    (trip_id, expense_name, amount, note, payment_ledger_id, sort_order)
  SELECT p_trip_id, x.expense_name, x.amount, x.note, x.payment_ledger_id, coalesce(x.sort_order, 0)
  FROM jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) AS x(
    expense_name text,
    amount text,
    note text,
    payment_ledger_id uuid,
    sort_order integer
  );

  IF p_approval IS NOT NULL THEN
    INSERT INTO public.approval_charge_advances
      (trip_id, trip_code, rental_id, advance, balance)
    SELECT
      p_trip_id,
      p_approval->>'trip_code',
      NULLIF(p_approval->>'rental_id', '')::uuid,
      coalesce(NULLIF(p_approval->>'advance', '')::numeric, 0),
      coalesce(NULLIF(p_approval->>'balance', '')::numeric, 0)
    FROM public.trips
    WHERE id = p_trip_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_trip_lines_atomic(uuid, jsonb, jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_trip_lines_atomic(uuid, jsonb, jsonb, jsonb)
  TO service_role;

COMMIT;
