BEGIN;

CREATE TABLE IF NOT EXISTS public.source_common_loading_slabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  basis TEXT NOT NULL CHECK (basis IN ('quantity', 'weight')),
  from_value NUMERIC(14,3) NOT NULL CHECK (from_value >= 0),
  to_value NUMERIC(14,3),
  charge_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (charge_mode IN ('fixed', 'rate')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT source_common_loading_range_check CHECK (to_value IS NULL OR to_value >= from_value)
);
CREATE UNIQUE INDEX IF NOT EXISTS source_common_loading_slabs_range_uidx
  ON public.source_common_loading_slabs(contract_id, basis, from_value, COALESCE(to_value, -1));
CREATE INDEX IF NOT EXISTS source_common_loading_slabs_contract_idx
  ON public.source_common_loading_slabs(contract_id, from_value);

CREATE TABLE IF NOT EXISTS public.stock_outward_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outward_number TEXT NOT NULL UNIQUE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  outward_date DATE NOT NULL,
  loading_date DATE NOT NULL,
  loading_amount_received NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (loading_amount_received >= 0),
  source_income_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (source_income_amount >= 0),
  wms_sales_order_id INTEGER,
  wms_sales_order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_outward_receipts_date_idx
  ON public.stock_outward_receipts(outward_date, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS stock_outward_receipts_wms_sales_order_uidx
  ON public.stock_outward_receipts(wms_sales_order_id)
  WHERE wms_sales_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stock_outward_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.stock_outward_receipts(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_outward_sources_unique UNIQUE (receipt_id, source_id)
);
CREATE INDEX IF NOT EXISTS stock_outward_sources_source_idx
  ON public.stock_outward_sources(source_id, receipt_id);

CREATE TABLE IF NOT EXISTS public.stock_outward_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.stock_outward_receipts(id) ON DELETE CASCADE,
  document_no TEXT NOT NULL,
  vehicle_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_outward_documents_no_check CHECK (length(trim(document_no)) > 0),
  CONSTRAINT stock_outward_documents_vehicle_check CHECK (length(trim(vehicle_number)) > 0),
  CONSTRAINT stock_outward_documents_unique UNIQUE (receipt_id, document_no)
);
CREATE INDEX IF NOT EXISTS stock_outward_documents_receipt_idx
  ON public.stock_outward_documents(receipt_id);

CREATE TABLE IF NOT EXISTS public.stock_outward_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.stock_outward_receipts(id) ON DELETE CASCADE,
  package_rate_type_id UUID NOT NULL REFERENCES public.package_rate_types(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  outward_document_id UUID NOT NULL REFERENCES public.stock_outward_documents(id) ON DELETE RESTRICT,
  package_type TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  weight_kg NUMERIC(14,3) NOT NULL CHECK (weight_kg > 0),
  wms_item_id INTEGER,
  sku TEXT,
  item_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_outward_packages_receipt_idx
  ON public.stock_outward_packages(receipt_id, package_rate_type_id);
CREATE INDEX IF NOT EXISTS stock_outward_packages_document_idx
  ON public.stock_outward_packages(outward_document_id);
CREATE INDEX IF NOT EXISTS stock_outward_packages_sku_idx
  ON public.stock_outward_packages(sku);

CREATE OR REPLACE FUNCTION public.validate_stock_outward_package()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_type public.package_rate_types%ROWTYPE;
  v_branch UUID;
BEGIN
  SELECT * INTO v_type FROM public.package_rate_types WHERE id = NEW.package_rate_type_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package type was not found'; END IF;
  SELECT branch_id INTO v_branch FROM public.stock_outward_receipts WHERE id = NEW.receipt_id;
  IF v_branch IS NULL OR v_type.branch_id <> v_branch THEN
    RAISE EXCEPTION 'Package type must belong to the Stock Outward branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.package_rate_entries e
    WHERE e.package_rate_type_id = NEW.package_rate_type_id AND e.rate_kind = 'loading'
  ) THEN
    RAISE EXCEPTION 'Only package types with a Loading Rate can be used for Stock Outward';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_outward_sources s
    WHERE s.receipt_id = NEW.receipt_id AND s.source_id = NEW.source_id
  ) THEN
    RAISE EXCEPTION 'Package source must be one of the sources selected on the Stock Outward receipt';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_outward_documents d
    WHERE d.id = NEW.outward_document_id AND d.receipt_id = NEW.receipt_id
  ) THEN
    RAISE EXCEPTION 'Package Outward Document No. must belong to the same Stock Outward receipt';
  END IF;
  NEW.package_type := v_type.package_type;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS stock_outward_package_validate ON public.stock_outward_packages;
