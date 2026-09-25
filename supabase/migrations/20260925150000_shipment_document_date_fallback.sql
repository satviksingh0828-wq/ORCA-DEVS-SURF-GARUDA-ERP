BEGIN;

-- E-Way Bill document dates are sometimes absent from the upstream response.
-- Keep the shipments NOT NULL contract and use the E-Way Bill date as the
-- authoritative fallback; current_date is only a final safety net.
CREATE OR REPLACE FUNCTION public.set_shipment_document_date_fallback()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.document_date IS NULL THEN
    NEW.document_date := NEW.eway_bill_date;
  END IF;

  IF NEW.document_date IS NULL THEN
    NEW.document_date := CURRENT_DATE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_document_date_fallback ON public.shipments;
CREATE TRIGGER trg_shipments_document_date_fallback
  BEFORE INSERT OR UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_shipment_document_date_fallback();

COMMIT;
