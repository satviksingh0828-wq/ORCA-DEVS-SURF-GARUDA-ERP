-- Restore archived trips and repair Fastag data before any legacy-table removal.
--
-- This recovers the data captured by the old close-trip workflow into public.trips:
--   trips, trip_manifests, trip_other_income, trip_expenses,
--   approval_charge_advances, payment_ledger_id values, and Fastag deductions.
-- Restored trips are deliberately marked closed = true, matching the corrected
-- Close Trip behavior. The legacy archive row is removed after each successful
-- restore by reopen_trip_atomic().
--
-- IMPORTANT:
--   1. Run this while the old public.closed_trips table and
--      public.reopen_trip_atomic(uuid) function still exist.
--   2. Take a database backup first.
--   3. Rows that were never captured in closed_trips.snapshot cannot be recovered
--      by SQL. The old close workflow did not snapshot every auxiliary table.

BEGIN;

CREATE TEMP TABLE _closed_trip_restore_queue ON COMMIT DROP AS
SELECT id, snapshot
FROM public.closed_trips
ORDER BY closed_at, id;

DO $$
DECLARE
  archived RECORD;
  restored_trip_id UUID;
  restored_vehicle_id UUID;
  restored_trip_code TEXT;
  toll_amount NUMERIC;
BEGIN
  FOR archived IN SELECT id, snapshot FROM _closed_trip_restore_queue ORDER BY id LOOP
    -- Restores the trip and the archived manifests, income, expenses, and
    -- approval advance, then removes this archive row.
    restored_trip_id := public.reopen_trip_atomic(archived.id);

    -- Recovered trips remain closed; they are not reopened for editing.
    UPDATE public.trips
    SET closed = true
    WHERE id = restored_trip_id;

    -- The old restore function predates payment-account columns. Put those
    -- nullable account references back from the archived snapshot when present.
    UPDATE public.trip_other_income AS live
    SET payment_ledger_id = archived_income.payment_ledger_id
    FROM jsonb_to_recordset(
      COALESCE(archived.snapshot->'other_income', '[]'::jsonb)
    ) AS archived_income(
      income_name TEXT,
      amount TEXT,
      note TEXT,
      payment_ledger_id UUID
    )
    WHERE live.trip_id = restored_trip_id
      AND live.income_name = archived_income.income_name
      AND live.amount::TEXT = archived_income.amount;

    UPDATE public.trip_expenses AS live
    SET payment_ledger_id = archived_expense.payment_ledger_id
    FROM jsonb_to_recordset(
      COALESCE(archived.snapshot->'expenses', '[]'::jsonb)
    ) AS archived_expense(
      expense_name TEXT,
      amount TEXT,
      note TEXT,
      payment_ledger_id UUID,
      sort_order INTEGER
    )
    WHERE live.trip_id = restored_trip_id
      AND live.expense_name = archived_expense.expense_name
      AND live.sort_order = COALESCE(archived_expense.sort_order, 0);

    -- Recreate the live Fastag deduction that the old close workflow created.
    SELECT vehicle_id, trip_code
    INTO restored_vehicle_id, restored_trip_code
    FROM public.trips
    WHERE id = restored_trip_id;

    SELECT COALESCE(SUM(
      CASE
        WHEN lower(trim(COALESCE(expense->>'expense_name', ''))) = 'toll charges'
        THEN COALESCE(NULLIF(expense->>'amount', '')::NUMERIC, 0)
        ELSE 0
      END
    ), 0)
    INTO toll_amount
    FROM jsonb_array_elements(COALESCE(archived.snapshot->'expenses', '[]'::jsonb)) AS expense;

    IF restored_vehicle_id IS NOT NULL AND toll_amount > 0 THEN
      INSERT INTO public.fastag_transactions (
        vehicle_id,
        trip_id,
        transaction_type,
        amount,
        transaction_date,
        note,
        trip_code
      )
      SELECT
        restored_vehicle_id,
        restored_trip_id,
        'deduction',
        round(toll_amount, 2),
        COALESCE(NULLIF(archived.snapshot->'trip'->>'end_date', ''), current_date::TEXT),
        'Toll Charges (Trip ' || restored_trip_code || ')',
        restored_trip_code
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.fastag_transactions
        WHERE trip_id = restored_trip_id
          AND transaction_type = 'deduction'
      );
    END IF;
  END LOOP;
END;
$$;

-- Remove historical Toll Charges deductions whose trip was deleted before the
-- new deletion cleanup existed. This makes Fastag balances and reports match
-- the trips that still exist.
DELETE FROM public.fastag_transactions AS fastag
WHERE fastag.transaction_type = 'deduction'
  AND fastag.trip_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.trips
    WHERE trips.id = fastag.trip_id
  );

-- Safety check: no archive rows should remain before the legacy table is removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.closed_trips LIMIT 1) THEN
    RAISE EXCEPTION 'Restore incomplete; public.closed_trips still contains rows. Nothing was dropped.';
  END IF;
END;
$$;

-- Do not drop public.closed_trips yet. Existing Cash Ledger, P&L, receipt,
-- and system-report screens still read historical rows from that table.
-- After those report queries are migrated to public.trips, run this separately:
-- DROP TABLE IF EXISTS public.closed_trips CASCADE;

COMMIT;
