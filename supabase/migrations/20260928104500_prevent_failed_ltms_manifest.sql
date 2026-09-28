-- Do not create an LTMS Manifest when every selected E-Way Bill transfer fails.
DROP FUNCTION IF EXISTS public.record_ltms_manifest_transfer(UUID, DATE, UUID, TEXT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.record_ltms_manifest_transfer(
  p_branch_id UUID,
  p_manifest_date DATE,
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
  SELECT count(*),
         count(*) FILTER (WHERE trim(coalesce(value->>'eway_bill_number', '')) <> ''),
         count(*) FILTER (WHERE value->>'transfer_status' = 'transferred')
  INTO v_attempted, v_total, v_succeeded FROM jsonb_array_elements(p_items);
  v_status := CASE WHEN v_succeeded = v_attempted THEN 'transferred' WHEN v_succeeded > 0 THEN 'partial' ELSE 'failed' END;
  IF v_status = 'failed' THEN
    RAISE EXCEPTION 'No Manifest created: all selected E-Way Bill transfers failed';
  END IF;
  v_manifest_number := public.next_branch_series_number(p_branch_id, 'manifest', v_prefix, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER);

  INSERT INTO public.ltms_manifest_transfers (
    branch_id, manifest_date, manifest_number, transporter_id, transporter_name, transporter_gstin,
    transfer_status, eway_bill_count, created_by
  ) VALUES (
    p_branch_id, p_manifest_date, v_manifest_number, p_transporter_id, trim(p_transporter_name), upper(trim(p_transporter_gstin)),
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

REVOKE ALL ON FUNCTION public.record_ltms_manifest_transfer(UUID, DATE, UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ltms_manifest_transfer(UUID, DATE, UUID, TEXT, TEXT, UUID, JSONB) TO service_role;
