BEGIN;

-- Shipments remain editable until the first LR link is created. Once linked,
-- the row is immutable so the LR always references the exact shipment details.
CREATE OR REPLACE FUNCTION public.prevent_linked_shipment_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lr_shipments WHERE shipment_id = OLD.id) THEN
    RAISE EXCEPTION 'Shipment is assigned to an LR and can no longer be edited';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_linked_shipment_update ON public.shipments;
CREATE TRIGGER trg_prevent_linked_shipment_update
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_linked_shipment_update();

DROP POLICY IF EXISTS shipments_update_app ON public.shipments;
CREATE POLICY shipments_update_app
  ON public.shipments FOR UPDATE
  TO anon, authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.lr_shipments WHERE shipment_id = id))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.lr_shipments WHERE shipment_id = id));

DROP POLICY IF EXISTS shipment_items_delete_app ON public.shipment_items;
CREATE POLICY shipment_items_delete_app
  ON public.shipment_items FOR DELETE
  TO anon, authenticated
  USING (NOT EXISTS (SELECT 1 FROM public.lr_shipments WHERE shipment_id = shipment_items.shipment_id));

GRANT UPDATE ON public.shipments TO anon, authenticated;
GRANT DELETE ON public.shipment_items TO anon, authenticated;

COMMIT;

BEGIN;
DROP POLICY IF EXISTS lorry_receipts_update_app ON public.lorry_receipts;
CREATE POLICY lorry_receipts_update_app
  ON public.lorry_receipts FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
GRANT UPDATE ON public.lorry_receipts TO anon, authenticated;
COMMIT;
