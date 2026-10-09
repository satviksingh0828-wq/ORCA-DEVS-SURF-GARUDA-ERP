-- WMS Supabase cutover prerequisite (STAGING / REVIEW ONLY)
--
-- This does NOT replace the Render WMS API. It enables RLS on the existing
-- public.wms_* tables and removes direct table privileges from browser roles.
-- No policies are created intentionally: direct anon/authenticated access will
-- be denied until the application has a verified server-side authorization path.
--
-- IMPORTANT: Before applying to any environment, verify the current WMS API's
-- database role. If it is not a BYPASSRLS role/table owner, enabling RLS without
-- policies can break the current API. Test in a non-production project first.
-- The ERP's server-side service-role client is expected to bypass RLS; never put
-- its secret key in browser code. Review SECURITY DEFINER RPC functions separately.
--
-- This script is idempotent. It does not create/alter/drop WMS business tables,
-- change data, or grant browser access.

BEGIN;

DO $wms_rls$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname LIKE 'wms\_%' ESCAPE '\'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', t.table_name);
  END LOOP;
END
$wms_rls$;

COMMIT;
