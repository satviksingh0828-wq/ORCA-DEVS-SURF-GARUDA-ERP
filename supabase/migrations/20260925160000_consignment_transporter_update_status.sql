BEGIN;

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS transporter_update_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS transporter_update_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transporter_updated_at TIMESTAMPTZ;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS transporter_update_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS transporter_update_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transporter_updated_at TIMESTAMPTZ;

ALTER TABLE public.consignments
  DROP CONSTRAINT IF EXISTS consignments_transporter_update_status_check;
ALTER TABLE public.consignments
  ADD CONSTRAINT consignments_transporter_update_status_check
  CHECK (transporter_update_status IN ('pending', 'partial', 'updated'));

ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_transporter_update_status_check;
ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_transporter_update_status_check
  CHECK (transporter_update_status IN ('pending', 'failed', 'updated'));

CREATE INDEX IF NOT EXISTS consignments_transporter_status_idx
  ON public.consignments(transporter_id, transporter_update_status, created_at DESC);

COMMIT;
