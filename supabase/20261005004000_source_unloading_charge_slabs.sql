BEGIN;

CREATE TABLE IF NOT EXISTS public.source_unloading_charge_slabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  package_type TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('quantity', 'weight')),
  charge_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (charge_mode IN ('fixed', 'rate')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT source_unloading_package_type_check CHECK (length(trim(package_type)) > 0),
  CONSTRAINT source_unloading_unique_package_basis UNIQUE (contract_id, package_type, basis)
);

CREATE INDEX IF NOT EXISTS source_unloading_charge_slabs_contract_idx
  ON public.source_unloading_charge_slabs(contract_id, package_type, basis);

ALTER TABLE public.source_unloading_charge_slabs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_unloading_charge_slabs_app ON public.source_unloading_charge_slabs;
CREATE POLICY source_unloading_charge_slabs_app
  ON public.source_unloading_charge_slabs
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_unloading_charge_slabs TO anon, authenticated;
GRANT ALL ON public.source_unloading_charge_slabs TO service_role;

COMMIT;
