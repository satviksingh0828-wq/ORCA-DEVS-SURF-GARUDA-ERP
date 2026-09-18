BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS vehicle_loan_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_emi_payable_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_loan_interest_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.emi_schedules
  ADD COLUMN IF NOT EXISTS loan_disbursement_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.emi_installments
  ADD COLUMN IF NOT EXISTS payment_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.tms_require_vehicle_loan_mapping(
  p_branch_id UUID,
  p_interest BOOLEAN DEFAULT false
) RETURNS TABLE (
  vehicle_loan_id UUID,
  emi_payable_id UUID,
  interest_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map public.tms_account_ledger_mappings%ROWTYPE;
BEGIN
  SELECT * INTO v_map
  FROM public.tms_account_ledger_mappings
  WHERE branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TMS vehicle loan mappings are missing for this branch';
  END IF;
  IF v_map.vehicle_loan_ledger_id IS NULL
     OR v_map.vehicle_emi_payable_ledger_id IS NULL
     OR (p_interest AND v_map.vehicle_loan_interest_ledger_id IS NULL) THEN
    RAISE EXCEPTION 'Map Vehicle Loan, Vehicle EMI Payable, and Vehicle Loan Interest in TMS Accounts first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_map.vehicle_loan_ledger_id AND branch_id = p_branch_id
      AND is_active AND ledger_type = 'liability'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_map.vehicle_emi_payable_ledger_id AND branch_id = p_branch_id
      AND is_active AND ledger_type = 'liability'
  ) OR (p_interest AND NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_map.vehicle_loan_interest_ledger_id AND branch_id = p_branch_id
      AND is_active AND ledger_type = 'expenditure'
  )) THEN
    RAISE EXCEPTION 'Vehicle loan mappings must be active ledgers from the same branch with the required types';
  END IF;
  RETURN QUERY SELECT v_map.vehicle_loan_ledger_id,
                      v_map.vehicle_emi_payable_ledger_id,
                      v_map.vehicle_loan_interest_ledger_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_vehicle_loan_schedule_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle public.vehicles%ROWTYPE;
  v_loan_id UUID;
  v_payable_id UUID;
  v_interest_id UUID;
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
  SELECT vehicle_loan_id, emi_payable_id, interest_id
    INTO v_loan_id, v_payable_id, v_interest_id
  FROM public.tms_require_vehicle_loan_mapping(NEW.branch_id, true);

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
  FROM public.tms_require_vehicle_loan_mapping(v_schedule.branch_id, true);
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

CREATE OR REPLACE FUNCTION public.tms_mark_vehicle_emi_paid(
  p_installment_id UUID,
  p_payment_ledger_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst public.emi_installments%ROWTYPE;
  v_schedule public.emi_schedules%ROWTYPE;
  v_payment RECORD;
  v_payable_id UUID;
  v_entry_id UUID;
  v_today DATE := current_date;
BEGIN
  SELECT * INTO v_inst FROM public.emi_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle EMI installment was not found'; END IF;
  IF v_inst.is_paid THEN RAISE EXCEPTION 'Vehicle EMI installment is already paid'; END IF;
  SELECT * INTO v_schedule FROM public.emi_schedules WHERE id = v_inst.schedule_id;
  SELECT * INTO v_payment
  FROM public.ledger_accounts
  WHERE id = p_payment_ledger_id
    AND branch_id = v_schedule.branch_id
    AND is_active
    AND ledger_type IN ('bank', 'cash');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMI payment account must be an active cash or bank account from the vehicle branch';
  END IF;
  SELECT emi_payable_id INTO v_payable_id
  FROM public.tms_require_vehicle_loan_mapping(v_schedule.branch_id, false);

  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) VALUES (
    v_today, v_schedule.branch_id,
    'Vehicle EMI paid #' || v_inst.installment_number,
    'vehicle_emi_payment:' || v_inst.id::text, 'auto', 'approved', now()
  ) RETURNING id INTO v_entry_id;
  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) VALUES
    (v_entry_id, 1, v_schedule.branch_id, v_payable_id, 'ledger',
     'Vehicle EMI payable settled', round(v_inst.amount, 2), 0),
    (v_entry_id, 2, v_schedule.branch_id, v_payment.id, v_payment.account_kind,
     'Vehicle EMI paid from ' || v_payment.account_name, 0, round(v_inst.amount, 2));
  PERFORM public.validate_journal_entry(v_entry_id);

  UPDATE public.emi_installments
  SET is_paid = true, paid_date = v_today::text, payment_ledger_id = p_payment_ledger_id
  WHERE id = v_inst.id;
  IF v_inst.expenditure_id IS NOT NULL THEN
    UPDATE public.expenditures
    SET is_paid = true, paid_date = v_today::text, payment_ledger_id = p_payment_ledger_id
    WHERE id = v_inst.expenditure_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_delete_vehicle_emi_schedule_journals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.journal_entries
  WHERE source_module = 'auto'
    AND (
      reference = 'vehicle_loan:' || OLD.id::text
      OR reference IN (
        SELECT 'vehicle_emi_accrual:' || id::text
        FROM public.emi_installments
        WHERE schedule_id = OLD.id
      )
      OR reference IN (
        SELECT 'vehicle_emi_payment:' || id::text
        FROM public.emi_installments
        WHERE schedule_id = OLD.id
      )
    );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS emi_schedules_vehicle_loan_created ON public.emi_schedules;
CREATE TRIGGER emi_schedules_vehicle_loan_created
AFTER INSERT ON public.emi_schedules
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_loan_schedule_created();

DROP TRIGGER IF EXISTS emi_installments_vehicle_accrual_created ON public.emi_installments;
CREATE TRIGGER emi_installments_vehicle_accrual_created
AFTER INSERT ON public.emi_installments
FOR EACH ROW EXECUTE FUNCTION public.tms_vehicle_emi_accrual_created();

DROP TRIGGER IF EXISTS emi_schedules_vehicle_journals_deleted ON public.emi_schedules;
CREATE TRIGGER emi_schedules_vehicle_journals_deleted
BEFORE DELETE ON public.emi_schedules
FOR EACH ROW EXECUTE FUNCTION public.tms_delete_vehicle_emi_schedule_journals();

GRANT EXECUTE ON FUNCTION public.tms_mark_vehicle_emi_paid(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tms_require_vehicle_loan_mapping(UUID, BOOLEAN) TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tms_account_ledger_mappings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.emi_schedules TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.emi_installments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.expenditures TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.journal_entries TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.journal_lines TO anon, authenticated;

COMMIT;
