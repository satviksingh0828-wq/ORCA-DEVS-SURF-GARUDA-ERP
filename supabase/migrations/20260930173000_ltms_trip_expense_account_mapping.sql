BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS approval_charge_income_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_fuel_expense_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_toll_cash_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_driver_bata_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_morning_exp_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_night_exp_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_sunday_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_parking_charges_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_dala_charges_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_unloading_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_hire_charges_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

DO $$
DECLARE
  v_branch_id UUID;
  v_account_id UUID;
  v_item RECORD;
BEGIN
  SELECT id INTO v_branch_id
  FROM public.branches
  WHERE id = 'ae9207a2-72f6-498c-be42-5ebedea2d359'::UUID;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch ID ae9207a2-72f6-498c-be42-5ebedea2d359 was not found';
  END IF;

  INSERT INTO public.tms_account_ledger_mappings (branch_id)
  VALUES (v_branch_id)
  ON CONFLICT (branch_id) DO NOTHING;

  FOR v_item IN
    SELECT * FROM (VALUES
      ('approval_charge_income_ledger_id', 'Approval Charge Income', 'income', 'LTMS income ledger for Approval Charge'),
      ('trip_fuel_expense_ledger_id', 'Fuel Expense', 'expenditure', 'LTMS trip expenditure ledger for Fuel Expense'),
      ('trip_toll_cash_ledger_id', 'Toll Charges (paid in cash)', 'expenditure', 'LTMS trip expenditure ledger for cash-paid Toll Charges'),
      ('trip_driver_bata_ledger_id', 'Driver Bata', 'expenditure', 'LTMS trip expenditure ledger for Driver Bata'),
      ('trip_morning_exp_ledger_id', 'Morning Exp.', 'expenditure', 'LTMS trip expenditure ledger for Morning Exp.'),
      ('trip_night_exp_ledger_id', 'Night Exp.', 'expenditure', 'LTMS trip expenditure ledger for Night Exp.'),
      ('trip_sunday_ledger_id', 'Sunday', 'expenditure', 'LTMS trip expenditure ledger for Sunday'),
      ('trip_parking_charges_ledger_id', 'Parking Charges', 'expenditure', 'LTMS trip expenditure ledger for Parking Charges'),
      ('trip_dala_charges_ledger_id', 'Dala Charges', 'expenditure', 'LTMS trip expenditure ledger for Dala Charges'),
      ('trip_unloading_ledger_id', 'Unloading', 'expenditure', 'LTMS trip expenditure ledger for Unloading'),
      ('trip_hire_charges_ledger_id', 'Hire Charges', 'expenditure', 'LTMS trip expenditure ledger for Hire Charges')
    ) AS x(field_name, account_name, ledger_type, description)
  LOOP
    INSERT INTO public.ledger_accounts (
      branch_id, account_name, account_type, description, ledger_type, account_kind,
      opening_balance, is_system, is_active
    )
    SELECT
      v_branch_id,
      v_item.account_name,
      v_item.ledger_type,
      v_item.description,
      v_item.ledger_type,
      'ledger',
      0,
      false,
      true
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.ledger_accounts
      WHERE branch_id = v_branch_id
        AND account_name = v_item.account_name
        AND ledger_type = v_item.ledger_type
    );

    SELECT id INTO v_account_id
    FROM public.ledger_accounts
    WHERE branch_id = v_branch_id
      AND account_name = v_item.account_name
      AND ledger_type = v_item.ledger_type
      AND is_active
    ORDER BY created_at, id
    LIMIT 1;

    EXECUTE format(
      'UPDATE public.tms_account_ledger_mappings SET %I = $1, updated_at = now() WHERE branch_id = $2',
      v_item.field_name
    ) USING v_account_id, v_branch_id;
  END LOOP;
END $$;

COMMIT;

-- Verification: one mapped account should be returned for every trip expense type in Branch A.
SELECT
  b.branch_name,
  m.approval_charge_income_ledger_id,
  ai.account_name AS approval_charge_income_account,
  m.trip_fuel_expense_ledger_id,
  fuel.account_name AS fuel_expense_account,
  m.trip_toll_cash_ledger_id,
  toll_cash.account_name AS toll_cash_account,
  m.trip_driver_bata_ledger_id,
  bata.account_name AS driver_bata_account,
  m.trip_morning_exp_ledger_id,
  morning.account_name AS morning_exp_account,
  m.trip_night_exp_ledger_id,
  night.account_name AS night_exp_account,
  m.trip_sunday_ledger_id,
  sunday.account_name AS sunday_account,
  m.trip_parking_charges_ledger_id,
  parking.account_name AS parking_charges_account,
  m.trip_dala_charges_ledger_id,
  dala.account_name AS dala_charges_account,
  m.trip_unloading_ledger_id,
  unloading.account_name AS unloading_account,
  m.trip_hire_charges_ledger_id,
  hire.account_name AS hire_charges_account
FROM public.tms_account_ledger_mappings m
JOIN public.branches b ON b.id = m.branch_id
LEFT JOIN public.ledger_accounts ai ON ai.id = m.approval_charge_income_ledger_id
LEFT JOIN public.ledger_accounts fuel ON fuel.id = m.trip_fuel_expense_ledger_id
LEFT JOIN public.ledger_accounts toll_cash ON toll_cash.id = m.trip_toll_cash_ledger_id
LEFT JOIN public.ledger_accounts bata ON bata.id = m.trip_driver_bata_ledger_id
LEFT JOIN public.ledger_accounts morning ON morning.id = m.trip_morning_exp_ledger_id
LEFT JOIN public.ledger_accounts night ON night.id = m.trip_night_exp_ledger_id
LEFT JOIN public.ledger_accounts sunday ON sunday.id = m.trip_sunday_ledger_id
LEFT JOIN public.ledger_accounts parking ON parking.id = m.trip_parking_charges_ledger_id
LEFT JOIN public.ledger_accounts dala ON dala.id = m.trip_dala_charges_ledger_id
LEFT JOIN public.ledger_accounts unloading ON unloading.id = m.trip_unloading_ledger_id
LEFT JOIN public.ledger_accounts hire ON hire.id = m.trip_hire_charges_ledger_id
WHERE b.id = 'ae9207a2-72f6-498c-be42-5ebedea2d359'::UUID;
