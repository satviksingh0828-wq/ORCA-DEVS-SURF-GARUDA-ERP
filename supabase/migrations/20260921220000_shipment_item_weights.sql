BEGIN;

ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0
  CHECK (weight_kg >= 0);

COMMIT;
