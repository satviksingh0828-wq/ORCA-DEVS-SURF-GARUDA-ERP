BEGIN;

CREATE TABLE IF NOT EXISTS public.consignment_package_information (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID NOT NULL REFERENCES public.consignments(id) ON DELETE CASCADE,
  package_rate_type_id UUID NOT NULL REFERENCES public.package_rate_types(id) ON DELETE RESTRICT,
  package_type TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('quantity', 'weight')),
  quantity NUMERIC(14,3),
  weight_kg NUMERIC(14,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consignment_package_one_measurement CHECK (
    (quantity IS NOT NULL AND quantity > 0 AND weight_kg IS NULL)
    OR (weight_kg IS NOT NULL AND weight_kg > 0 AND quantity IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS consignment_package_information_consignment_idx
  ON public.consignment_package_information(consignment_id, created_at);
ALTER TABLE public.consignment_package_information ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consignment_package_information_app ON public.consignment_package_information;
CREATE POLICY consignment_package_information_app ON public.consignment_package_information
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consignment_package_information TO anon, authenticated;
GRANT ALL ON public.consignment_package_information TO service_role;

COMMIT;
