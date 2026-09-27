-- Rented trips use the LTMS rentals master instead of the legacy transporter master.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS trips_rental_id_idx ON public.trips(rental_id);

ALTER TABLE public.approval_charge_advances
  ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS approval_charge_advances_rental_id_idx
  ON public.approval_charge_advances(rental_id);

CREATE OR REPLACE FUNCTION public.replace_trip_lines_atomic(
  p_trip_id uuid,
  p_income jsonb,
  p_expenses jsonb,
  p_approval jsonb default null
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_trip_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.trips WHERE id = p_trip_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Trip is no longer open';
  END IF;
  DELETE FROM public.trip_other_income WHERE trip_id = p_trip_id;
  DELETE FROM public.trip_expenses WHERE trip_id = p_trip_id;
  DELETE FROM public.approval_charge_advances WHERE trip_id = p_trip_id;
  INSERT INTO public.trip_other_income (trip_id, income_name, amount, note)
  SELECT p_trip_id, x.income_name, x.amount, x.note
  FROM jsonb_to_recordset(coalesce(p_income, '[]'::jsonb)) AS x(income_name text, amount text, note text);
  INSERT INTO public.trip_expenses (trip_id, expense_name, amount, note, sort_order)
  SELECT p_trip_id, x.expense_name, x.amount, x.note, coalesce(x.sort_order, 0)
  FROM jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) AS x(expense_name text, amount text, note text, sort_order integer);
  IF p_approval IS NOT NULL THEN
    INSERT INTO public.approval_charge_advances (trip_id, trip_code, rental_id, advance, balance)
    SELECT p_trip_id, p_approval->>'trip_code', NULLIF(p_approval->>'rental_id', '')::uuid,
      coalesce(NULLIF(p_approval->>'advance', '')::numeric, 0),
      coalesce(NULLIF(p_approval->>'balance', '')::numeric, 0)
    FROM public.trips WHERE id = p_trip_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_trip_lines_atomic(uuid, jsonb, jsonb, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_trip_lines_atomic(uuid, jsonb, jsonb, jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.prevent_own_trip_hire_charges()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF lower(trim(NEW.expense_name)) = 'hire charges'
     AND NOT EXISTS (
       SELECT 1 FROM public.trips t
       WHERE t.id = NEW.trip_id AND t.ownership = 'third_party'
     ) THEN
    RAISE EXCEPTION 'Hire Charges can only be added to rented trips';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_own_trip_hire_charges ON public.trip_expenses;
CREATE TRIGGER prevent_own_trip_hire_charges
  BEFORE INSERT OR UPDATE ON public.trip_expenses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_own_trip_hire_charges();
