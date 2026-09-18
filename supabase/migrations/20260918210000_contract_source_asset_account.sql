BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS source_asset_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

-- Validate the selected source account against the contract branch.
CREATE OR REPLACE FUNCTION public.validate_contract_source_asset_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_asset_ledger_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.ledger_accounts
    WHERE id = NEW.source_asset_ledger_id
      AND branch_id = NEW.branch_id
      AND ledger_type = 'asset'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Source Account must be an active asset account from the selected branch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contracts_validate_source_asset_account ON public.contracts;
CREATE TRIGGER contracts_validate_source_asset_account
  BEFORE INSERT OR UPDATE OF branch_id, source_asset_ledger_id ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_contract_source_asset_account();

GRANT SELECT, INSERT, UPDATE ON public.contracts TO anon, authenticated;

COMMIT;
