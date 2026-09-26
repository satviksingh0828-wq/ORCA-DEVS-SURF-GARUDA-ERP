BEGIN;

CREATE TABLE IF NOT EXISTS public.party_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type TEXT NOT NULL CHECK (party_type IN ('consignor', 'consignee')),
  gstin TEXT NOT NULL,
  trade_name TEXT NOT NULL DEFAULT '',
  legal_name TEXT NOT NULL DEFAULT '',
  address_1 TEXT NOT NULL DEFAULT '',
  address_2 TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  pincode TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'eway_bill')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (party_type, gstin)
);
CREATE INDEX IF NOT EXISTS party_masters_gstin_idx ON public.party_masters (gstin);
CREATE INDEX IF NOT EXISTS party_masters_type_updated_idx ON public.party_masters (party_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hsn_code TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'NOS',
  default_quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  default_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_name_idx ON public.products (lower(product_name));

CREATE OR REPLACE FUNCTION public.touch_party_product_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS party_masters_updated_at ON public.party_masters;
CREATE TRIGGER party_masters_updated_at BEFORE UPDATE ON public.party_masters FOR EACH ROW EXECUTE FUNCTION public.touch_party_product_updated_at();
DROP TRIGGER IF EXISTS products_updated_at ON public.products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_party_product_updated_at();

ALTER TABLE public.party_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS party_masters_app ON public.party_masters;
CREATE POLICY party_masters_app ON public.party_masters FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS products_app ON public.products;
CREATE POLICY products_app ON public.products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_masters TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT ALL ON public.party_masters, public.products TO service_role;

COMMIT;
