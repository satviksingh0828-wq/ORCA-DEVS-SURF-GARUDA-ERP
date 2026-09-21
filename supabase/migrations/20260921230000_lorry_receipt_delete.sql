BEGIN;

DROP POLICY IF EXISTS lorry_receipts_delete_app ON public.lorry_receipts;
CREATE POLICY lorry_receipts_delete_app
  ON public.lorry_receipts FOR DELETE
  TO anon, authenticated
  USING (true);

GRANT DELETE ON public.lorry_receipts TO anon, authenticated;

COMMIT;
