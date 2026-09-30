-- Separate Loading Rate and Unloading Rate slabs.
-- Existing package-rate rows are preserved as Loading Rate rows.
BEGIN;

ALTER TABLE public.package_rate_entries
  ADD COLUMN IF NOT EXISTS rate_kind TEXT NOT NULL DEFAULT 'loading';

ALTER TABLE public.package_rate_entries
  DROP CONSTRAINT IF EXISTS package_rate_entries_rate_kind_check;

ALTER TABLE public.package_rate_entries
  ADD CONSTRAINT package_rate_entries_rate_kind_check
  CHECK (rate_kind IN ('loading', 'unloading'));

CREATE INDEX IF NOT EXISTS package_rate_entries_type_kind_idx
  ON public.package_rate_entries(package_rate_type_id, rate_kind, from_value);

COMMIT;
