BEGIN;

-- The Consignment RPC receives empty strings for optional numeric E-Way Bill
-- fields. NULLIF prevents PostgreSQL from casting '' to NUMERIC.
CREATE OR REPLACE FUNCTION public.create_consignment_with_shipments(p_consignment JSONB, p_shipments JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c JSONB := coalesce(p_consignment, '{}'::jsonb);
  s JSONB;
  i JSONB;
  v_consign_id UUID;
  v_number TEXT;
  v_shipment_id UUID;
  v_first_from_gstin TEXT := NULL;
  v_first_to_gstin TEXT := NULL;
  v_first_from_pin TEXT := NULL;
  v_first_to_pin TEXT := NULL;
  v_branch_id UUID := NULLIF(c->>'branch_id', '')::UUID;
  v_source_id UUID := NULLIF(c->>'source_id', '')::UUID;
  v_idx INTEGER := 0;
BEGIN
  IF jsonb_array_length(coalesce(p_shipments, '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'At least one shipment is required';
  END IF;
  IF (c->>'consignment_type') NOT IN ('own', 'third_party') THEN
    RAISE EXCEPTION 'Invalid Consignment type';
  END IF;
  IF (c->>'movement_mode') NOT IN ('pickup', 'drop') THEN
    RAISE EXCEPTION 'Invalid movement mode';
  END IF;
  IF (c->>'transport_mode') NOT IN ('Road', 'Rail', 'Air', 'Ship') THEN
    RAISE EXCEPTION 'Invalid transport mode';
  END IF;

  v_number := public.next_branch_series_number(
    v_branch_id,
    'consignment',
    (SELECT lr_series_prefix FROM public.branches WHERE id = v_branch_id),
    EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
  );

  INSERT INTO public.consignments (
    consignment_number, branch_id, source_id, consignment_type, movement_mode, transport_mode,
    vehicle_id, driver_id, transporter_id, from_pin_code, to_pin_code, from_gstin, to_gstin,
    generation_mode, transaction_type, supply_type, sub_supply_type, from_details, to_details, created_by
  ) VALUES (
    v_number, v_branch_id, v_source_id, c->>'consignment_type', c->>'movement_mode', c->>'transport_mode',
    NULLIF(c->>'vehicle_id', '')::UUID, NULLIF(c->>'driver_id', '')::UUID, NULLIF(c->>'transporter_id', '')::UUID,
    coalesce(c->>'from_pin_code', ''), coalesce(c->>'to_pin_code', ''), coalesce(c->>'from_gstin', ''), coalesce(c->>'to_gstin', ''),
    coalesce(c->>'generation_mode', ''), coalesce(c->>'transaction_type', ''), coalesce(c->>'supply_type', ''), coalesce(c->>'sub_supply_type', ''),
    coalesce(c->'from_details', '{}'::jsonb), coalesce(c->'to_details', '{}'::jsonb), NULLIF(c->>'created_by', '')::UUID
  ) RETURNING id INTO v_consign_id;

  FOR s IN SELECT value FROM jsonb_array_elements(p_shipments) LOOP
    v_idx := v_idx + 1;
    IF EXISTS (SELECT 1 FROM public.shipments WHERE eway_bill_number = s->>'eway_bill_number') THEN
      RAISE EXCEPTION 'This E-Way Bill is already used';
    END IF;

    IF v_first_from_gstin IS NULL THEN
      v_first_from_gstin := coalesce(s->>'supplier_gstin', '');
      v_first_to_gstin := coalesce(s->>'recipient_gstin', '');
      v_first_from_pin := coalesce(s->>'dispatch_from_pin_code', '');
      v_first_to_pin := coalesce(s->>'ship_to_pin_code', '');
    ELSIF upper(v_first_from_gstin) <> upper(coalesce(s->>'supplier_gstin', ''))
       OR upper(v_first_to_gstin) <> upper(coalesce(s->>'recipient_gstin', ''))
       OR v_first_from_pin <> coalesce(s->>'dispatch_from_pin_code', '')
       OR v_first_to_pin <> coalesce(s->>'ship_to_pin_code', '') THEN
      RAISE EXCEPTION 'All Consignment shipments must have matching From/To GSTINs and Pincodes';
    END IF;

    INSERT INTO public.shipments (
      branch_id, consignment_id, eway_bill_number, eway_bill_date, eway_bill_status, valid_from, valid_until,
      supply_type, sub_type, sub_supply_desc, generation_mode, document_type, document_number, document_date,
      supplier_gstin, supplier_trade_name, supplier_legal_name, supplier_address, supplier_address_line_1, supplier_address_line_2, supplier_place, supplier_state, supplier_pin_code,
      recipient_gstin, recipient_trade_name, recipient_legal_name, recipient_address, recipient_address_line_1, recipient_address_line_2, recipient_place, recipient_state, recipient_pin_code,
      dispatch_from_address, dispatch_from_address_line_1, dispatch_from_address_line_2, dispatch_from_place, dispatch_from_state, dispatch_from_pin_code,
      ship_to_address, ship_to_address_line_1, ship_to_address_line_2, ship_to_place, ship_to_state, ship_to_pin_code,
      transporter_id, approximate_distance_km, transaction_type, total_value, cgst_value, sgst_value, igst_value, cess_value, cess_non_advol_value, other_value,
      total_taxable_value, total_invoice_value, created_by
    ) VALUES (
      v_branch_id, v_consign_id, s->>'eway_bill_number', NULLIF(s->>'eway_bill_date', '')::DATE,
      coalesce(NULLIF(s->>'eway_bill_status', ''), 'Active'), NULLIF(s->>'valid_from','')::TIMESTAMPTZ, NULLIF(s->>'valid_until','')::TIMESTAMPTZ,
      coalesce(NULLIF(s->>'supply_type',''), 'Outward'), coalesce(NULLIF(s->>'sub_type',''), 'Supply'), coalesce(s->>'sub_supply_desc',''),
      coalesce(s->>'generation_mode',''), coalesce(s->>'document_type',''), s->>'document_number', NULLIF(s->>'document_date', '')::DATE,
      coalesce(s->>'supplier_gstin','URP'), coalesce(s->>'supplier_trade_name',''), coalesce(s->>'supplier_legal_name',''), coalesce(s->>'supplier_address',''), coalesce(s->>'supplier_address_line_1',''), coalesce(s->>'supplier_address_line_2',''), coalesce(s->>'supplier_place',''), coalesce(s->>'supplier_state',''), coalesce(s->>'supplier_pin_code',''),
      coalesce(s->>'recipient_gstin','URP'), coalesce(s->>'recipient_trade_name',''), coalesce(s->>'recipient_legal_name',''), coalesce(s->>'recipient_address',''), coalesce(s->>'recipient_address_line_1',''), coalesce(s->>'recipient_address_line_2',''), coalesce(s->>'recipient_place',''), coalesce(s->>'recipient_state',''), coalesce(s->>'recipient_pin_code',''),
      coalesce(s->>'dispatch_from_address',''), coalesce(s->>'dispatch_from_address_line_1',''), coalesce(s->>'dispatch_from_address_line_2',''), coalesce(s->>'dispatch_from_place',''), coalesce(s->>'dispatch_from_state',''), coalesce(s->>'dispatch_from_pin_code',''),
      coalesce(s->>'ship_to_address',''), coalesce(s->>'ship_to_address_line_1',''), coalesce(s->>'ship_to_address_line_2',''), coalesce(s->>'ship_to_place',''), coalesce(s->>'ship_to_state',''), coalesce(s->>'ship_to_pin_code',''),
      NULLIF(s->>'transporter_id','')::UUID,
      coalesce(NULLIF(s->>'approximate_distance_km','')::NUMERIC, 0), coalesce(s->>'transaction_type',''),
      coalesce(NULLIF(s->>'total_value','')::NUMERIC, 0), coalesce(NULLIF(s->>'cgst_value','')::NUMERIC, 0), coalesce(NULLIF(s->>'sgst_value','')::NUMERIC, 0),
      coalesce(NULLIF(s->>'igst_value','')::NUMERIC, 0), coalesce(NULLIF(s->>'cess_value','')::NUMERIC, 0), coalesce(NULLIF(s->>'cess_non_advol_value','')::NUMERIC, 0),
      coalesce(NULLIF(s->>'other_value','')::NUMERIC, 0), coalesce(NULLIF(s->>'total_taxable_value','')::NUMERIC, 0), coalesce(NULLIF(s->>'total_invoice_value','')::NUMERIC, 0),
      NULLIF(c->>'created_by', '')::UUID
    ) RETURNING id INTO v_shipment_id;

    INSERT INTO public.consignment_shipments(consignment_id, shipment_id)
    VALUES (v_consign_id, v_shipment_id);

    FOR i IN SELECT value FROM jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) LOOP
      INSERT INTO public.shipment_items (
        shipment_id, item_no, product_name, description, hsn_code, quantity, weight_kg, unit,
        taxable_value, cgst_rate, sgst_rate, igst_rate, cess_rate, cess_nonadvol, gst_rate,
        cgst, sgst_utgst, igst, cess, other_tax_charges, total_invoice_value
      ) VALUES (
        v_shipment_id, NULLIF(i->>'item_no','')::INTEGER, coalesce(i->>'product_name',''), coalesce(i->>'description',''), coalesce(i->>'hsn_code',''),
        coalesce(NULLIF(i->>'quantity','')::NUMERIC, 0), coalesce(NULLIF(i->>'weight_kg','')::NUMERIC, 0), coalesce(NULLIF(i->>'unit',''), 'NOS'),
        coalesce(NULLIF(i->>'taxable_value','')::NUMERIC, 0), coalesce(NULLIF(i->>'cgst_rate','')::NUMERIC, 0), coalesce(NULLIF(i->>'sgst_rate','')::NUMERIC, 0),
        coalesce(NULLIF(i->>'igst_rate','')::NUMERIC, 0), coalesce(NULLIF(i->>'cess_rate','')::NUMERIC, 0), coalesce(NULLIF(i->>'cess_nonadvol','')::NUMERIC, 0),
        coalesce(NULLIF(i->>'gst_rate','')::NUMERIC, 0), coalesce(NULLIF(i->>'cgst','')::NUMERIC, 0), coalesce(NULLIF(i->>'sgst_utgst','')::NUMERIC, 0),
        coalesce(NULLIF(i->>'igst','')::NUMERIC, 0), coalesce(NULLIF(i->>'cess','')::NUMERIC, 0), coalesce(NULLIF(i->>'other_tax_charges','')::NUMERIC, 0),
        coalesce(NULLIF(i->>'total_invoice_value','')::NUMERIC, 0)
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('id', v_consign_id, 'consignment_number', v_number, 'shipment_count', v_idx);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_consignment_with_shipments(JSONB, JSONB)
  TO anon, authenticated, service_role;

COMMIT;
