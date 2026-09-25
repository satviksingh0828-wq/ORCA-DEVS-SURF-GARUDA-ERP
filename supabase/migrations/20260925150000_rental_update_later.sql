BEGIN;

-- Allows a rental provider to be selected for a consignment while its GSTIN/PIN
-- details are completed later from Masters → Rentals.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS details_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.require_partner_gstin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'rentals' AND COALESCE(NEW.details_pending, FALSE) THEN
    RETURN NEW;
  END IF;

  IF NULLIF(trim(NEW.gstin), '') IS NULL THEN
    RAISE EXCEPTION 'GSTIN is mandatory for Transporters and Rentals';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_ltms_transporter_pin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'rentals' AND COALESCE(NEW.details_pending, FALSE) THEN
    RETURN NEW;
  END IF;

  IF NULLIF(trim(NEW.pin_code), '') IS NULL THEN
    RAISE EXCEPTION 'PIN Code is mandatory for Transporters and Rentals';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rentals_require_pin ON public.rentals;
CREATE TRIGGER trg_rentals_require_pin
  BEFORE INSERT OR UPDATE ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.require_ltms_transporter_pin();

COMMIT;

-- When details_pending is changed to FALSE, the existing trigger enforces GSTIN.
-- This preserves the mandatory GSTIN requirement for completed rental records.
