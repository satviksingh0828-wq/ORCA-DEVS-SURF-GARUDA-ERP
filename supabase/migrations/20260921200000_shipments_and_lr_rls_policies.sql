BEGIN;

-- The TMS uses its own app_users session rather than Supabase Auth. These
-- policies match the existing app pattern: authorization is enforced in the
-- application/session layer while RLS permits the database operations.
DROP POLICY IF EXISTS shipments_select_app ON public.shipments;
CREATE POLICY shipments_select_app
  ON public.shipments FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS shipments_insert_app ON public.shipments;
CREATE POLICY shipments_insert_app
  ON public.shipments FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS shipment_items_select_app ON public.shipment_items;
CREATE POLICY shipment_items_select_app
  ON public.shipment_items FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS shipment_items_insert_app ON public.shipment_items;
CREATE POLICY shipment_items_insert_app
  ON public.shipment_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- LR policies are included here as well because the LR migration also enables
-- RLS and the Operations UI reads/writes these tables through the app client.
DROP POLICY IF EXISTS lorry_receipts_select_app ON public.lorry_receipts;
CREATE POLICY lorry_receipts_select_app
  ON public.lorry_receipts FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS lorry_receipts_insert_app ON public.lorry_receipts;
CREATE POLICY lorry_receipts_insert_app
  ON public.lorry_receipts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS lr_shipments_select_app ON public.lr_shipments;
CREATE POLICY lr_shipments_select_app
  ON public.lr_shipments FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS lr_shipments_insert_app ON public.lr_shipments;
CREATE POLICY lr_shipments_insert_app
  ON public.lr_shipments FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

COMMIT;
