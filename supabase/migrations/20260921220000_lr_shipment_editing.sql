BEGIN;

DROP POLICY IF EXISTS lr_shipments_delete_app ON public.lr_shipments;
CREATE POLICY lr_shipments_delete_app
  ON public.lr_shipments FOR DELETE
  TO anon, authenticated
  USING (true);

GRANT DELETE ON public.lr_shipments TO anon, authenticated;

COMMIT;
