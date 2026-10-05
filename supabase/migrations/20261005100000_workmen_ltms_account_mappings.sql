BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS workmen_loading_expenditure_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workmen_unloading_expenditure_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workmen_payout_liability_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workmen_additional_pay_expenditure_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workmen_deduction_income_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE ON public.tms_account_ledger_mappings TO anon, authenticated;

COMMIT;
