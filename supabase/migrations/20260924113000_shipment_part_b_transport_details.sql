BEGIN;

ALTER TABLE public.shipment_part_b_history
  ADD COLUMN IF NOT EXISTS transporter_id TEXT,
  ADD COLUMN IF NOT EXISTS transporter_name TEXT,
  ADD COLUMN IF NOT EXISTS trans_distance NUMERIC(12,2);

COMMIT;