CREATE TRIGGER stock_outward_package_validate
BEFORE INSERT OR UPDATE ON public.stock_outward_packages
FOR EACH ROW EXECUTE FUNCTION public.validate_stock_outward_package();

ALTER TABLE public.source_common_loading_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_outward_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_outward_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_outward_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_outward_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS source_common_loading_slabs_app ON public.source_common_loading_slabs;
CREATE POLICY source_common_loading_slabs_app ON public.source_common_loading_slabs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS stock_outward_receipts_app ON public.stock_outward_receipts;
CREATE POLICY stock_outward_receipts_app ON public.stock_outward_receipts
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS stock_outward_sources_app ON public.stock_outward_sources;
CREATE POLICY stock_outward_sources_app ON public.stock_outward_sources
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS stock_outward_documents_app ON public.stock_outward_documents;
CREATE POLICY stock_outward_documents_app ON public.stock_outward_documents
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS stock_outward_packages_app ON public.stock_outward_packages;
CREATE POLICY stock_outward_packages_app ON public.stock_outward_packages
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_common_loading_slabs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_outward_receipts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_outward_sources TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_outward_documents TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_outward_packages TO anon, authenticated;
GRANT ALL ON public.source_common_loading_slabs TO service_role;
GRANT ALL ON public.stock_outward_receipts TO service_role;
GRANT ALL ON public.stock_outward_sources TO service_role;
GRANT ALL ON public.stock_outward_documents TO service_role;
GRANT ALL ON public.stock_outward_packages TO service_role;

ALTER TABLE public.branch_document_sequences
  DROP CONSTRAINT IF EXISTS branch_document_sequences_document_type_check;
ALTER TABLE public.branch_document_sequences
  ADD CONSTRAINT branch_document_sequences_document_type_check
  CHECK (document_type IN ('trip', 'lr', 'manifest', 'consignment', 'inward_receipt', 'outward_receipt'));

CREATE OR REPLACE FUNCTION public.next_branch_series_number(
  p_branch_id UUID,
  p_document_type TEXT,
  p_prefix TEXT,
  p_series_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := upper(trim(p_prefix));
  v_number INTEGER;
  v_candidate TEXT;
BEGIN
  IF p_document_type NOT IN ('trip', 'lr', 'manifest', 'consignment', 'inward_receipt', 'outward_receipt') THEN
    RAISE EXCEPTION 'Unsupported document type';
  END IF;
  IF v_prefix !~ '^[A-Z0-9]{1,10}$' THEN
    RAISE EXCEPTION 'Series prefix must contain 1 to 10 letters or numbers';
  END IF;
  INSERT INTO public.branch_document_sequences(branch_id, document_type, series_year, last_number)
  VALUES (p_branch_id, p_document_type, p_series_year, 0)
  ON CONFLICT (branch_id, document_type, series_year) DO NOTHING;
  SELECT last_number INTO v_number
  FROM public.branch_document_sequences
  WHERE branch_id = p_branch_id AND document_type = p_document_type AND series_year = p_series_year
  FOR UPDATE;
  LOOP
    v_number := v_number + 1;
    v_candidate := v_prefix || p_series_year::TEXT || LPAD(v_number::TEXT, 6, '0');
    IF p_document_type = 'lr' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lorry_receipts WHERE lr_number = v_candidate);
    ELSIF p_document_type = 'manifest' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.delivery_manifests WHERE manifest_number = v_candidate)
        AND NOT EXISTS (SELECT 1 FROM public.ltms_manifest_transfers WHERE manifest_number = v_candidate);
    ELSIF p_document_type = 'consignment' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.consignments WHERE consignment_number = v_candidate);
    ELSIF p_document_type = 'inward_receipt' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.stock_inward_receipts WHERE receipt_number = v_candidate);
    ELSIF p_document_type = 'outward_receipt' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.stock_outward_receipts WHERE outward_number = v_candidate);
    ELSE
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.trips WHERE trip_code = v_candidate);
    END IF;
  END LOOP;
  UPDATE public.branch_document_sequences
  SET last_number = v_number
  WHERE branch_id = p_branch_id AND document_type = p_document_type AND series_year = p_series_year;
  RETURN v_candidate;
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_branch_series_number(UUID, TEXT, TEXT, INTEGER)
  TO anon, authenticated, service_role;

COMMIT;
