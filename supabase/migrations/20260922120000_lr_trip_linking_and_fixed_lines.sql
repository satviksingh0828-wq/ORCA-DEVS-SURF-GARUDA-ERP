BEGIN;

ALTER TABLE public.lorry_receipts
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'ROAD',
  ADD COLUMN IF NOT EXISTS transporter_id UUID REFERENCES public.transporters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calculated_income NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.lorry_receipts
  DROP CONSTRAINT IF EXISTS lorry_receipts_mode_check;
ALTER TABLE public.lorry_receipts
  ADD CONSTRAINT lorry_receipts_mode_check
  CHECK (mode IN ('ROAD', 'RAIL', 'AIR', 'SHIP'));

CREATE TABLE IF NOT EXISTS public.trip_lorry_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  lr_id UUID NOT NULL REFERENCES public.lorry_receipts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, lr_id),
  UNIQUE (lr_id)
);

CREATE INDEX IF NOT EXISTS trip_lorry_receipts_trip_idx
  ON public.trip_lorry_receipts(trip_id);
CREATE INDEX IF NOT EXISTS trip_lorry_receipts_lr_idx
  ON public.trip_lorry_receipts(lr_id);

ALTER TABLE public.trip_lorry_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trip_lorry_receipts_app ON public.trip_lorry_receipts;
CREATE POLICY trip_lorry_receipts_app
  ON public.trip_lorry_receipts FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_lorry_receipts TO anon, authenticated;
GRANT ALL ON public.trip_lorry_receipts TO service_role;

COMMIT;

-- The application calculates and refreshes calculated_income from the selected
-- contract/source, transport mode, route, weight and quantity when an LR is saved.
-- Other Income and Expense line names remain fixed by the Trip UI; only amount
-- and note are editable and no custom rows are created from that screen.
