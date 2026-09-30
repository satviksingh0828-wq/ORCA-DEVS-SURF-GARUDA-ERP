BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS fastag_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

COMMIT;
