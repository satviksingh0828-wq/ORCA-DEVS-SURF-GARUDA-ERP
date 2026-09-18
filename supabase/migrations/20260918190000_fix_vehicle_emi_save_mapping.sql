BEGIN;

-- Schedule creation only posts the loan disbursement. Interest mapping is
-- needed when an installment with a positive interest component is inserted.
CREATE OR REPLACE FUNCTION public.tms_vehicle_loan_schedule_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle public.vehicles%ROWTYPE;
  v_loan_id UUID;
  v_purchase_date DATE;
  v_entry_id UUID;
  v_payment RECORD;
  v_reference TEXT := 'vehicle_loan:' || NEW.id::text;
BEGIN
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = NEW.vehicle_id;
  IF NOT FOUND OR v_vehicle.branch_id IS NULL OR NEW.branch_id IS DISTINCT FROM v_vehicle.branch_id THEN
    RAISE EXCEPTION 'Vehicle loan schedule must use the vehicle branch';
  END IF;
  v_purchase_date := nullif(trim(coalesce(v_vehicle.purchase_date, '')), '')::date;
  IF v_purchase_date IS NULL THEN
    RAISE EXCEPTION 'Vehicle purchase date is required before creating a loan schedule';
  END IF;
  IF NEW.loan_disbursement_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Select the cash or bank account used for vehicle loan disbursement';
  END IF;
  SELECT * INTO v_payment
  FROM public.ledger_accounts
  WHERE id = NEW.loan_disbursement_ledger_id
    AND branch_id = NEW.branch_id
    AND is_active
    AND ledger_type IN ('bank', 'cash');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle loan disbursement account must be an active cash or bank account from the vehicle branch';
  END IF;
  SELECT vehicle_loan_id
    INTO v_loan_id
  FROM public.tms_require_vehicle_loan_mapping(NEW.branch_id, false);

  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) VALUES (
    v_purchase_date, NEW.branch_id,
    'Vehicle loan disbursement - ' || coalesce(nullif(trim(v_vehicle.nickname), ''), v_vehicle.registration_number),
    v_reference, 'auto', 'approved', now()
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) VALUES
    (v_entry_id, 1, NEW.branch_id, v_payment.id, v_payment.account_kind,
     'Vehicle loan disbursement', round(NEW.loan_amount, 2), 0),
    (v_entry_id, 2, NEW.branch_id, v_loan_id, 'ledger',
     'Vehicle loan liability', 0, round(NEW.loan_amount, 2));
  PERFORM public.validate_journal_entry(v_entry_id);
  RETURN NEW;
END;
$$;

-- A zero-interest installment does not need an interest ledger. Positive
-- interest installments still fail clearly if the interest mapping is absent.
CREATE OR REPLACE FUNCTION public.tms_vehicle_emi_accrual_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.emi_schedules%ROWTYPE;
  v_loan_id UUID;
  v_payable_id UUID;
  v_interest_id UUID;
  v_entry_id UUID;
  v_description TEXT;
  v_reference TEXT := 'vehicle_emi_accrual:' || NEW.id::text;
  v_interest NUMERIC(14,2) := round(coalesce(NEW.interest, 0), 2);
  v_principal NUMERIC(14,2) := round(coalesce(NEW.principal, NEW.amount - coalesce(NEW.interest, 0)), 2);
BEGIN
  SELECT * INTO v_schedule FROM public.emi_schedules WHERE id = NEW.schedule_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle EMI schedule was not found'; END IF;
  SELECT vehicle_loan_id, emi_payable_id, interest_id
    INTO v_loan_id, v_payable_id, v_interest_id
  FROM public.tms_require_vehicle_loan_mapping(v_schedule.branch_id, v_interest > 0);
  v_description := 'Vehicle EMI #' || NEW.installment_number;

  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) VALUES (
    nullif(trim(NEW.due_date), '')::date, v_schedule.branch_id,
    v_description, v_reference, 'auto', 'approved', now()
  ) RETURNING id INTO v_entry_id;

  IF v_interest > 0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_entry_id, 1, v_schedule.branch_id, v_interest_id, 'ledger',
      v_description || ' interest', v_interest, 0
    );
  END IF;
  IF v_principal > 0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_entry_id, CASE WHEN v_interest > 0 THEN 2 ELSE 1 END,
      v_schedule.branch_id, v_loan_id, 'ledger',
      v_description || ' principal', v_principal, 0
    );
  END IF;
  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) VALUES (
    v_entry_id, CASE WHEN v_interest > 0 AND v_principal > 0 THEN 3 ELSE 2 END,
    v_schedule.branch_id, v_payable_id, 'ledger',
    v_description || ' payable', 0, round(NEW.amount, 2)
  );
  PERFORM public.validate_journal_entry(v_entry_id);
  RETURN NEW;
END;
$$;

COMMIT;
