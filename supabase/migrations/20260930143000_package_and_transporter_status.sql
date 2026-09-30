BEGIN;

-- Keep existing records and rates intact while adding an explicit lifecycle state.
ALTER TABLE public.package_rate_types
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMPTZ;

ALTER TABLE public.ltms_transporter_sources
  ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMPTZ;

-- Backfill the timestamp only when a legacy inactive source is already present.
UPDATE public.package_rate_types
SET inactive_at = COALESCE(inactive_at, updated_at)
WHERE is_active = false AND inactive_at IS NULL;

UPDATE public.ltms_transporter_sources
SET inactive_at = COALESCE(inactive_at, updated_at)
WHERE is_active = false AND inactive_at IS NULL;

COMMIT;
