BEGIN;

DROP TRIGGER IF EXISTS trg_rentals_require_pin ON public.rentals;
CREATE TRIGGER trg_rentals_require_pin
  BEFORE INSERT OR UPDATE ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.require_ltms_transporter_pin();

COMMIT;

-- Existing Rental records with blank PIN Code must be completed before editing.
-- New Rental records cannot be saved without PIN Code.
