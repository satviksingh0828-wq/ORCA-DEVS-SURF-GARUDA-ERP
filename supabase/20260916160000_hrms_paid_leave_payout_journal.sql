-- Move the current-period paid-leave payout from Salary to its dedicated
-- Paid Leave Payout ledger. Extra Work Day Payout remains separate and is not
-- deducted from Salary.
BEGIN;

CREATE OR REPLACE FUNCTION public.hrms_create_payroll_generated_journal(p_payroll public.payrolls)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_entry uuid;
  v_existing uuid;
  v_map public.hrms_account_ledger_mappings%rowtype;
  v_salary numeric := round(
    coalesce(p_payroll.basic_salary, 0)
    + coalesce(p_payroll.hra, 0)
    + coalesce(p_payroll.travel_allowance, 0)
    + coalesce(p_payroll.special_allowance, 0)
    + coalesce(p_payroll.other_allowance, 0)
    - coalesce(p_payroll.paid_leave_payout_amount, 0),
    2
  );
  v_extra numeric := round(coalesce(p_payroll.extra_work_pay, 0), 2);
  v_leave numeric := round(coalesce(p_payroll.paid_leave_payout_amount, 0) + coalesce(p_payroll.paid_leave_final_settlement_amount, 0), 2);
  v_incentive numeric := round(coalesce(p_payroll.incentive_amount, 0), 2);
  v_unpaid numeric := round(coalesce(p_payroll.unpaid_leave_deduction, 0), 2);
  v_loan numeric := round(coalesce(p_payroll.loan_deduction, 0), 2);
  v_advance numeric := round(coalesce(p_payroll.advance_deduction, 0), 2);
  v_pf numeric := round(coalesce(p_payroll.pf_deduction, 0), 2);
  v_tax numeric := round(coalesce(p_payroll.tax_deduction, 0), 2);
  v_salary_payable numeric;
  v_description text := 'Payroll generated - ' || p_payroll.period_start || ' to ' || p_payroll.period_end;
BEGIN
  v_branch := public.hrms_branch_for_employee(p_payroll.employee_id);
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Employee has no Accounting Branch or department branch'; END IF;
  SELECT * INTO v_map FROM public.hrms_account_ledger_mappings WHERE branch_id = v_branch;
  IF v_map.id IS NULL THEN RAISE EXCEPTION 'HRMS account mappings are missing for the employee Accounting Branch'; END IF;

  PERFORM public.hrms_require_payroll_ledger(v_map.salary_ledger_id, v_branch, 'Salary', ARRAY['income','expenditure','revenue']);
  IF v_extra > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.extra_work_day_payout_ledger_id, v_branch, 'Extra Work Day Payout', ARRAY['income','expenditure','revenue']); END IF;
  IF v_leave > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.paid_leave_payout_ledger_id, v_branch, 'Paid Leave Payout', ARRAY['income','expenditure','revenue']); END IF;
  IF v_incentive > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.incentive_payable_ledger_id, v_branch, 'Incentive Payable', ARRAY['liability']); END IF;
  IF v_unpaid > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.unpaid_leave_deduction_ledger_id, v_branch, 'Unpaid Leave Deduction', ARRAY['income','expenditure','revenue']); END IF;
  IF v_loan > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.employee_loan_ledger_id, v_branch, 'Employee Loan', ARRAY['asset','capital']); END IF;
  IF v_advance > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.employee_advance_ledger_id, v_branch, 'Employee Advance', ARRAY['asset','capital']); END IF;
  IF v_pf > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.pf_ledger_id, v_branch, 'PF', ARRAY['income','expenditure','revenue']); END IF;
  IF v_tax > 0 THEN PERFORM public.hrms_require_payroll_ledger(v_map.tax_ledger_id, v_branch, 'Tax', ARRAY['income','expenditure','revenue']); END IF;

  v_salary_payable := round(v_salary + v_extra + v_leave + v_incentive - v_unpaid - v_loan - v_advance - v_pf - v_tax, 2);
  IF v_salary_payable <= 0 THEN RAISE EXCEPTION 'Payroll journal has no positive Salary Payable balance'; END IF;
  PERFORM public.hrms_require_payroll_ledger(v_map.salary_payable_ledger_id, v_branch, 'Salary Payable', ARRAY['liability']);

  SELECT id INTO v_existing FROM public.journal_entries
   WHERE reference = 'hrms:payroll-generated:' || p_payroll.id::text AND source_module = 'auto';
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (p_payroll.period_end, v_branch, v_description, 'hrms:payroll-generated:' || p_payroll.id::text, 'auto', 'approved', now())
  RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  SELECT v_entry, row_number() OVER (ORDER BY line_no)::integer, v_branch, ledger_id,
         (SELECT account_kind FROM public.ledger_accounts WHERE id = ledger_id), line_description, debit, credit
  FROM (VALUES
    (1, v_map.salary_ledger_id, 'Salary: Basic + HRA + Travel + Special + Other', v_salary, 0::numeric),
    (2, v_map.extra_work_day_payout_ledger_id, 'Extra Work Day Payout', v_extra, 0::numeric),
    (3, v_map.paid_leave_payout_ledger_id, 'Paid Leave Payout', v_leave, 0::numeric),
    (4, v_map.incentive_payable_ledger_id, 'One-time incentive', v_incentive, 0::numeric),
    (5, v_map.unpaid_leave_deduction_ledger_id, 'Unpaid Leave Deduction', 0::numeric, v_unpaid),
    (6, v_map.employee_loan_ledger_id, 'Employee Loan EMI', 0::numeric, v_loan),
    (7, v_map.employee_advance_ledger_id, 'Employee Advance EMI', 0::numeric, v_advance),
    (8, v_map.pf_ledger_id, 'PF', 0::numeric, v_pf),
    (9, v_map.tax_ledger_id, 'Tax', 0::numeric, v_tax),
    (10, v_map.salary_payable_ledger_id, 'Remaining Salary Payable', 0::numeric, v_salary_payable)
  ) AS lines(line_no, ledger_id, line_description, debit, credit)
  WHERE debit > 0 OR credit > 0;

  PERFORM public.validate_journal_entry(v_entry);
  RETURN v_entry;
END;
$$;

COMMIT;
