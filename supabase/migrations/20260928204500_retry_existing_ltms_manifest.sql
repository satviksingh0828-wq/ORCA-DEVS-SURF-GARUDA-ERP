-- Retry only failed E-Way Bills on an existing LTMS Manifest.
-- The RPC never creates a second Manifest; it updates the existing transfer items
-- and recalculates the existing Manifest status.
CREATE OR REPLACE FUNCTION public.apply_ltms_manifest_retry(
  p_manifest_id UUID,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id UUID;
  v_transporter_gstin TEXT;
  v_item JSONB;
  v_total INTEGER;
  v_succeeded INTEGER;
  v_status TEXT;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'At least one failed Manifest item is required for retry';
  END IF;

  SELECT branch_id, transporter_gstin
    INTO v_branch_id, v_transporter_gstin
  FROM public.ltms_manifest_transfers
  WHERE id = p_manifest_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Manifest does not exist';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'transfer_status' NOT IN ('transferred', 'failed') THEN
      RAISE EXCEPTION 'Invalid retry transfer status';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.ltms_manifest_transfer_items
      WHERE id = NULLIF(v_item->>'item_id', '')::UUID
        AND manifest_id = p_manifest_id
    ) THEN
      RAISE EXCEPTION 'Retry item does not belong to this Manifest';
    END IF;

    UPDATE public.ltms_manifest_transfer_items
    SET transfer_status = v_item->>'transfer_status',
        transfer_error = CASE
          WHEN v_item->>'transfer_status' = 'transferred' THEN ''
          ELSE coalesce(v_item->>'transfer_error', 'E-Way Bill transporter update failed')
        END
    WHERE id = NULLIF(v_item->>'item_id', '')::UUID
      AND manifest_id = p_manifest_id;

    UPDATE public.shipments
    SET transporter_id = CASE
          WHEN v_item->>'transfer_status' = 'transferred' THEN upper(trim(v_transporter_gstin))
          ELSE transporter_id
        END,
        transporter_update_status = CASE
          WHEN v_item->>'transfer_status' = 'transferred' THEN 'updated'
          ELSE 'failed'
        END,
        transporter_update_error = CASE
          WHEN v_item->>'transfer_status' = 'transferred' THEN ''
          ELSE coalesce(v_item->>'transfer_error', 'E-Way Bill transporter update failed')
        END,
        transporter_updated_at = CASE
          WHEN v_item->>'transfer_status' = 'transferred' THEN now()
          ELSE NULL
        END
    WHERE id = NULLIF(v_item->>'shipment_id', '')::UUID
      AND consignment_id = NULLIF(v_item->>'consignment_id', '')::UUID
      AND branch_id = v_branch_id;
  END LOOP;

  SELECT count(*), count(*) FILTER (WHERE transfer_status = 'transferred')
    INTO v_total, v_succeeded
  FROM public.ltms_manifest_transfer_items
  WHERE manifest_id = p_manifest_id;

  v_status := CASE
    WHEN v_succeeded = v_total THEN 'transferred'
    WHEN v_succeeded > 0 THEN 'partial'
    ELSE 'failed'
  END;

  UPDATE public.consignments AS c
  SET transporter_update_status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.shipments AS s
          WHERE s.consignment_id = c.id AND s.transporter_update_status <> 'updated'
        ) THEN 'updated'
        WHEN EXISTS (
          SELECT 1 FROM public.shipments AS s
          WHERE s.consignment_id = c.id AND s.transporter_update_status = 'updated'
        ) THEN 'partial'
        ELSE 'pending'
      END,
      transporter_update_error = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.shipments AS s
          WHERE s.consignment_id = c.id AND s.transporter_update_status <> 'updated'
        ) THEN ''
        ELSE 'One or more E-Way Bills still need a successful transporter update'
      END,
      transporter_updated_at = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.shipments AS s
          WHERE s.consignment_id = c.id AND s.transporter_update_status <> 'updated'
        ) THEN now()
        ELSE NULL
      END
  WHERE c.id IN (
    SELECT NULLIF(value->>'consignment_id', '')::UUID
    FROM jsonb_array_elements(p_items)
  );

  UPDATE public.ltms_manifest_transfers
  SET transfer_status = v_status
  WHERE id = p_manifest_id;

  RETURN jsonb_build_object(
    'transfer_status', v_status,
    'transferred_count', v_succeeded,
    'eway_bill_count', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ltms_manifest_retry(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ltms_manifest_retry(UUID, JSONB) TO service_role;
