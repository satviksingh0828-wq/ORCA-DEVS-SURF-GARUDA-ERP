BEGIN;

CREATE TABLE IF NOT EXISTS public.rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  rental_name TEXT NOT NULL,
  legal_business_name TEXT DEFAULT '',
  rental_type TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  pan TEXT DEFAULT '',
  msme_udyam TEXT DEFAULT '',
  tan TEXT DEFAULT '',
  address_line1 TEXT DEFAULT '',
  address_line2 TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  country TEXT DEFAULT '',
  pin_code TEXT DEFAULT '',
  primary_contact_name TEXT DEFAULT '',
  primary_contact_designation TEXT DEFAULT '',
  mobile_number TEXT DEFAULT '',
  alternate_mobile TEXT DEFAULT '',
  email TEXT DEFAULT '',
  telephone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  bank_branch TEXT DEFAULT '',
  bank_account_holder TEXT DEFAULT '',
  bank_account_number TEXT DEFAULT '',
  bank_ifsc TEXT DEFAULT '',
  upi_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rentals_branch_idx ON public.rentals(branch_id);
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rentals TO anon, authenticated;
GRANT ALL ON public.rentals TO service_role;
DROP POLICY IF EXISTS rentals_app ON public.rentals;
CREATE POLICY rentals_app ON public.rentals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_rentals_updated ON public.rentals;
CREATE TRIGGER trg_rentals_updated BEFORE UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS own_transport_mode TEXT NOT NULL DEFAULT 'own_vehicle' CHECK (own_transport_mode IN ('own_vehicle', 'rental')),
  ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.preview_branch_series_number(
  p_branch_id UUID,
  p_document_type TEXT,
  p_prefix TEXT,
  p_series_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_number INTEGER;
  v_candidate TEXT;
BEGIN
  SELECT COALESCE(last_number, 0) INTO v_number
  FROM public.branch_document_sequences
  WHERE branch_id = p_branch_id AND document_type = p_document_type AND series_year = p_series_year;
  v_number := COALESCE(v_number, 0) + 1;
  v_candidate := upper(trim(p_prefix)) || p_series_year::TEXT || lpad(v_number::TEXT, 6, '0');
  RETURN v_candidate;
END; $$;
GRANT EXECUTE ON FUNCTION public.preview_branch_series_number(UUID, TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;

COMMIT;
