BEGIN;

CREATE OR REPLACE FUNCTION public.validate_trip_lorry_receipt_branch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_branch UUID;
  lr_branch UUID;
BEGIN
  SELECT branch_id INTO trip_branch FROM public.trips WHERE id = NEW.trip_id;
  SELECT branch_id INTO lr_branch FROM public.lorry_receipts WHERE id = NEW.lr_id;

  IF trip_branch IS NULL OR lr_branch IS NULL OR trip_branch <> lr_branch THEN
    RAISE EXCEPTION 'Trip and LR must belong to the same branch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_trip_lorry_receipt_branch ON public.trip_lorry_receipts;
CREATE TRIGGER trg_validate_trip_lorry_receipt_branch
  BEFORE INSERT OR UPDATE ON public.trip_lorry_receipts
  FOR EACH ROW EXECUTE FUNCTION public.validate_trip_lorry_receipt_branch();

COMMIT;

-- No manual SQL is needed beyond applying this migration through Supabase migrations.
-- trip_lorry_receipts.lr_id already has a UNIQUE constraint, so an LR cannot be linked to multiple trips.
