BEGIN;

ALTER TABLE public.stock_inward_receipts
  ADD COLUMN IF NOT EXISTS receipt_number TEXT;

WITH numbered AS (
  SELECT
    id,
    'SI' || EXTRACT(YEAR FROM receipt_date)::TEXT || LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY branch_id, EXTRACT(YEAR FROM receipt_date)
        ORDER BY created_at, id
      )::TEXT,
      6,
      '0'
    ) AS number
  FROM public.stock_inward_receipts
)
UPDATE public.stock_inward_receipts r
SET receipt_number = numbered.number
FROM numbered
WHERE r.id = numbered.id
  AND r.receipt_number IS NULL;

ALTER TABLE public.stock_inward_receipts
  ALTER COLUMN receipt_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_inward_receipts_receipt_number_uidx
  ON public.stock_inward_receipts(receipt_number);

ALTER TABLE public.branch_document_sequences
  DROP CONSTRAINT IF EXISTS branch_document_sequences_document_type_check;
ALTER TABLE public.branch_document_sequences
  ADD CONSTRAINT branch_document_sequences_document_type_check
  CHECK (document_type IN ('trip', 'lr', 'manifest', 'consignment', 'inward_receipt'));

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
  IF p_document_type NOT IN ('trip', 'lr', 'manifest', 'consignment', 'inward_receipt') THEN
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
    ELSE
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.trips WHERE trip_code = v_candidate);
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

GRANT EXECUTE ON FUNCTION public.next_branch_series_number(UUID, TEXT, TEXT, INTEGER)
  TO anon, authenticated, service_role;

COMMIT;
