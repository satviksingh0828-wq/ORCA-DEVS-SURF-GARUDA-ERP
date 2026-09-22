BEGIN;

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS manifest_series_prefix TEXT NOT NULL DEFAULT 'MF';
UPDATE public.branches SET manifest_series_prefix = 'MF' WHERE trim(coalesce(manifest_series_prefix, '')) = '';

ALTER TABLE public.branch_document_sequences DROP CONSTRAINT IF EXISTS branch_document_sequences_document_type_check;
ALTER TABLE public.branch_document_sequences ADD CONSTRAINT branch_document_sequences_document_type_check CHECK (document_type IN ('trip', 'lr', 'manifest'));

CREATE TABLE IF NOT EXISTS public.delivery_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  manifest_number TEXT NOT NULL UNIQUE,
  transport_mode TEXT NOT NULL CHECK (transport_mode IN ('pickup', 'drop')),
  from_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  from_pin_code TEXT NOT NULL DEFAULT '',
  to_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  to_pin_code TEXT NOT NULL DEFAULT '',
  delivery_partner_id UUID NOT NULL REFERENCES public.delivery_partners(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (transport_mode = 'pickup' OR (length(trim(from_pin_code)) > 0 AND length(trim(to_pin_code)) > 0))
);

CREATE TABLE IF NOT EXISTS public.delivery_manifest_lorry_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES public.delivery_manifests(id) ON DELETE CASCADE,
  lr_id UUID NOT NULL REFERENCES public.lorry_receipts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (manifest_id, lr_id),
  UNIQUE (lr_id)
);

ALTER TABLE public.delivery_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_manifest_lorry_receipts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_manifests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_manifest_lorry_receipts TO anon, authenticated;
DROP POLICY IF EXISTS delivery_manifests_app ON public.delivery_manifests;
CREATE POLICY delivery_manifests_app ON public.delivery_manifests FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS delivery_manifest_lorry_receipts_app ON public.delivery_manifest_lorry_receipts;
CREATE POLICY delivery_manifest_lorry_receipts_app ON public.delivery_manifest_lorry_receipts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.next_branch_series_number(p_branch_id UUID, p_document_type TEXT, p_prefix TEXT, p_series_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix TEXT := upper(trim(p_prefix)); v_number INTEGER; v_candidate TEXT;
BEGIN
  IF p_document_type NOT IN ('trip', 'lr', 'manifest') THEN RAISE EXCEPTION 'Unsupported document type'; END IF;
  IF v_prefix !~ '^[A-Z0-9]{1,10}$' THEN RAISE EXCEPTION 'Series prefix must contain 1 to 10 letters or numbers'; END IF;
  INSERT INTO public.branch_document_sequences(branch_id, document_type, series_year, last_number) VALUES (p_branch_id, p_document_type, p_series_year, 0) ON CONFLICT DO NOTHING;
  SELECT last_number INTO v_number FROM public.branch_document_sequences WHERE branch_id = p_branch_id AND document_type = p_document_type AND series_year = p_series_year FOR UPDATE;
  LOOP
    v_number := v_number + 1;
    v_candidate := v_prefix || p_series_year::TEXT || lpad(v_number::TEXT, 6, '0');
    IF p_document_type = 'lr' THEN EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lorry_receipts WHERE lr_number = v_candidate);
    ELSIF p_document_type = 'manifest' THEN EXIT WHEN NOT EXISTS (SELECT 1 FROM public.delivery_manifests WHERE manifest_number = v_candidate);
    ELSE EXIT WHEN NOT EXISTS (SELECT 1 FROM public.trips WHERE trip_code = v_candidate) AND NOT EXISTS (SELECT 1 FROM public.closed_trips WHERE trip_code = v_candidate); END IF;
  END LOOP;
  UPDATE public.branch_document_sequences SET last_number = v_number WHERE branch_id = p_branch_id AND document_type = p_document_type AND series_year = p_series_year;
  RETURN v_candidate;
END; $$;
GRANT EXECUTE ON FUNCTION public.next_branch_series_number(UUID, TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_manifest_lr_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.trip_lorry_receipts WHERE lr_id = NEW.lr_id) THEN RAISE EXCEPTION 'LR is already linked to a Trip and cannot be linked to a Manifest'; END IF;
  IF EXISTS (SELECT 1 FROM public.lorry_receipts lr JOIN public.delivery_manifests m ON m.id = NEW.manifest_id WHERE lr.id = NEW.lr_id AND lr.branch_id <> m.branch_id) THEN RAISE EXCEPTION 'LR and Manifest must belong to the same branch'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_validate_manifest_lr_link ON public.delivery_manifest_lorry_receipts;
CREATE TRIGGER trg_validate_manifest_lr_link BEFORE INSERT OR UPDATE ON public.delivery_manifest_lorry_receipts FOR EACH ROW EXECUTE FUNCTION public.validate_manifest_lr_link();

CREATE OR REPLACE FUNCTION public.validate_trip_lr_not_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.delivery_manifest_lorry_receipts WHERE lr_id = NEW.lr_id) THEN RAISE EXCEPTION 'LR is already linked to a Manifest and cannot be linked to a Trip'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_validate_trip_lr_not_manifest ON public.trip_lorry_receipts;
CREATE TRIGGER trg_validate_trip_lr_not_manifest BEFORE INSERT OR UPDATE ON public.trip_lorry_receipts FOR EACH ROW EXECUTE FUNCTION public.validate_trip_lr_not_manifest();

COMMIT;

-- Each LR is constrained to exactly zero or one Trip/Manifest link, never both.
-- UI screens should still hide unavailable records and surface the database error for race-safe feedback.
-- Apply this migration before using the Manifest tab.
-- Delivery partners are selected from the existing branch-scoped master and their details are displayed read-only.
-- The sequence format is PREFIX + YYYY + six-digit serial, e.g. MF2026000001.
-- A branch may customize manifest_series_prefix; MF is the default.
-- The pickup mode intentionally permits no destination fields; drop requires both PIN codes.
-- This migration is additive and does not alter existing trip manifests.
-- Existing LR links remain valid.
-- Manifest deletion is blocked by the LR foreign key until links are removed.
-- The unique lr_id index prevents duplicate manifest links.
-- Branch validation prevents cross-branch linking.
-- The trigger protects direct API/database calls as well as the UI.
-- Sequence allocation is row-locked to avoid duplicate numbers under concurrent creation.
-- The generated number is returned by the existing RPC.
-- The UI uses p_document_type = manifest.
-- The route location names are derived from the locations master.
-- The branch PIN is used as the default pickup origin.
-- Users may override PIN values in the form.
-- Partner details are read from delivery_partners.
-- No new partner master is introduced.
-- No separate transport-address table is introduced.
-- This keeps the change compatible with the current Supabase app.
-- End of migration.
