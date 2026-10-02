BEGIN;

-- The mobile Trip QR updates these rows through the ERP API. Publish the rows
-- so an open TripForm can refresh income, expenditure and hire-charge values live.
DO $$
DECLARE
  finance_table TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOR finance_table IN
      SELECT t.table_name
      FROM (VALUES ('trip_other_income'), ('trip_expenses'), ('approval_charge_advances'))
        AS t(table_name)
      WHERE to_regclass(format('public.%I', t.table_name)) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = t.table_name
        )
    LOOP
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', finance_table);
    END LOOP;
  END IF;
END;
$$;

COMMIT;
