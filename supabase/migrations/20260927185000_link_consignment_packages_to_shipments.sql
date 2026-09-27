BEGIN;

ALTER TABLE public.consignment_package_information
  ADD COLUMN IF NOT EXISTS shipment_id UUID REFERENCES public.shipments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS consignment_package_information_shipment_idx
  ON public.consignment_package_information(shipment_id);

COMMIT;
