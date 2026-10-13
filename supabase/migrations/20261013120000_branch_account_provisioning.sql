-- Branch account provisioning for new branches.
-- Run this migration in Supabase SQL Editor before using the new branch options.
-- It is idempotent: re-running the RPC does not duplicate accounts or mappings.

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_branch_capital_account(p_branch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_name text;
  v_id uuid;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required';
  END IF;

  SELECT COALESCE(NULLIF(trim(branch_name), ''), 'Branch')
    INTO v_branch_name
  FROM public.branches
  WHERE id = p_branch_id;

  IF v_branch_name IS NULL THEN
    RAISE EXCEPTION 'Branch % was not found', p_branch_id;
  END IF;

  INSERT INTO public.ledger_accounts (
    branch_id, account_name, account_type, description, ledger_type,
    account_kind, opening_balance, system_code, is_system, is_default_capital, is_active
  ) VALUES (
    p_branch_id,
    'Capital - ' || v_branch_name,
    'equity',
    'Default capital ledger for ' || v_branch_name,
    'capital',
    'ledger',
    0,
    'CAPITAL',
    true,
    true,
    true
  )
  ON CONFLICT (branch_id, account_name) DO UPDATE SET
    account_type = 'equity',
    description = EXCLUDED.description,
    ledger_type = 'capital',
    account_kind = 'ledger',
    system_code = 'CAPITAL',
    is_system = true,
    is_default_capital = true,
    is_active = true
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.ledger_accounts
    WHERE branch_id = p_branch_id
      AND account_name = 'Capital - ' || v_branch_name
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_branch_mapping_accounts(
  p_branch_id uuid,
  p_create_ltms boolean DEFAULT false,
  p_create_hrms boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field text;
  v_name text;
  v_type text;
  v_id uuid;
BEGIN
  PERFORM public.ensure_branch_capital_account(p_branch_id);

  IF p_create_ltms THEN
    INSERT INTO public.tms_account_ledger_mappings (branch_id)
    VALUES (p_branch_id)
    ON CONFLICT (branch_id) DO NOTHING;

    FOR v_field, v_name, v_type IN
      SELECT * FROM (VALUES
        ('driver_salary_ledger_id', 'Driver Salary', 'expenditure'),
        ('driver_salary_payable_ledger_id', 'Driver Salary Payable', 'liability'),
        ('driver_advance_ledger_id', 'Driver Advance', 'asset'),
        ('vehicle_loan_ledger_id', 'Vehicle Loan', 'liability'),
        ('vehicle_emi_payable_ledger_id', 'Vehicle EMI Payable', 'liability'),
        ('vehicle_loan_interest_ledger_id', 'Vehicle Loan Interest', 'expenditure'),
        ('vehicle_insurance_advance_ledger_id', 'Vehicle Insurance Advance', 'asset'),
        ('vehicle_insurance_expense_ledger_id', 'Vehicle Insurance Expense', 'expenditure'),
        ('vehicle_road_tax_advance_ledger_id', 'Vehicle Road Tax Advance', 'asset'),
        ('vehicle_road_tax_expense_ledger_id', 'Vehicle Road Tax Expense', 'expenditure'),
        ('fastag_ledger_id', 'Fastag Expenditure Account', 'expenditure'),
        ('approval_charge_income_ledger_id', 'Approval Charge Income', 'income'),
        ('trip_fuel_expense_ledger_id', 'Fuel Expense', 'expenditure'),
        ('trip_toll_cash_ledger_id', 'Toll Charges (paid in cash)', 'expenditure'),
        ('trip_driver_bata_ledger_id', 'Driver Bata', 'expenditure'),
        ('trip_morning_exp_ledger_id', 'Morning Exp.', 'expenditure'),
        ('trip_night_exp_ledger_id', 'Night Exp.', 'expenditure'),
        ('trip_sunday_ledger_id', 'Sunday', 'expenditure'),
        ('trip_parking_charges_ledger_id', 'Parking Charges', 'expenditure'),
        ('trip_dala_charges_ledger_id', 'Dala Charges', 'expenditure'),
        ('trip_unloading_ledger_id', 'Unloading', 'expenditure'),
        ('trip_hire_charges_ledger_id', 'Hire Charges', 'expenditure'),
        ('other_expenditure_ledger_id', 'Other Expenditure', 'expenditure'),
        ('other_expenditure_payable_ledger_id', 'Other Expenditure Payable', 'liability'),
        ('other_income_ledger_id', 'Other Income', 'income'),
        ('other_income_receivable_ledger_id', 'Other Income Receivable', 'asset'),
        ('workmen_loading_expenditure_ledger_id', 'Loading Expenditure', 'expenditure'),
        ('workmen_unloading_expenditure_ledger_id', 'Unloading Expenditure', 'expenditure'),
        ('workmen_payout_liability_ledger_id', 'Workmen Payout', 'liability'),
        ('workmen_additional_pay_expenditure_ledger_id', 'Workmen Additional Pay', 'expenditure'),
        ('workmen_deduction_income_ledger_id', 'Workmen Deduction', 'income')
      ) AS fields(field_name, account_name, ledger_type)
    LOOP
      INSERT INTO public.ledger_accounts (
        branch_id, account_name, account_type, description, ledger_type,
        account_kind, opening_balance, is_system, is_active
      ) VALUES (
        p_branch_id, v_name, v_type, 'Auto-created LTMS ledger: ' || v_name,
        v_type, 'ledger', 0, true, true
      )
      ON CONFLICT (branch_id, account_name) DO UPDATE SET
        account_type = EXCLUDED.account_type,
        description = EXCLUDED.description,
        ledger_type = EXCLUDED.ledger_type,
        account_kind = 'ledger',
        is_system = true,
        is_active = true
      RETURNING id INTO v_id;

      IF v_id IS NULL THEN
        SELECT id INTO v_id
        FROM public.ledger_accounts
        WHERE branch_id = p_branch_id AND account_name = v_name;
      END IF;

      EXECUTE format(
        'UPDATE public.tms_account_ledger_mappings SET %I = $1, updated_at = now() WHERE branch_id = $2',
        v_field
      ) USING v_id, p_branch_id;
    END LOOP;
  END IF;

  IF p_create_hrms THEN
    INSERT INTO public.hrms_account_ledger_mappings (branch_id)
    VALUES (p_branch_id)
    ON CONFLICT (branch_id) DO NOTHING;

    FOR v_field, v_name, v_type IN
      SELECT * FROM (VALUES
        ('salary_ledger_id', 'Salary', 'expenditure'),
        ('salary_payable_ledger_id', 'Salary Payable', 'liability'),
        ('employee_advance_ledger_id', 'Employee Advance', 'asset'),
        ('employee_loan_ledger_id', 'Employee Loan', 'asset'),
        ('incentive_ledger_id', 'Incentive', 'expenditure'),
        ('incentive_payable_ledger_id', 'Incentive Payable', 'liability'),
        ('pf_ledger_id', 'PF Payable', 'liability'),
        ('tax_ledger_id', 'Tax Payable', 'liability'),
        ('salary_deduction_ledger_id', 'Salary Deduction', 'expenditure'),
        ('loss_deduction_ledger_id', 'Loss Deduction', 'expenditure'),
        ('unpaid_leave_deduction_ledger_id', 'Unpaid Leave Deduction', 'expenditure'),
        ('paid_leave_payout_ledger_id', 'Paid Leave Payout', 'expenditure'),
        ('extra_work_day_payout_ledger_id', 'Extra Work Day Payout', 'expenditure')
      ) AS fields(field_name, account_name, ledger_type)
    LOOP
      INSERT INTO public.ledger_accounts (
        branch_id, account_name, account_type, description, ledger_type,
        account_kind, opening_balance, is_system, is_active
      ) VALUES (
        p_branch_id, v_name, v_type, 'Auto-created HRMS ledger: ' || v_name,
        v_type, 'ledger', 0, true, true
      )
      ON CONFLICT (branch_id, account_name) DO UPDATE SET
        account_type = EXCLUDED.account_type,
        description = EXCLUDED.description,
        ledger_type = EXCLUDED.ledger_type,
        account_kind = 'ledger',
        is_system = true,
        is_active = true
      RETURNING id INTO v_id;

      IF v_id IS NULL THEN
        SELECT id INTO v_id
        FROM public.ledger_accounts
        WHERE branch_id = p_branch_id AND account_name = v_name;
      END IF;

      EXECUTE format(
        'UPDATE public.hrms_account_ledger_mappings SET %I = $1, updated_at = now() WHERE branch_id = $2',
        v_field
      ) USING v_id, p_branch_id;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_branch_with_account_options(
  p_branch jsonb,
  p_create_ltms boolean DEFAULT false,
  p_create_hrms boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  -- Do not insert a NULL composite record: that bypasses the table defaults for
  -- id, created_at, and updated_at. Explicitly omit those columns instead.
  INSERT INTO public.branches (
    branch_name, branch_type, address_line1, address_line2, area_locality,
    landmark, city, district, state, country, pin_code, branch_phone,
    mobile_number, email_address, manager_name, manager_designation,
    manager_mobile, manager_email, gstin, pan, state_code,
    trip_series_prefix, lr_series_prefix, manifest_series_prefix,
    eway_auto_fetch_enabled, wms_enabled, wms_warehouse_id
  )
  VALUES (
    COALESCE(p_branch->>'branch_name', ''),
    COALESCE(p_branch->>'branch_type', ''),
    COALESCE(p_branch->>'address_line1', ''),
    COALESCE(p_branch->>'address_line2', ''),
    COALESCE(p_branch->>'area_locality', ''),
    COALESCE(p_branch->>'landmark', ''),
    COALESCE(p_branch->>'city', ''),
    COALESCE(p_branch->>'district', ''),
    COALESCE(p_branch->>'state', ''),
    COALESCE(p_branch->>'country', ''),
    COALESCE(p_branch->>'pin_code', ''),
    COALESCE(p_branch->>'branch_phone', ''),
    COALESCE(p_branch->>'mobile_number', ''),
    COALESCE(p_branch->>'email_address', ''),
    COALESCE(p_branch->>'manager_name', ''),
    COALESCE(p_branch->>'manager_designation', ''),
    COALESCE(p_branch->>'manager_mobile', ''),
    COALESCE(p_branch->>'manager_email', ''),
    COALESCE(p_branch->>'gstin', ''),
    COALESCE(p_branch->>'pan', ''),
    COALESCE(p_branch->>'state_code', ''),
    COALESCE(p_branch->>'trip_series_prefix', 'TR'),
    COALESCE(p_branch->>'lr_series_prefix', 'LR'),
    COALESCE(p_branch->>'manifest_series_prefix', 'MF'),
    COALESCE((p_branch->>'eway_auto_fetch_enabled')::boolean, false),
    COALESCE((p_branch->>'wms_enabled')::boolean, false),
    NULLIF(p_branch->>'wms_warehouse_id', '')::integer
  )
  RETURNING id INTO v_branch_id;

  PERFORM public.provision_branch_mapping_accounts(v_branch_id, p_create_ltms, p_create_hrms);
  RETURN v_branch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_branch_capital_account(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_branch_mapping_accounts(uuid, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_branch_with_account_options(jsonb, boolean, boolean) TO anon, authenticated;

-- Repair/backfill the capital account for every existing branch as well.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.branches LOOP
    PERFORM public.ensure_branch_capital_account(r.id);
  END LOOP;
END;
$$;

COMMIT;

-- Verification queries:
-- SELECT b.branch_name, la.account_name, la.ledger_type
-- FROM public.branches b
-- JOIN public.ledger_accounts la ON la.branch_id = b.id
-- WHERE la.account_name = 'Capital - ' || b.branch_name
-- ORDER BY b.branch_name;
-- SELECT b.branch_name, count(*) AS ltms_mapped
-- FROM public.tms_account_ledger_mappings m
-- JOIN public.branches b ON b.id = m.branch_id
-- GROUP BY b.branch_name;
