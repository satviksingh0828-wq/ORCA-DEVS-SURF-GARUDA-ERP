BEGIN;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'ROAD';

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_mode_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_mode_check
  CHECK (mode IN ('ROAD', 'RAIL', 'AIR', 'SHIP'));

ALTER TABLE public.contract_entries
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'ROAD';

ALTER TABLE public.contract_entries
  DROP CONSTRAINT IF EXISTS contract_entries_mode_check;

ALTER TABLE public.contract_entries
  ADD CONSTRAINT contract_entries_mode_check
  CHECK (mode IN ('ROAD', 'RAIL', 'AIR', 'SHIP'));

DROP POLICY IF EXISTS shipments_delete_app ON public.shipments;
CREATE POLICY shipments_delete_app
  ON public.shipments FOR DELETE
  TO anon, authenticated
  USING (NOT EXISTS (
    SELECT 1 FROM public.lr_shipments
    WHERE lr_shipments.shipment_id = shipments.id
  ));

GRANT DELETE ON public.shipments TO anon, authenticated;

COMMIT;
