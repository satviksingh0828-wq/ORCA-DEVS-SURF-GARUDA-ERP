BEGIN;

-- Route-wise freight/loading rates maintained on each LTMS transporter.
-- This deliberately mirrors contract_entries so transporter rates can use
-- the same mode, PIN route and slab calculation rules.
CREATE TABLE IF NOT EXISTS public.ltms_transporter_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_id UUID NOT NULL REFERENCES public.ltms_transporters(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'ROAD' CHECK (mode IN ('ROAD', 'RAIL', 'AIR', 'SHIP')),
  from_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  from_pin_code TEXT NOT NULL DEFAULT '',
  to_pin_code TEXT NOT NULL DEFAULT '',
  freight_route_range_type TEXT NOT NULL DEFAULT 'weight' CHECK (freight_route_range_type IN ('weight', 'quantity')),
  freight_route_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
  loading_route_range_type TEXT NOT NULL DEFAULT 'weight' CHECK (loading_route_range_type IN ('weight', 'quantity')),
  loading_route_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
  per_manifest_amount TEXT NOT NULL DEFAULT '',
  per_manifest_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ltms_transporter_entries_transporter_idx
  ON public.ltms_transporter_entries(transporter_id);
CREATE INDEX IF NOT EXISTS ltms_transporter_entries_route_idx
  ON public.ltms_transporter_entries(transporter_id, mode, from_pin_code, to_pin_code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ltms_transporter_entries TO anon, authenticated;
GRANT ALL ON public.ltms_transporter_entries TO service_role;
ALTER TABLE public.ltms_transporter_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ltms_transporter_entries_app ON public.ltms_transporter_entries;
CREATE POLICY ltms_transporter_entries_app ON public.ltms_transporter_entries
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_ltms_transporter_entries_updated ON public.ltms_transporter_entries;
CREATE TRIGGER trg_ltms_transporter_entries_updated
  BEFORE UPDATE ON public.ltms_transporter_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
