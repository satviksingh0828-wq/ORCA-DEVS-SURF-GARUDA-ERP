BEGIN;

CREATE TABLE IF NOT EXISTS public.ltms_transporters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  transporter_name TEXT NOT NULL,
  legal_business_name TEXT DEFAULT '',
  transporter_type TEXT DEFAULT '',
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
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ltms_transporters_branch_idx ON public.ltms_transporters(branch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ltms_transporters TO anon, authenticated;
GRANT ALL ON public.ltms_transporters TO service_role;
ALTER TABLE public.ltms_transporters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app can manage ltms transporters" ON public.ltms_transporters;
CREATE POLICY "app can manage ltms transporters"
  ON public.ltms_transporters FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_ltms_transporters_updated ON public.ltms_transporters;
CREATE TRIGGER trg_ltms_transporters_updated
  BEFORE UPDATE ON public.ltms_transporters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
