BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS trip_series_prefix TEXT NOT NULL DEFAULT 'TR',
  ADD COLUMN IF NOT EXISTS lr_series_prefix TEXT NOT NULL DEFAULT 'LR';

UPDATE public.branches
SET trip_series_prefix = 'TR'
WHERE trim(coalesce(trip_series_prefix, '')) = '';

UPDATE public.branches
SET lr_series_prefix = 'LR'
WHERE trim(coalesce(lr_series_prefix, '')) = '';

ALTER TABLE public.lorry_receipts
  DROP CONSTRAINT IF EXISTS lorry_receipts_lr_number_check;

ALTER TABLE public.lorry_receipts
  ADD CONSTRAINT lorry_receipts_lr_number_check
  CHECK (lr_number ~ '^[A-Z0-9]+[0-9]{10}$');

ALTER TABLE public.lorry_receipts
  ALTER COLUMN lr_number DROP DEFAULT;

CREATE TABLE IF NOT EXISTS public.branch_document_sequences (
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('trip', 'lr')),
  series_year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (branch_id, document_type, series_year)
);

ALTER TABLE public.branch_document_sequences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.branch_document_sequences TO anon, authenticated;
GRANT ALL ON public.branch_document_sequences TO service_role;
DROP POLICY IF EXISTS branch_document_sequences_app ON public.branch_document_sequences;
CREATE POLICY branch_document_sequences_app
  ON public.branch_document_sequences FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

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
  IF p_document_type NOT IN ('trip', 'lr') THEN
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
  WHERE branch_id = p_branch_id
    AND document_type = p_document_type
    AND series_year = p_series_year
  FOR UPDATE;

  LOOP
    v_number := v_number + 1;
    v_candidate := v_prefix || p_series_year::TEXT || lpad(v_number::TEXT, 6, '0');
    IF p_document_type = 'lr' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lorry_receipts WHERE lr_number = v_candidate);
    ELSE
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.trips WHERE trip_code = v_candidate)
        AND NOT EXISTS (SELECT 1 FROM public.closed_trips WHERE trip_code = v_candidate);
    END IF;
  END LOOP;

  UPDATE public.branch_document_sequences
  SET last_number = v_number
  WHERE branch_id = p_branch_id
    AND document_type = p_document_type
    AND series_year = p_series_year;
  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_branch_series_number(UUID, TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;

COMMIT;
