BEGIN;

CREATE TABLE IF NOT EXISTS public.package_rate_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  package_type TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('quantity', 'weight')),
  charge_mode TEXT NOT NULL CHECK (charge_mode IN ('fixed', 'rate')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT package_rate_types_name_check CHECK (length(trim(package_type)) > 0),
  CONSTRAINT package_rate_types_unique_name UNIQUE (branch_id, package_type)
);
ALTER TABLE public.package_rate_entries
  ADD COLUMN IF NOT EXISTS package_rate_type_id UUID REFERENCES public.package_rate_types(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS package_rate_entries_type_idx
  ON public.package_rate_entries(package_rate_type_id, from_value);
ALTER TABLE public.package_rate_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS package_rate_types_app ON public.package_rate_types;
CREATE POLICY package_rate_types_app ON public.package_rate_types
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_rate_types TO anon, authenticated;
GRANT ALL ON public.package_rate_types TO service_role;

COMMIT;
