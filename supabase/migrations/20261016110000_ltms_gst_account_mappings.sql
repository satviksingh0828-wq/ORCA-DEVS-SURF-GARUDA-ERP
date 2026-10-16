BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS input_igst_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_cgst_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_sgst_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS output_igst_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS output_cgst_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS output_sgst_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

-- Keep the existing branch setup flow in sync so new LTMS branches get all
-- six GST ledgers and their mapping links automatically.
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
        ('workmen_deduction_income_ledger_id', 'Workmen Deduction', 'income'),
        ('input_igst_ledger_id', 'Input IGST', 'asset'),
        ('input_cgst_ledger_id', 'Input CGST', 'asset'),
        ('input_sgst_ledger_id', 'Input SGST', 'asset'),
        ('output_igst_ledger_id', 'Output IGST', 'liability'),
        ('output_cgst_ledger_id', 'Output CGST', 'liability'),
        ('output_sgst_ledger_id', 'Output SGST', 'liability')
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

-- Backfill only branches that already have an LTMS mapping row. Existing manual
-- mappings are preserved; each new GST mapping is filled only when it is NULL.
DO $$
DECLARE
  v_branch_id uuid;
  v_field text;
  v_name text;
  v_type text;
  v_id uuid;
BEGIN
  FOR v_branch_id IN SELECT branch_id FROM public.tms_account_ledger_mappings LOOP
    FOR v_field, v_name, v_type IN
      SELECT * FROM (VALUES
        ('input_igst_ledger_id', 'Input IGST', 'asset'),
        ('input_cgst_ledger_id', 'Input CGST', 'asset'),
        ('input_sgst_ledger_id', 'Input SGST', 'asset'),
        ('output_igst_ledger_id', 'Output IGST', 'liability'),
        ('output_cgst_ledger_id', 'Output CGST', 'liability'),
        ('output_sgst_ledger_id', 'Output SGST', 'liability')
      ) AS fields(field_name, account_name, ledger_type)
    LOOP
      INSERT INTO public.ledger_accounts (
        branch_id, account_name, account_type, description, ledger_type,
        account_kind, opening_balance, is_system, is_active
      ) VALUES (
        v_branch_id, v_name, v_type, 'Auto-created LTMS ledger: ' || v_name,
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
        WHERE branch_id = v_branch_id AND account_name = v_name;
      END IF;

      EXECUTE format(
        'UPDATE public.tms_account_ledger_mappings SET %I = COALESCE(%I, $1), updated_at = now() WHERE branch_id = $2',
        v_field, v_field
      ) USING v_id, v_branch_id;
    END LOOP;
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.tms_account_ledger_mappings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_branch_mapping_accounts(uuid, boolean, boolean) TO anon, authenticated;

COMMIT;

-- Verification query:
-- SELECT b.branch_name,
--   m.input_igst_ledger_id, input_igst.account_name AS input_igst_account,
--   m.input_cgst_ledger_id, input_cgst.account_name AS input_cgst_account,
--   m.input_sgst_ledger_id, input_sgst.account_name AS input_sgst_account,
--   m.output_igst_ledger_id, output_igst.account_name AS output_igst_account,
--   m.output_cgst_ledger_id, output_cgst.account_name AS output_cgst_account,
--   m.output_sgst_ledger_id, output_sgst.account_name AS output_sgst_account
-- FROM public.tms_account_ledger_mappings m
-- JOIN public.branches b ON b.id = m.branch_id
-- LEFT JOIN public.ledger_accounts input_igst ON input_igst.id = m.input_igst_ledger_id
-- LEFT JOIN public.ledger_accounts input_cgst ON input_cgst.id = m.input_cgst_ledger_id
-- LEFT JOIN public.ledger_accounts input_sgst ON input_sgst.id = m.input_sgst_ledger_id
-- LEFT JOIN public.ledger_accounts output_igst ON output_igst.id = m.output_igst_ledger_id
-- LEFT JOIN public.ledger_accounts output_cgst ON output_cgst.id = m.output_cgst_ledger_id
-- LEFT JOIN public.ledger_accounts output_sgst ON output_sgst.id = m.output_sgst_ledger_id
-- ORDER BY b.branch_name;
