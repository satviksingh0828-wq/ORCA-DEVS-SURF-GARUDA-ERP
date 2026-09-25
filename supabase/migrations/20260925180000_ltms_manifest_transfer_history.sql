BEGIN;

CREATE TABLE IF NOT EXISTS public.ltms_manifest_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  manifest_number TEXT NOT NULL UNIQUE,
  transporter_id UUID REFERENCES public.ltms_transporters(id) ON DELETE SET NULL,
  transporter_name TEXT NOT NULL,
  transporter_gstin TEXT NOT NULL,
  transfer_status TEXT NOT NULL CHECK (transfer_status IN ('transferred', 'partial', 'failed')),
  eway_bill_count INTEGER NOT NULL DEFAULT 0 CHECK (eway_bill_count >= 0),
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ltms_manifest_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id UUID NOT NULL REFERENCES public.ltms_manifest_transfers(id) ON DELETE CASCADE,
  consignment_id UUID REFERENCES public.consignments(id) ON DELETE SET NULL,
  consignment_number TEXT NOT NULL,
  shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
  eway_bill_number TEXT NOT NULL DEFAULT '',
  transfer_status TEXT NOT NULL CHECK (transfer_status IN ('transferred', 'failed')),
  transfer_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ltms_manifest_transfers_branch_created_idx
  ON public.ltms_manifest_transfers(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ltms_manifest_transfers_transporter_idx
  ON public.ltms_manifest_transfers(transporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ltms_manifest_transfer_items_manifest_idx
  ON public.ltms_manifest_transfer_items(manifest_id, created_at);

ALTER TABLE public.ltms_manifest_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltms_manifest_transfer_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ltms_manifest_transfers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ltms_manifest_transfer_items TO anon, authenticated;
GRANT ALL ON public.ltms_manifest_transfers TO service_role;
GRANT ALL ON public.ltms_manifest_transfer_items TO service_role;
DROP POLICY IF EXISTS ltms_manifest_transfers_app ON public.ltms_manifest_transfers;
CREATE POLICY ltms_manifest_transfers_app ON public.ltms_manifest_transfers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ltms_manifest_transfer_items_app ON public.ltms_manifest_transfer_items;
CREATE POLICY ltms_manifest_transfer_items_app ON public.ltms_manifest_transfer_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Include both TMS and LTMS manifest tables in collision checks. The document
-- sequence row lock is shared so numbers cannot collide across either workflow.
CREATE OR REPLACE FUNCTION public.next_branch_series_number(
  p_branch_id UUID,
  p_document_type TEXT,
  p_prefix TEXT,
  p_series_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix TEXT := upper(trim(p_prefix));
  v_number INTEGER;
  v_candidate TEXT;
BEGIN
  IF p_document_type NOT IN ('trip', 'lr', 'manifest', 'consignment') THEN
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
    v_candidate := v_prefix || p_series_year::TEXT || lpad(v_number::TEXT, 6, '0');
    IF p_document_type = 'lr' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lorry_receipts WHERE lr_number = v_candidate);
    ELSIF p_document_type = 'manifest' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.delivery_manifests WHERE manifest_number = v_candidate)
        AND NOT EXISTS (SELECT 1 FROM public.ltms_manifest_transfers WHERE manifest_number = v_candidate);
    ELSIF p_document_type = 'consignment' THEN
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.consignments WHERE consignment_number = v_candidate);
    ELSE
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.trips WHERE trip_code = v_candidate)
        AND NOT EXISTS (SELECT 1 FROM public.closed_trips WHERE trip_code = v_candidate);
    END IF;
  END LOOP;
  UPDATE public.branch_document_sequences SET last_number = v_number
  WHERE branch_id = p_branch_id AND document_type = p_document_type AND series_year = p_series_year;
  RETURN v_candidate;
