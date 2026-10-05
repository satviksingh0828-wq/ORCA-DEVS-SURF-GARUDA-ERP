BEGIN;

-- Keep each generated Workmen Bill linked to the journal entry that posts it.
ALTER TABLE public.workmen_bills
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workmen_bills_journal_entry_fk'
      AND conrelid = 'public.workmen_bills'::regclass
  ) THEN
    ALTER TABLE public.workmen_bills
      ADD CONSTRAINT workmen_bills_journal_entry_fk
      FOREIGN KEY (journal_entry_id)
      REFERENCES public.journal_entries(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS workmen_bills_journal_entry_uidx
  ON public.workmen_bills(journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

-- Bill creation, source locking, and journal posting are one database transaction.
-- A missing/invalid mapping or failed journal validation rolls back the bill and
-- releases the selected consignments/receipts automatically.
CREATE OR REPLACE FUNCTION public.create_workmen_bill(
  p_branch_id UUID,
  p_bill_date DATE,
  p_period_from DATE DEFAULT NULL,
  p_period_to DATE DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_additional_pay_amount NUMERIC DEFAULT 0,
  p_additional_pay_note TEXT DEFAULT NULL,
  p_deduction_amount NUMERIC DEFAULT 0,
  p_deduction_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_id UUID;
  v_journal_id UUID;
  v_item JSONB;
  v_type TEXT;
  v_consignment_id UUID;
  v_receipt_id UUID;
  v_calculated NUMERIC(14,2);
  v_deduction NUMERIC(14,2);
  v_addition NUMERIC(14,2);
  v_final NUMERIC(14,2);
  v_loading NUMERIC(14,2) := 0;
  v_unloading NUMERIC(14,2) := 0;
  v_additional_pay NUMERIC(14,2) := round(greatest(0, coalesce(p_additional_pay_amount, 0)), 2);
  v_bill_deduction NUMERIC(14,2) := round(greatest(0, coalesce(p_deduction_amount, 0)), 2);
  v_total_debits NUMERIC(14,2);
  v_payable NUMERIC(14,2);
  v_number TEXT;
  v_map public.tms_account_ledger_mappings%ROWTYPE;
  v_loading_kind TEXT;
  v_unloading_kind TEXT;
  v_additional_pay_kind TEXT;
  v_payable_kind TEXT;
  v_deduction_kind TEXT;
  v_line_no INTEGER := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required';
  END IF;
  IF (p_period_from IS NULL) <> (p_period_to IS NULL)
     OR (p_period_from IS NOT NULL AND p_period_from > p_period_to) THEN
    RAISE EXCEPTION 'Billing period is invalid';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN
    RAISE EXCEPTION 'Add at least one loading or unloading entry';
  END IF;

  v_number := 'WB-' || to_char(coalesce(p_bill_date, current_date), 'YYYYMMDD')
    || '-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6));

  INSERT INTO public.workmen_bills (
    bill_number, branch_id, bill_date, period_from, period_to,
    additional_pay_amount, additional_pay_note, deduction_amount, deduction_note, created_by
  )
  VALUES (
    v_number, p_branch_id, coalesce(p_bill_date, current_date), p_period_from, p_period_to,
    v_additional_pay, NULLIF(trim(p_additional_pay_note), ''), v_bill_deduction,
    NULLIF(trim(p_deduction_note), ''), p_created_by
  )
  RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_type := lower(trim(v_item->>'charge_type'));
    v_consignment_id := NULLIF(v_item->>'consignment_id', '')::UUID;
    v_receipt_id := NULLIF(v_item->>'stock_inward_receipt_id', '')::UUID;
    v_calculated := round(greatest(0, coalesce(NULLIF(v_item->>'calculated_amount', '')::NUMERIC, 0)), 2);
    v_deduction := round(greatest(0, coalesce(NULLIF(v_item->>'deduction', '')::NUMERIC, 0)), 2);
    v_addition := round(greatest(0, coalesce(NULLIF(v_item->>'addition', '')::NUMERIC, 0)), 2);
    v_final := round(greatest(0, v_calculated - v_deduction + v_addition), 2);

    IF v_type = 'loading' THEN
      IF v_consignment_id IS NULL OR v_receipt_id IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid loading billing entry';
      END IF;
      UPDATE public.consignments
      SET workmen_loading_bill_id = v_bill_id,
          workmen_loading_billed_at = now()
      WHERE id = v_consignment_id
        AND branch_id = p_branch_id
        AND workmen_loading_bill_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Consignment is missing, belongs to another branch, or is already loading billed';
      END IF;
      IF p_period_from IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.consignments c
        WHERE c.id = v_consignment_id
          AND (c.consignment_date < p_period_from OR c.consignment_date > p_period_to)
      ) THEN
        RAISE EXCEPTION 'Loading consignment is outside the billing period';
      END IF;
      INSERT INTO public.workmen_bill_items (
        bill_id, charge_type, consignment_id, reference_number, reference_date, package_type,
        calculated_amount, deduction, addition, final_amount
      )
      SELECT v_bill_id, 'loading', c.id, c.consignment_number, c.consignment_date,
        NULLIF(trim(v_item->>'package_type'), ''), v_calculated, v_deduction, v_addition, v_final
      FROM public.consignments c
      WHERE c.id = v_consignment_id;
      v_loading := v_loading + v_final;
    ELSIF v_type = 'unloading' THEN
      IF v_receipt_id IS NULL OR v_consignment_id IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid unloading billing entry';
      END IF;
      UPDATE public.stock_inward_receipts
      SET workmen_unloading_bill_id = v_bill_id,
          workmen_unloading_billed_at = now()
      WHERE id = v_receipt_id
        AND branch_id = p_branch_id
        AND workmen_unloading_bill_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock Inward entry is missing, belongs to another branch, or is already unloading billed';
      END IF;
      IF p_period_from IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.stock_inward_receipts r
        WHERE r.id = v_receipt_id
          AND (r.receipt_date < p_period_from OR r.receipt_date > p_period_to)
      ) THEN
        RAISE EXCEPTION 'Stock Inward entry is outside the billing period';
      END IF;
      INSERT INTO public.workmen_bill_items (
        bill_id, charge_type, stock_inward_receipt_id, reference_number, reference_date, package_type,
        calculated_amount, deduction, addition, final_amount
      )
      SELECT v_bill_id, 'unloading', r.id, coalesce(r.receipt_number, r.id::TEXT), r.receipt_date,
        NULLIF(trim(v_item->>'package_type'), ''), v_calculated, v_deduction, v_addition, v_final
      FROM public.stock_inward_receipts r
      WHERE r.id = v_receipt_id;
      v_unloading := v_unloading + v_final;
    ELSE
      RAISE EXCEPTION 'Charge type must be loading or unloading';
    END IF;
  END LOOP;

  v_total_debits := round(v_loading + v_unloading + v_additional_pay, 2);
  IF v_total_debits <= 0 THEN
    RAISE EXCEPTION 'Workmen Bill total must be greater than zero to post a journal entry';
  END IF;
  IF v_bill_deduction > v_total_debits THEN
    RAISE EXCEPTION 'Bill deduction cannot exceed the loading, unloading, and additional pay total';
  END IF;
  v_payable := round(v_total_debits - v_bill_deduction, 2);

  UPDATE public.workmen_bills
  SET total_loading = v_loading,
      total_unloading = v_unloading,
      grand_total = v_payable,
      updated_at = now()
  WHERE id = v_bill_id;

  SELECT * INTO v_map
  FROM public.tms_account_ledger_mappings
  WHERE branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LTMS account mappings are missing for this Workmen Bill branch';
  END IF;

  IF v_loading > 0 THEN
    IF v_map.workmen_loading_expenditure_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Loading Expenditure account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_loading_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_loading_expenditure_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Loading Expenditure must be an active expenditure ledger from this branch';
    END IF;
  END IF;

  IF v_unloading > 0 THEN
    IF v_map.workmen_unloading_expenditure_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Unloading Expenditure account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_unloading_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_unloading_expenditure_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Unloading Expenditure must be an active expenditure ledger from this branch';
    END IF;
  END IF;

  IF v_additional_pay > 0 THEN
    IF v_map.workmen_additional_pay_expenditure_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Additional Pay account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_additional_pay_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_additional_pay_expenditure_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Additional Pay must be an active expenditure ledger from this branch';
    END IF;
  END IF;

  IF v_payable > 0 THEN
    IF v_map.workmen_payout_liability_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Payout liability account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_payable_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_payout_liability_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'liability';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Payout must be an active liability ledger from this branch';
    END IF;
  END IF;

  IF v_bill_deduction > 0 THEN
    IF v_map.workmen_deduction_income_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Deduction account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_deduction_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_deduction_income_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'income';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Deduction must be an active income ledger from this branch';
    END IF;
  END IF;

  INSERT INTO public.journal_entries (
    entry_date, branch_id, description, reference, source_module, status, approved_at
  )
  VALUES (
    coalesce(p_bill_date, current_date),
    p_branch_id,
    'Workmen Bill ' || v_number,
    'workmen_bill:' || v_bill_id::TEXT,
    'ltms',
    'approved',
    now()
  )
  RETURNING id INTO v_journal_id;

  IF v_loading > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_loading_expenditure_ledger_id,
      v_loading_kind, 'Workmen loading expenditure - ' || v_number, v_loading, 0
    );
  END IF;
  IF v_unloading > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_unloading_expenditure_ledger_id,
      v_unloading_kind, 'Workmen unloading expenditure - ' || v_number, v_unloading, 0
    );
  END IF;
  IF v_additional_pay > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_additional_pay_expenditure_ledger_id,
      v_additional_pay_kind, 'Workmen additional pay - ' || v_number, v_additional_pay, 0
    );
  END IF;
  IF v_payable > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_payout_liability_ledger_id,
      v_payable_kind, 'Workmen payable - ' || v_number, 0, v_payable
    );
  END IF;
  IF v_bill_deduction > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_deduction_income_ledger_id,
      v_deduction_kind, 'Workmen deduction - ' || v_number, 0, v_bill_deduction
    );
  END IF;

  PERFORM public.validate_journal_entry(v_journal_id);

  UPDATE public.workmen_bills
  SET journal_entry_id = v_journal_id,
      updated_at = now()
  WHERE id = v_bill_id;

  RETURN v_bill_id;
END;
$$;

-- Posted Workmen Bills must remain linked to their approved journal entry.
CREATE OR REPLACE FUNCTION public.delete_workmen_bill(p_bill_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal_id UUID;
BEGIN
  IF p_bill_id IS NULL THEN
    RAISE EXCEPTION 'Workmen Bill is required';
  END IF;

  SELECT journal_entry_id INTO v_journal_id
  FROM public.workmen_bills
  WHERE id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workmen Bill not found';
  END IF;
  IF v_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'This Workmen Bill has a posted journal entry and cannot be deleted';
  END IF;

  UPDATE public.consignments
  SET workmen_loading_bill_id = NULL,
      workmen_loading_billed_at = NULL
  WHERE workmen_loading_bill_id = p_bill_id;

  UPDATE public.stock_inward_receipts
  SET workmen_unloading_bill_id = NULL,
      workmen_unloading_billed_at = NULL
  WHERE workmen_unloading_bill_id = p_bill_id;

  DELETE FROM public.workmen_bills WHERE id = p_bill_id;
END;
$$;

COMMIT;
