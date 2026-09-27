-- LTMS live trip workflow
-- Run this migration in Supabase before using the new Trip > Movements workflow.

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS consignments_trip_id_idx
  ON public.consignments(trip_id)
  WHERE trip_id IS NOT NULL;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS income_approval_charge NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_hire_charges NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_toll_charges NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_toll_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_fuel NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_driver_bata NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_morning NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_night NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_sunday NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_parking NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_dala NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_unloading NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Existing legacy rows remain available for history. New code no longer writes
-- closed_trips or JSON trip snapshots.
