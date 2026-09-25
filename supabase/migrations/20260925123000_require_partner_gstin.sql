BEGIN;

CREATE OR REPLACE FUNCTION public.require_partner_gstin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NULLIF(trim(NEW.gstin), '') IS NULL THEN
    RAISE EXCEPTION 'GSTIN is mandatory for Transporters and Rentals';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ltms_transporters_require_gstin ON public.ltms_transporters;
CREATE TRIGGER trg_ltms_transporters_require_gstin
  BEFORE INSERT OR UPDATE ON public.ltms_transporters
  FOR EACH ROW EXECUTE FUNCTION public.require_partner_gstin();

DROP TRIGGER IF EXISTS trg_rentals_require_gstin ON public.rentals;
CREATE TRIGGER trg_rentals_require_gstin
  BEFORE INSERT OR UPDATE ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.require_partner_gstin();

COMMIT;

-- Existing records with blank GSTIN must be completed before they can be edited.
-- New Transporter and Rental records cannot be saved without GSTIN.
