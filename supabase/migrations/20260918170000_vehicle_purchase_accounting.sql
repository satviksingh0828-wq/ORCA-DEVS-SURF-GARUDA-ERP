BEGIN;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS purchase_paid_by_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.ledger_accounts
  ADD COLUMN IF NOT EXISTS source_vehicle_id UUID
    REFERENCES public.vehicles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_vehicle_source_uidx
  ON public.ledger_accounts(source_vehicle_id)
  WHERE source_vehicle_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_vehicle_purchase_accounting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount NUMERIC(14,2);
  v_purchase_date DATE;
  v_account_name TEXT;
  v_asset_ledger_id UUID;
  v_entry_id UUID;
  v_paid_ledger RECORD;
  v_reference TEXT := 'vehicle_purchase:' || NEW.id::text;
BEGIN
  v_amount := round(coalesce(nullif(trim(coalesce(NEW.purchase_cost, '')), '')::numeric, 0), 2);
  v_purchase_date := nullif(trim(coalesce(NEW.purchase_date, '')), '')::date;

  DELETE FROM public.journal_entries
  WHERE reference = v_reference
    AND source_module = 'auto';

  IF v_amount = 0 AND NEW.purchase_paid_by_ledger_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Vehicle purchase cost must be greater than zero';
  END IF;
  IF NEW.branch_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle branch is required for purchase accounting';
  END IF;
  IF v_purchase_date IS NULL THEN
    RAISE EXCEPTION 'Vehicle purchase date is required for purchase accounting';
  END IF;
  IF NEW.purchase_paid_by_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Select the cash or bank account used to pay the vehicle purchase';
  END IF;

  SELECT * INTO v_paid_ledger
  FROM public.ledger_accounts
  WHERE id = NEW.purchase_paid_by_ledger_id
    AND branch_id = NEW.branch_id
    AND is_active
    AND ledger_type IN ('bank', 'cash');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle purchase payment account must be an active cash or bank account from the vehicle branch';
  END IF;

  v_account_name := 'Vehicle - ' || coalesce(
    nullif(trim(NEW.nickname), ''),
    nullif(trim(NEW.registration_number), ''),
    NEW.id::text
  );

  INSERT INTO public.ledger_accounts(
    branch_id, account_name, account_type, description, ledger_type, account_kind,
    source_vehicle_id, opening_balance, opening_balance_side, is_system, is_active
  ) VALUES (
    NEW.branch_id, v_account_name, 'asset', v_account_name, 'asset', 'ledger',
    NEW.id, 0, 'dr', true, true
  )
  ON CONFLICT (source_vehicle_id) WHERE source_vehicle_id IS NOT NULL DO UPDATE SET
    branch_id = EXCLUDED.branch_id,
    account_name = EXCLUDED.account_name,
    account_type = 'asset',
    description = EXCLUDED.description,
    ledger_type = 'asset',
    is_active = true
  RETURNING id INTO v_asset_ledger_id;

  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) VALUES (
    v_purchase_date,
    NEW.branch_id,
    'Vehicle purchase - ' || v_account_name,
    v_reference,
    'auto',
    'approved',
    now()
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) VALUES
    (
      v_entry_id, 1, NEW.branch_id, v_asset_ledger_id, 'ledger',
      'Vehicle purchase - ' || v_account_name, v_amount, 0
    ),
    (
      v_entry_id, 2, NEW.branch_id, v_paid_ledger.id, v_paid_ledger.account_kind,
      'Vehicle purchase paid from ' || v_paid_ledger.account_name, 0, v_amount
    );

  PERFORM public.validate_journal_entry(v_entry_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_purchase_accounting ON public.vehicles;
CREATE TRIGGER vehicles_purchase_accounting
AFTER INSERT OR UPDATE OF branch_id, nickname, registration_number,
  purchase_date, purchase_cost, purchase_paid_by_ledger_id
ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.sync_vehicle_purchase_accounting();

GRANT SELECT, INSERT, UPDATE ON public.vehicles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ledger_accounts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.journal_entries TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.journal_lines TO anon, authenticated;

COMMIT;
