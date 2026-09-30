BEGIN;

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS liability_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rentals_liability_ledger_idx
  ON public.rentals(liability_ledger_id);

CREATE OR REPLACE FUNCTION public.validate_rental_liability_ledger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ledger_branch_id UUID;
  v_ledger_type TEXT;
BEGIN
  IF NEW.liability_ledger_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT branch_id, ledger_type
  INTO v_ledger_branch_id, v_ledger_type
  FROM public.ledger_accounts
  WHERE id = NEW.liability_ledger_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected rental liability account was not found or is inactive';
  END IF;

  IF v_ledger_type <> 'liability' THEN
    RAISE EXCEPTION 'Rental account must be a liability ledger';
  END IF;

  IF NEW.branch_id IS NULL OR v_ledger_branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Rental liability account must belong to the same branch as the rental';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rentals_validate_liability_ledger ON public.rentals;
CREATE TRIGGER trg_rentals_validate_liability_ledger
  BEFORE INSERT OR UPDATE OF branch_id, liability_ledger_id ON public.rentals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_rental_liability_ledger();

COMMIT;

-- Verification query: each returned rental shows its linked active liability account.
SELECT
  r.id AS rental_id,
  r.rental_name,
  r.branch_id,
  l.id AS liability_ledger_id,
  l.account_name AS liability_account,
  l.ledger_type
FROM public.rentals r
LEFT JOIN public.ledger_accounts l ON l.id = r.liability_ledger_id
ORDER BY r.rental_name;
