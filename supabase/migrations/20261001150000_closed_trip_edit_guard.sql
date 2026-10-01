-- Closed trips are view-only. Reopening is the only permitted transition from a closed row.
CREATE OR REPLACE FUNCTION public.prevent_closed_trip_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(OLD.closed, false) THEN
    IF NEW.closed IS DISTINCT FROM false
       OR (to_jsonb(NEW) - 'closed' - 'reopened_at' - 'updated_at') IS DISTINCT FROM
          (to_jsonb(OLD) - 'closed' - 'reopened_at' - 'updated_at') THEN
      RAISE EXCEPTION 'Closed trips are read-only. Reopen the trip before editing.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_closed_trip_edit ON public.trips;
CREATE TRIGGER prevent_closed_trip_edit
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.prevent_closed_trip_edit();
