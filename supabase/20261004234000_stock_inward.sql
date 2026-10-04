BEGIN;

-- Stock Inward keeps one receipt header, its selected source set, and package lines.
-- Package lines intentionally reference package_rate_types and are validated against
-- an active unloading slab so loading-only package masters cannot be used here.
CREATE TABLE IF NOT EXISTS public.stock_inward_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  receipt_date DATE NOT NULL,
  unloading_date DATE NOT NULL,
  unloading_amount_received NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unloading_amount_received >= 0),
  additional_income_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (additional_income_mode IN ('approval', 'source', 'both', 'none')),
  approval_amount NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_inward_approval_amount_check CHECK (approval_amount IS NULL OR approval_amount >= 0),
  CONSTRAINT stock_inward_approval_mode_check CHECK (
    (additional_income_mode IN ('approval', 'both') AND approval_amount IS NOT NULL)
    OR (additional_income_mode IN ('source', 'none') AND approval_amount IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.stock_inward_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.stock_inward_receipts(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_inward_sources_unique UNIQUE (receipt_id, source_id)
);

CREATE TABLE IF NOT EXISTS public.stock_inward_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.stock_inward_receipts(id) ON DELETE CASCADE,
  package_rate_type_id UUID NOT NULL REFERENCES public.package_rate_types(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  package_type TEXT NOT NULL,
  quantity NUMERIC(14,3),
  weight_kg NUMERIC(14,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_inward_package_measurement CHECK (
    (quantity IS NOT NULL AND quantity > 0 AND weight_kg IS NULL)
    OR (weight_kg IS NOT NULL AND weight_kg > 0 AND quantity IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS stock_inward_receipts_date_idx
  ON public.stock_inward_receipts(receipt_date, branch_id);
CREATE INDEX IF NOT EXISTS stock_inward_sources_source_idx
  ON public.stock_inward_sources(source_id, receipt_id);
CREATE INDEX IF NOT EXISTS stock_inward_packages_receipt_idx
  ON public.stock_inward_packages(receipt_id, package_rate_type_id);

CREATE OR REPLACE FUNCTION public.validate_stock_inward_package()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_type public.package_rate_types%ROWTYPE;
  v_branch UUID;
  v_has_unloading BOOLEAN;
  v_source_count INTEGER;
BEGIN
  SELECT * INTO v_type FROM public.package_rate_types WHERE id = NEW.package_rate_type_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package type was not found'; END IF;
  SELECT branch_id INTO v_branch FROM public.stock_inward_receipts WHERE id = NEW.receipt_id;
  IF v_branch IS NULL OR v_type.branch_id <> v_branch THEN
    RAISE EXCEPTION 'Package type must belong to the Stock Inward branch';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.package_rate_entries e
    WHERE e.package_rate_type_id = NEW.package_rate_type_id
      AND e.rate_kind = 'unloading'
  ) INTO v_has_unloading;
  IF NOT v_has_unloading THEN RAISE EXCEPTION 'Only package types with an unloading rate can be used for Stock Inward'; END IF;
  SELECT count(*) INTO v_source_count FROM public.stock_inward_sources WHERE receipt_id = NEW.receipt_id AND source_id = NEW.source_id;
  IF v_source_count = 0 THEN RAISE EXCEPTION 'Package source must be one of the sources selected on the receipt'; END IF;
  NEW.package_type := v_type.package_type;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_inward_package_validate ON public.stock_inward_packages;
CREATE TRIGGER stock_inward_package_validate
BEFORE INSERT OR UPDATE ON public.stock_inward_packages
FOR EACH ROW EXECUTE FUNCTION public.validate_stock_inward_package();

ALTER TABLE public.stock_inward_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_inward_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_inward_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_inward_receipts_app ON public.stock_inward_receipts;
CREATE POLICY stock_inward_receipts_app ON public.stock_inward_receipts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS stock_inward_sources_app ON public.stock_inward_sources;
CREATE POLICY stock_inward_sources_app ON public.stock_inward_sources FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS stock_inward_packages_app ON public.stock_inward_packages;
CREATE POLICY stock_inward_packages_app ON public.stock_inward_packages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_inward_receipts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_inward_sources TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_inward_packages TO anon, authenticated;
GRANT ALL ON public.stock_inward_receipts TO service_role;
GRANT ALL ON public.stock_inward_sources TO service_role;
GRANT ALL ON public.stock_inward_packages TO service_role;

COMMIT;
