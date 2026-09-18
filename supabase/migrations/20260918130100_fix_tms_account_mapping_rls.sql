BEGIN;

-- The TMS settings screen uses the browser Supabase client, so anon and
-- authenticated roles need the same mapping-table access as HRMS settings.
ALTER TABLE public.tms_account_ledger_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tms_account_ledger_mappings_app_access
  ON public.tms_account_ledger_mappings;
CREATE POLICY tms_account_ledger_mappings_app_access
  ON public.tms_account_ledger_mappings
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE
  ON public.tms_account_ledger_mappings
  TO anon, authenticated;

COMMIT;
