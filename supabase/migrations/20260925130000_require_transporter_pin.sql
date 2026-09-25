BEGIN;

CREATE OR REPLACE FUNCTION public.require_ltms_transporter_pin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NULLIF(trim(NEW.pin_code), '') IS NULL THEN
    RAISE EXCEPTION 'PIN Code is mandatory for Transporters';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ltms_transporters_require_pin ON public.ltms_transporters;
CREATE TRIGGER trg_ltms_transporters_require_pin
  BEFORE INSERT OR UPDATE ON public.ltms_transporters
  FOR EACH ROW EXECUTE FUNCTION public.require_ltms_transporter_pin();

COMMIT;

-- Existing LTMS Transporter records with blank PIN Code must be completed before editing.
-- New Transporter records cannot be saved without PIN Code.
