BEGIN;

ALTER TABLE public.branch_document_sequences
  DROP CONSTRAINT IF EXISTS branch_document_sequences_document_type_check;
ALTER TABLE public.branch_document_sequences
  ADD CONSTRAINT branch_document_sequences_document_type_check
  CHECK (document_type IN ('trip', 'lr', 'manifest', 'consignment'));

CREATE TABLE IF NOT EXISTS public.consignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL DEFAULT 'Consignment' CHECK (document_type = 'Consignment'),
  consignment_number TEXT NOT NULL UNIQUE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  source_id UUID REFERENCES public.contracts(id) ON DELETE RESTRICT,
  consignment_type TEXT NOT NULL CHECK (consignment_type IN ('own', 'third_party')),
  movement_mode TEXT NOT NULL CHECK (movement_mode IN ('pickup', 'drop')),
  transport_mode TEXT NOT NULL DEFAULT 'Road' CHECK (transport_mode IN ('Road', 'Rail', 'Air', 'Ship')),
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  transporter_id UUID REFERENCES public.ltms_transporters(id) ON DELETE SET NULL,
  from_pin_code TEXT NOT NULL DEFAULT '',
  to_pin_code TEXT NOT NULL DEFAULT '',
  from_gstin TEXT NOT NULL DEFAULT '',
  to_gstin TEXT NOT NULL DEFAULT '',
  generation_mode TEXT NOT NULL DEFAULT '',
  transaction_type TEXT NOT NULL DEFAULT '',
  supply_type TEXT NOT NULL DEFAULT '',
  sub_supply_type TEXT NOT NULL DEFAULT '',
  from_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  to_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS consignment_id UUID REFERENCES public.consignments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.consignment_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID NOT NULL REFERENCES public.consignments(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consignments_branch_created_idx ON public.consignments(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shipments_consignment_idx ON public.shipments(consignment_id);

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
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.delivery_manifests WHERE manifest_number = v_candidate);
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

CREATE OR REPLACE FUNCTION public.create_consignment_with_shipments(p_consignment JSONB, p_shipments JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  v_branch_id UUID := (c->>'branch_id')::UUID;
  v_source_id UUID := NULLIF(c->>'source_id', '')::UUID;
  v_idx INTEGER := 0;
BEGIN
  IF jsonb_array_length(coalesce(p_shipments, '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'At least one shipment is required';
  END IF;
  IF (c->>'consignment_type') NOT IN ('own', 'third_party') THEN RAISE EXCEPTION 'Invalid Consignment type'; END IF;
  IF (c->>'movement_mode') NOT IN ('pickup', 'drop') THEN RAISE EXCEPTION 'Invalid movement mode'; END IF;
  IF (c->>'transport_mode') NOT IN ('Road', 'Rail', 'Air', 'Ship') THEN RAISE EXCEPTION 'Invalid transport mode'; END IF;

  v_number := public.next_branch_series_number(
    v_branch_id, 'consignment', (SELECT lr_series_prefix FROM public.branches WHERE id = v_branch_id), EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
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
      v_branch_id, v_consign_id, s->>'eway_bill_number', (s->>'eway_bill_date')::DATE, coalesce(s->>'eway_bill_status', 'Active'), NULLIF(s->>'valid_from','')::TIMESTAMPTZ, NULLIF(s->>'valid_until','')::TIMESTAMPTZ,
      coalesce(s->>'supply_type','Outward'), coalesce(s->>'sub_type','Supply'), coalesce(s->>'sub_supply_desc',''), coalesce(s->>'generation_mode',''), coalesce(s->>'document_type',''), s->>'document_number', (s->>'document_date')::DATE,
      coalesce(s->>'supplier_gstin','URP'), coalesce(s->>'supplier_trade_name',''), coalesce(s->>'supplier_legal_name',''), coalesce(s->>'supplier_address',''), coalesce(s->>'supplier_address_line_1',''), coalesce(s->>'supplier_address_line_2',''), coalesce(s->>'supplier_place',''), coalesce(s->>'supplier_state',''), coalesce(s->>'supplier_pin_code',''),
      coalesce(s->>'recipient_gstin','URP'), coalesce(s->>'recipient_trade_name',''), coalesce(s->>'recipient_legal_name',''), coalesce(s->>'recipient_address',''), coalesce(s->>'recipient_address_line_1',''), coalesce(s->>'recipient_address_line_2',''), coalesce(s->>'recipient_place',''), coalesce(s->>'recipient_state',''), coalesce(s->>'recipient_pin_code',''),
      coalesce(s->>'dispatch_from_address',''), coalesce(s->>'dispatch_from_address_line_1',''), coalesce(s->>'dispatch_from_address_line_2',''), coalesce(s->>'dispatch_from_place',''), coalesce(s->>'dispatch_from_state',''), coalesce(s->>'dispatch_from_pin_code',''),
      coalesce(s->>'ship_to_address',''), coalesce(s->>'ship_to_address_line_1',''), coalesce(s->>'ship_to_address_line_2',''), coalesce(s->>'ship_to_place',''), coalesce(s->>'ship_to_state',''), coalesce(s->>'ship_to_pin_code',''),
      coalesce(s->>'transporter_id',''), coalesce((s->>'approximate_distance_km')::NUMERIC, 0), coalesce(s->>'transaction_type',''), coalesce((s->>'total_value')::NUMERIC,0), coalesce((s->>'cgst_value')::NUMERIC,0), coalesce((s->>'sgst_value')::NUMERIC,0), coalesce((s->>'igst_value')::NUMERIC,0), coalesce((s->>'cess_value')::NUMERIC,0), coalesce((s->>'cess_non_advol_value')::NUMERIC,0), coalesce((s->>'other_value')::NUMERIC,0), coalesce((s->>'total_taxable_value')::NUMERIC,0), coalesce((s->>'total_invoice_value')::NUMERIC,0), NULLIF(c->>'created_by', '')::UUID
    ) RETURNING id INTO v_shipment_id;

    INSERT INTO public.consignment_shipments(consignment_id, shipment_id) VALUES (v_consign_id, v_shipment_id);
    FOR i IN SELECT value FROM jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) LOOP
      INSERT INTO public.shipment_items (shipment_id, item_no, product_name, description, hsn_code, quantity, weight_kg, unit, taxable_value, cgst_rate, sgst_rate, igst_rate, cess_rate, cess_nonadvol, gst_rate, cgst, sgst_utgst, igst, cess, other_tax_charges, total_invoice_value)
      VALUES (v_shipment_id, (i->>'item_no')::INTEGER, coalesce(i->>'product_name',''), coalesce(i->>'description',''), coalesce(i->>'hsn_code',''), coalesce((i->>'quantity')::NUMERIC,0), coalesce((i->>'weight_kg')::NUMERIC,0), coalesce(i->>'unit','NOS'), coalesce((i->>'taxable_value')::NUMERIC,0), coalesce((i->>'cgst_rate')::NUMERIC,0), coalesce((i->>'sgst_rate')::NUMERIC,0), coalesce((i->>'igst_rate')::NUMERIC,0), coalesce((i->>'cess_rate')::NUMERIC,0), coalesce((i->>'cess_nonadvol')::NUMERIC,0), coalesce((i->>'gst_rate')::NUMERIC,0), coalesce((i->>'cgst')::NUMERIC,0), coalesce((i->>'sgst_utgst')::NUMERIC,0), coalesce((i->>'igst')::NUMERIC,0), coalesce((i->>'cess')::NUMERIC,0), coalesce((i->>'other_tax_charges')::NUMERIC,0), coalesce((i->>'total_invoice_value')::NUMERIC,0));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('id', v_consign_id, 'consignment_number', v_number, 'shipment_count', v_idx);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_consignment_with_shipments(JSONB, JSONB) TO anon, authenticated, service_role;

ALTER TABLE public.consignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consignment_shipments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consignments_app ON public.consignments;
CREATE POLICY consignments_app ON public.consignments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS consignment_shipments_app ON public.consignment_shipments;
CREATE POLICY consignment_shipments_app ON public.consignment_shipments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, DELETE ON public.consignments TO anon, authenticated;
GRANT SELECT, DELETE ON public.consignment_shipments TO anon, authenticated;

DROP POLICY IF EXISTS shipments_insert_app ON public.shipments;
CREATE POLICY shipments_insert_app ON public.shipments FOR INSERT TO anon, authenticated WITH CHECK (consignment_id IS NOT NULL);
DROP POLICY IF EXISTS shipments_update_app ON public.shipments;
CREATE POLICY shipments_update_app ON public.shipments FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS shipments_delete_app ON public.shipments;
CREATE POLICY shipments_delete_app ON public.shipments FOR DELETE TO anon, authenticated USING (false);
DROP POLICY IF EXISTS shipment_items_delete_app ON public.shipment_items;
CREATE POLICY shipment_items_delete_app ON public.shipment_items FOR DELETE TO anon, authenticated USING (false);
GRANT DELETE ON public.consignments TO anon, authenticated;

COMMIT;
