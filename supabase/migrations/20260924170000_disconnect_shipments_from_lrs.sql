BEGIN;

-- Existing Shipment records are no longer owned by an LR from the Shipment module.
-- Remove historical junction rows so those shipments can be deleted independently.
DELETE FROM public.lr_shipments;

-- If a shipment is deleted, keep the LR record but clear its optional base shipment.
ALTER TABLE public.lorry_receipts
  ALTER COLUMN base_shipment_id DROP NOT NULL;

ALTER TABLE public.lorry_receipts
  DROP CONSTRAINT IF EXISTS lorry_receipts_base_shipment_id_fkey;

ALTER TABLE public.lorry_receipts
  ADD CONSTRAINT lorry_receipts_base_shipment_id_fkey
  FOREIGN KEY (base_shipment_id)
  REFERENCES public.shipments(id)
  ON DELETE SET NULL;

-- Any remaining/future junction row must disappear automatically with its shipment.
ALTER TABLE public.lr_shipments
  DROP CONSTRAINT IF EXISTS lr_shipments_shipment_id_fkey;

ALTER TABLE public.lr_shipments
  ADD CONSTRAINT lr_shipments_shipment_id_fkey
  FOREIGN KEY (shipment_id)
  REFERENCES public.shipments(id)
  ON DELETE CASCADE;

-- Do not block Shipment deletion based on an LR junction row.
DROP POLICY IF EXISTS shipments_delete_app ON public.shipments;
CREATE POLICY shipments_delete_app
  ON public.shipments FOR DELETE
  TO anon, authenticated
  USING (true);

GRANT DELETE ON public.shipments TO anon, authenticated;
GRANT DELETE ON public.lr_shipments TO anon, authenticated;

COMMIT;