END; $$;
GRANT EXECUTE ON FUNCTION public.next_branch_series_number(UUID, TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_ltms_manifest_transfer(
  p_branch_id UUID,
  p_transporter_id UUID,
  p_transporter_name TEXT,
  p_transporter_gstin TEXT,
  p_created_by UUID,
  p_items JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prefix TEXT;
  v_manifest_number TEXT;
  v_manifest_id UUID;
  v_total INTEGER;
  v_attempted INTEGER;
  v_succeeded INTEGER;
  v_status TEXT;
  v_updated_rows INTEGER;
  v_item JSONB;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'At least one E-Way Bill transfer result is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'Branch does not exist';
  END IF;
  IF p_transporter_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ltms_transporters WHERE id = p_transporter_id) THEN
    RAISE EXCEPTION 'Selected transporter does not exist';
  END IF;
  SELECT coalesce(nullif(trim(manifest_series_prefix), ''), 'MF') INTO v_prefix
  FROM public.branches WHERE id = p_branch_id;
  v_manifest_number := public.next_branch_series_number(p_branch_id, 'manifest', v_prefix, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER);
  SELECT count(*),
         count(*) FILTER (WHERE trim(coalesce(value->>'eway_bill_number', '')) <> ''),
         count(*) FILTER (WHERE value->>'transfer_status' = 'transferred')
  INTO v_attempted, v_total, v_succeeded FROM jsonb_array_elements(p_items);
  v_status := CASE WHEN v_succeeded = v_attempted THEN 'transferred' WHEN v_succeeded > 0 THEN 'partial' ELSE 'failed' END;

  INSERT INTO public.ltms_manifest_transfers (
    branch_id, manifest_number, transporter_id, transporter_name, transporter_gstin,
    transfer_status, eway_bill_count, created_by
  ) VALUES (
    p_branch_id, v_manifest_number, p_transporter_id, trim(p_transporter_name), upper(trim(p_transporter_gstin)),
    v_status, v_total, p_created_by
  ) RETURNING id INTO v_manifest_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.shipments AS s
      WHERE s.id = NULLIF(v_item->>'shipment_id', '')::UUID
        AND s.consignment_id = NULLIF(v_item->>'consignment_id', '')::UUID
        AND s.branch_id = p_branch_id
    ) THEN
      RAISE EXCEPTION 'Shipment % no longer belongs to the selected consignment and branch', v_item->>'shipment_id';
    END IF;
    IF v_item->>'transfer_status' = 'transferred' AND length(trim(coalesce(v_item->>'eway_bill_number', ''))) <> 12 THEN
      RAISE EXCEPTION 'A successful transfer must include a valid E-Way Bill number';
    END IF;
    INSERT INTO public.ltms_manifest_transfer_items (
      manifest_id, consignment_id, consignment_number, shipment_id, eway_bill_number, transfer_status, transfer_error
    ) VALUES (
      v_manifest_id,
      NULLIF(v_item->>'consignment_id', '')::UUID,
      v_item->>'consignment_number',
      NULLIF(v_item->>'shipment_id', '')::UUID,
      coalesce(v_item->>'eway_bill_number', ''),
      v_item->>'transfer_status',
      coalesce(v_item->>'transfer_error', '')
    );
    UPDATE public.shipments
    SET transporter_id = CASE WHEN v_item->>'transfer_status' = 'transferred' THEN upper(trim(p_transporter_gstin)) ELSE transporter_id END,
        transporter_update_status = CASE WHEN v_item->>'transfer_status' = 'transferred' THEN 'updated' ELSE 'failed' END,
        transporter_update_error = CASE WHEN v_item->>'transfer_status' = 'transferred' THEN '' ELSE coalesce(v_item->>'transfer_error', 'E-Way Bill transporter update failed') END,
        transporter_updated_at = CASE WHEN v_item->>'transfer_status' = 'transferred' THEN now() ELSE NULL END
    WHERE id = NULLIF(v_item->>'shipment_id', '')::UUID
      AND consignment_id = NULLIF(v_item->>'consignment_id', '')::UUID
      AND branch_id = p_branch_id;
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
      RAISE EXCEPTION 'Could not persist transporter status for shipment %', v_item->>'shipment_id';
    END IF;
  END LOOP;

  UPDATE public.consignments AS c
  SET transporter_id = coalesce(p_transporter_id, c.transporter_id),
      transporter_update_status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.shipments AS s WHERE s.consignment_id = c.id AND s.transporter_update_status <> 'updated') THEN 'updated'
        WHEN EXISTS (SELECT 1 FROM public.shipments AS s WHERE s.consignment_id = c.id AND s.transporter_update_status = 'updated') THEN 'partial'
        ELSE 'pending'
      END,
      transporter_update_error = CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.shipments AS s WHERE s.consignment_id = c.id AND s.transporter_update_status <> 'updated') THEN ''
        ELSE 'One or more E-Way Bills still need a successful transporter update'
      END,
      transporter_updated_at = CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.shipments AS s WHERE s.consignment_id = c.id AND s.transporter_update_status <> 'updated') THEN now()
        ELSE NULL
      END
  WHERE c.id IN (SELECT NULLIF(value->>'consignment_id', '')::UUID FROM jsonb_array_elements(p_items));

  RETURN jsonb_build_object(
    'id', v_manifest_id,
    'manifest_number', v_manifest_number,
    'transfer_status', v_status,
    'eway_bill_count', v_total,
    'transferred_count', v_succeeded
  );
END; $$;

REVOKE ALL ON FUNCTION public.record_ltms_manifest_transfer(UUID, UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ltms_manifest_transfer(UUID, UUID, TEXT, TEXT, UUID, JSONB) TO service_role;

COMMIT;
