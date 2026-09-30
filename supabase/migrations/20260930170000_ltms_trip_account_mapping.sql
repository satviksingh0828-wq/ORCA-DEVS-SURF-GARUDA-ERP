BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS approval_charge_income_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_expenditure_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

DO $$
DECLARE
  v_branch_id UUID;
  v_branch_count INTEGER;
  v_approval_income_id UUID;
  v_trip_expenditure_id UUID;
BEGIN
  SELECT count(*) INTO v_branch_count
  FROM public.branches
  WHERE lower(trim(branch_name)) = 'a';

  IF v_branch_count = 0 THEN
    RAISE EXCEPTION 'Branch named A was not found; create it before applying the LTMS account seed';
  ELSIF v_branch_count > 1 THEN
    RAISE EXCEPTION 'More than one branch is named A; rename duplicates before applying the LTMS account seed';
  END IF;

  SELECT id INTO v_branch_id
  FROM public.branches
  WHERE lower(trim(branch_name)) = 'a';

  INSERT INTO public.ledger_accounts (
    branch_id, account_name, account_type, description, ledger_type, account_kind,
    opening_balance, is_system, is_active
  )
  SELECT
    v_branch_id,
    'Approval Charge Income',
    'income',
    'LTMS income ledger for Approval Charge',
    'income',
    'ledger',
    0,
    false,
    true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ledger_accounts
    WHERE branch_id = v_branch_id
      AND account_name = 'Approval Charge Income'
      AND ledger_type = 'income'
  );

  SELECT id INTO v_approval_income_id
  FROM public.ledger_accounts
  WHERE branch_id = v_branch_id
    AND account_name = 'Approval Charge Income'
    AND ledger_type = 'income'
  ORDER BY created_at, id
  LIMIT 1;

  INSERT INTO public.ledger_accounts (
    branch_id, account_name, account_type, description, ledger_type, account_kind,
    opening_balance, is_system, is_active
  )
  SELECT
    v_branch_id,
    'Trip Expenditure',
    'expenditure',
    'LTMS common expenditure ledger for all trip expenses',
    'expenditure',
    'ledger',
    0,
    false,
    true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ledger_accounts
    WHERE branch_id = v_branch_id
      AND account_name = 'Trip Expenditure'
      AND ledger_type = 'expenditure'
  );

  SELECT id INTO v_trip_expenditure_id
  FROM public.ledger_accounts
  WHERE branch_id = v_branch_id
    AND account_name = 'Trip Expenditure'
    AND ledger_type = 'expenditure'
  ORDER BY created_at, id
  LIMIT 1;

  INSERT INTO public.tms_account_ledger_mappings (
    branch_id, approval_charge_income_ledger_id, trip_expenditure_ledger_id
  )
  VALUES (v_branch_id, v_approval_income_id, v_trip_expenditure_id)
  ON CONFLICT (branch_id) DO UPDATE SET
    approval_charge_income_ledger_id = EXCLUDED.approval_charge_income_ledger_id,
    trip_expenditure_ledger_id = EXCLUDED.trip_expenditure_ledger_id,
    updated_at = now();
END $$;

COMMIT;

-- Verification: both rows should return the two mapped accounts for Branch A.
SELECT
  b.branch_name,
  m.approval_charge_income_ledger_id,
  ai.account_name AS approval_charge_income_account,
  m.trip_expenditure_ledger_id,
  te.account_name AS trip_expenditure_account
FROM public.tms_account_ledger_mappings m
JOIN public.branches b ON b.id = m.branch_id
LEFT JOIN public.ledger_accounts ai ON ai.id = m.approval_charge_income_ledger_id
LEFT JOIN public.ledger_accounts te ON te.id = m.trip_expenditure_ledger_id
WHERE lower(trim(b.branch_name)) = 'a';
