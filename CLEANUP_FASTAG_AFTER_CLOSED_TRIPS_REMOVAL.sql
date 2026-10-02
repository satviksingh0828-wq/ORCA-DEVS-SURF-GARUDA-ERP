-- Run this script after public.closed_trips has already been removed.
-- It repairs stale Toll Charges deductions and guarantees that deleting an
-- open trip automatically removes its Fastag deduction at database level.
-- Take a database backup before running.

BEGIN;

-- Ensure the trip link exists for live Toll Charges deductions.
ALTER TABLE public.fastag_transactions
  ADD COLUMN IF NOT EXISTS trip_id UUID;

-- Remove deductions belonging to trips that no longer exist.
-- Recharge rows are intentionally preserved.
DELETE FROM public.fastag_transactions AS fastag
WHERE fastag.transaction_type = 'deduction'
  AND fastag.trip_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.trips
    WHERE trips.id = fastag.trip_id
  );

CREATE INDEX IF NOT EXISTS fastag_transactions_trip_id_idx
  ON public.fastag_transactions (trip_id);

-- Protect future deletions even if a caller bypasses the application action.
-- The application already deletes this row explicitly; ON DELETE CASCADE is
-- an additional database-level safeguard and does not affect recharges.
ALTER TABLE public.fastag_transactions
  DROP CONSTRAINT IF EXISTS fastag_transactions_trip_id_fkey;

ALTER TABLE public.fastag_transactions
  ADD CONSTRAINT fastag_transactions_trip_id_fkey
  FOREIGN KEY (trip_id)
  REFERENCES public.trips(id)
  ON DELETE CASCADE;

COMMIT;
