BEGIN;

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_module_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_module_check
  CHECK (source_module IN ('manual', 'auto', 'inter_branch', 'tms', 'cash_reports', 'fixed_income'));

COMMIT;
