BEGIN;

CREATE TABLE IF NOT EXISTS public.package_rate_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  package_type TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('quantity', 'weight')),
  charge_mode TEXT NOT NULL CHECK (charge_mode IN ('fixed', 'rate')),
  from_value NUMERIC(14,3) NOT NULL CHECK (from_value >= 0),
  to_value NUMERIC(14,3),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT package_rate_entries_range_check CHECK (to_value IS NULL OR to_value >= from_value),
  CONSTRAINT package_rate_entries_type_check CHECK (length(trim(package_type)) > 0)
);
CREATE INDEX IF NOT EXISTS package_rate_entries_branch_type_idx
  ON public.package_rate_entries(branch_id, package_type, basis, from_value);
ALTER TABLE public.package_rate_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS package_rate_entries_app ON public.package_rate_entries;
CREATE POLICY package_rate_entries_app ON public.package_rate_entries
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_rate_entries TO anon, authenticated;
GRANT ALL ON public.package_rate_entries TO service_role;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS part_b_fetched_at TIMESTAMPTZ;

COMMIT;
