-- Fixed LR charge snapshots, billing/posting, payment totals, irreversible
-- adjustment locks, and new branch ledger auto provisioning.
-- Run after the earlier Workmen / Stock Outward / LTMS billing migrations.
-- No historical journal entry or bill is recalculated retroactively.
BEGIN;

ALTER TABLE public.ltms_transporters
  ADD COLUMN IF NOT EXISTS per_consignment_charges NUMERIC(12,2) NOT NULL DEFAULT 0
  CHECK (per_consignment_charges >= 0);

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS fixed_lr_charges_ledger_id UUID
  REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.ensure_ltms_fixed_lr_charges_mapping(p_branch_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger_id UUID;
  v_ledger_type TEXT;
  v_is_active BOOLEAN;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Cannot create Fixed LR Charges ledger for an unknown branch';
  END IF;

  -- Reuse a correctly typed existing account rather than duplicate the name.
  SELECT id, ledger_type, is_active
    INTO v_ledger_id, v_ledger_type, v_is_active
  FROM public.ledger_accounts
  WHERE branch_id = p_branch_id AND account_name = 'Fixed LR Charges'
  LIMIT 1;

  IF v_ledger_id IS NULL THEN
    INSERT INTO public.ledger_accounts (
      branch_id, account_name, account_type, description, ledger_type,
      account_kind, opening_balance, is_system, is_active
    ) VALUES (
      p_branch_id, 'Fixed LR Charges', 'expenditure',
      'Auto-created LTMS expenditure ledger for fixed LR charges',
      'expenditure', 'ledger', 0, true, true
    )
    ON CONFLICT (branch_id, account_name) DO NOTHING
    RETURNING id, ledger_type, is_active
      INTO v_ledger_id, v_ledger_type, v_is_active;

    IF v_ledger_id IS NULL THEN
      SELECT id, ledger_type, is_active
        INTO v_ledger_id, v_ledger_type, v_is_active
      FROM public.ledger_accounts
      WHERE branch_id = p_branch_id AND account_name = 'Fixed LR Charges'
      LIMIT 1;
    END IF;
  END IF;

  IF v_ledger_id IS NULL OR v_ledger_type <> 'expenditure'
     OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Fixed LR Charges must be an active expenditure ledger in branch %', p_branch_id;
  END IF;

  UPDATE public.tms_account_ledger_mappings
  SET fixed_lr_charges_ledger_id = v_ledger_id,
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND fixed_lr_charges_ledger_id IS NULL;

  RETURN v_ledger_id;
END;
$$;

-- Extend the existing branch auto-create flow WITHOUT replacing the long
-- provision_branch_mapping_accounts() function or its other account mappings.
CREATE OR REPLACE FUNCTION public.auto_map_ltms_fixed_lr_charges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_ltms_fixed_lr_charges_mapping(NEW.branch_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_map_ltms_fixed_lr_charges
  ON public.tms_account_ledger_mappings;

CREATE TRIGGER trg_auto_map_ltms_fixed_lr_charges
  AFTER INSERT ON public.tms_account_ledger_mappings
  FOR EACH ROW EXECUTE FUNCTION public.auto_map_ltms_fixed_lr_charges();

-- Existing branch mappings receive one expenditure ledger each.
-- Mappings that are already configured are never overwritten.
DO $$
DECLARE
  v_branch_id UUID;
BEGIN
  FOR v_branch_id IN
    SELECT branch_id
    FROM public.tms_account_ledger_mappings
    WHERE fixed_lr_charges_ledger_id IS NULL
  LOOP
    PERFORM public.ensure_ltms_fixed_lr_charges_mapping(v_branch_id);
  END LOOP;
END;
$$;


-- NULL means a new/unassigned consignment has not yet snapshotted a rate;
-- zero is a real locked snapshot and will never follow master rate edits.
ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS fixed_lr_charges NUMERIC(14,2)
    CHECK (fixed_lr_charges >= 0),
  ADD COLUMN IF NOT EXISTS charge_adjustments_locked_at TIMESTAMPTZ;

-- Previously billed consignments used journals without a Fixed LR debit:
-- preserve that historical outcome at zero rather than rewriting old bills.
UPDATE public.consignments c
SET fixed_lr_charges = CASE
  WHEN c.transporter_bill_id IS NOT NULL THEN 0
  ELSE round(coalesce(t.per_consignment_charges, 0), 2)
END
FROM public.ltms_transporters t
WHERE c.transporter_id = t.id
  AND lower(coalesce(c.consignment_type, '')) = 'third_party'
  AND c.fixed_lr_charges IS NULL;

UPDATE public.consignments
SET charge_adjustments_locked_at = coalesce(
  charge_adjustments_locked_at, workmen_loading_billed_at, now()
)
WHERE charge_adjustments_locked_at IS NULL
  AND (transporter_bill_id IS NOT NULL OR workmen_loading_bill_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.snapshot_and_lock_consignment_charges()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF lower(coalesce(NEW.consignment_type, '')) = 'third_party' AND NEW.transporter_id IS NOT NULL THEN
      SELECT round(coalesce(per_consignment_charges, 0), 2)
        INTO NEW.fixed_lr_charges
      FROM public.ltms_transporters WHERE id = NEW.transporter_id;
    ELSE
      NEW.fixed_lr_charges := NULL;
    END IF;
    IF NEW.transporter_bill_id IS NOT NULL OR NEW.workmen_loading_bill_id IS NOT NULL THEN
      NEW.charge_adjustments_locked_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.fixed_lr_charges IS NOT NULL
     AND NEW.fixed_lr_charges IS DISTINCT FROM OLD.fixed_lr_charges THEN
    RAISE EXCEPTION 'Fixed LR charge was snapshotted and cannot be changed on this consignment';
  END IF;
  IF OLD.fixed_lr_charges IS NULL THEN
    IF lower(coalesce(NEW.consignment_type, '')) = 'third_party' AND NEW.transporter_id IS NOT NULL THEN
      SELECT round(coalesce(per_consignment_charges, 0), 2)
        INTO NEW.fixed_lr_charges
      FROM public.ltms_transporters WHERE id = NEW.transporter_id;
    ELSE
      NEW.fixed_lr_charges := NULL;
    END IF;
  END IF;
  IF OLD.charge_adjustments_locked_at IS NOT NULL
     AND NEW.charge_adjustments_locked_at IS DISTINCT FROM OLD.charge_adjustments_locked_at THEN
    RAISE EXCEPTION 'Previously billed consignment adjustment lock cannot be removed';
  END IF;
  IF OLD.charge_adjustments_locked_at IS NOT NULL
     OR OLD.transporter_bill_id IS NOT NULL
     OR OLD.workmen_loading_bill_id IS NOT NULL THEN
    IF NEW.freight_deduction IS DISTINCT FROM OLD.freight_deduction
       OR NEW.additional_freight IS DISTINCT FROM OLD.additional_freight
       OR NEW.loading_deduction IS DISTINCT FROM OLD.loading_deduction
       OR NEW.additional_loading IS DISTINCT FROM OLD.additional_loading THEN
      RAISE EXCEPTION 'This consignment has already been billed; financial adjustments are locked';
    END IF;
  END IF;

  IF NEW.charge_adjustments_locked_at IS NULL
     AND (NEW.transporter_bill_id IS NOT NULL OR NEW.workmen_loading_bill_id IS NOT NULL) THEN
    NEW.charge_adjustments_locked_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_and_lock_consignment_charges ON public.consignments;
CREATE TRIGGER snapshot_and_lock_consignment_charges
  BEFORE INSERT OR UPDATE ON public.consignments
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_and_lock_consignment_charges();

-- Block any package quantity/rate changes after the consignment was billed.
CREATE OR REPLACE FUNCTION public.prevent_billed_consignment_package_changes()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN v_id := NEW.consignment_id;
  ELSE v_id := OLD.consignment_id; END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignments
    WHERE id = v_id
      AND (charge_adjustments_locked_at IS NOT NULL
        OR transporter_bill_id IS NOT NULL
        OR workmen_loading_bill_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Billed consignment package charges are locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_billed_consignment_package_changes
  ON public.consignment_package_information;
CREATE TRIGGER prevent_billed_consignment_package_changes
  BEFORE INSERT OR UPDATE OR DELETE ON public.consignment_package_information
  FOR EACH ROW EXECUTE FUNCTION public.prevent_billed_consignment_package_changes();

-- Workmen loading/unloading adjustment lock survives deletion of a bill:
-- no changing the old rates and then re-billing the same source.
ALTER TABLE public.stock_inward_receipts
  ADD COLUMN IF NOT EXISTS workmen_adjustments_locked_at TIMESTAMPTZ;
UPDATE public.stock_inward_receipts
SET workmen_adjustments_locked_at = coalesce(workmen_unloading_billed_at, now())
WHERE workmen_unloading_bill_id IS NOT NULL
  AND workmen_adjustments_locked_at IS NULL;

CREATE OR REPLACE FUNCTION public.lock_workmen_inward_adjustments()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.workmen_adjustments_locked_at IS NOT NULL
     AND NEW.workmen_adjustments_locked_at IS DISTINCT FROM OLD.workmen_adjustments_locked_at THEN
    RAISE EXCEPTION 'Workmen-billed Stock Inward adjustment lock cannot be removed';
  END IF;
  IF OLD.workmen_adjustments_locked_at IS NOT NULL
     OR OLD.workmen_unloading_bill_id IS NOT NULL THEN
    IF NEW.unloading_deduction IS DISTINCT FROM OLD.unloading_deduction
       OR NEW.additional_unloading IS DISTINCT FROM OLD.additional_unloading THEN
      RAISE EXCEPTION 'Unloading adjustments are locked after Workmen billing';
    END IF;
  END IF;
  IF NEW.workmen_adjustments_locked_at IS NULL AND NEW.workmen_unloading_bill_id IS NOT NULL THEN
    NEW.workmen_adjustments_locked_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lock_workmen_inward_adjustments ON public.stock_inward_receipts;
CREATE TRIGGER lock_workmen_inward_adjustments
  BEFORE UPDATE ON public.stock_inward_receipts
  FOR EACH ROW EXECUTE FUNCTION public.lock_workmen_inward_adjustments();

ALTER TABLE public.stock_outward_receipts
  ADD COLUMN IF NOT EXISTS workmen_adjustments_locked_at TIMESTAMPTZ;
UPDATE public.stock_outward_receipts
SET workmen_adjustments_locked_at = coalesce(workmen_loading_billed_at, now())
WHERE workmen_loading_bill_id IS NOT NULL
  AND workmen_adjustments_locked_at IS NULL;
CREATE OR REPLACE FUNCTION public.lock_workmen_outward_adjustments()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.workmen_adjustments_locked_at IS NOT NULL
     AND NEW.workmen_adjustments_locked_at IS DISTINCT FROM OLD.workmen_adjustments_locked_at THEN
    RAISE EXCEPTION 'Workmen-billed Stock Outward adjustment lock cannot be removed';
  END IF;
  IF NEW.workmen_adjustments_locked_at IS NULL AND NEW.workmen_loading_bill_id IS NOT NULL THEN
    NEW.workmen_adjustments_locked_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lock_workmen_outward_adjustments ON public.stock_outward_receipts;
CREATE TRIGGER lock_workmen_outward_adjustments
  BEFORE UPDATE ON public.stock_outward_receipts
  FOR EACH ROW EXECUTE FUNCTION public.lock_workmen_outward_adjustments();

-- Package quantity and rate rows cannot change after Workmen billing,
-- even if the workmen bill is later deleted and its FK is cleared.
CREATE OR REPLACE FUNCTION public.prevent_workmen_billed_stock_package_changes()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $
DECLARE
  v_receipt_id UUID;
  v_locked BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN v_receipt_id := NEW.receipt_id;
  ELSE v_receipt_id := OLD.receipt_id; END IF;

  IF TG_TABLE_NAME = 'stock_inward_packages' THEN
    SELECT (workmen_adjustments_locked_at IS NOT NULL OR workmen_unloading_bill_id IS NOT NULL)
      INTO v_locked FROM public.stock_inward_receipts WHERE id = v_receipt_id;
  ELSE
    SELECT (workmen_adjustments_locked_at IS NOT NULL OR workmen_loading_bill_id IS NOT NULL)
      INTO v_locked FROM public.stock_outward_receipts WHERE id = v_receipt_id;
  END IF;

  IF coalesce(v_locked, false) THEN
    RAISE EXCEPTION 'Stock package charges are locked after Workmen billing';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS prevent_workmen_billed_inward_package_changes ON public.stock_inward_packages;
CREATE TRIGGER prevent_workmen_billed_inward_package_changes
  BEFORE INSERT OR UPDATE OR DELETE ON public.stock_inward_packages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_workmen_billed_stock_package_changes();

DROP TRIGGER IF EXISTS prevent_workmen_billed_outward_package_changes ON public.stock_outward_packages;
CREATE TRIGGER prevent_workmen_billed_outward_package_changes
  BEFORE INSERT OR UPDATE OR DELETE ON public.stock_outward_packages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_workmen_billed_stock_package_changes();

-- Preserve generated workmen bill item/bill amounts after posting.
CREATE OR REPLACE FUNCTION public.prevent_workmen_bill_charge_edit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.calculated_amount, NEW.deduction, NEW.addition, NEW.final_amount,
         NEW.bill_id, NEW.charge_type, NEW.consignment_id, NEW.stock_inward_receipt_id)
     IS DISTINCT FROM
     ROW(OLD.calculated_amount, OLD.deduction, OLD.addition, OLD.final_amount,
         OLD.bill_id, OLD.charge_type, OLD.consignment_id, OLD.stock_inward_receipt_id) THEN
    RAISE EXCEPTION 'Generated Workmen Bill item adjustments are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_workmen_bill_charge_edit ON public.workmen_bill_items;
CREATE TRIGGER prevent_workmen_bill_charge_edit
  BEFORE UPDATE ON public.workmen_bill_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_workmen_bill_charge_edit();

CREATE OR REPLACE FUNCTION public.prevent_posted_workmen_bill_adjustments()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.journal_entry_id IS NOT NULL
     AND ROW(NEW.total_loading, NEW.total_unloading,
             NEW.additional_pay_amount, NEW.deduction_amount, NEW.grand_total)
       IS DISTINCT FROM
         ROW(OLD.total_loading, OLD.total_unloading,
             OLD.additional_pay_amount, OLD.deduction_amount, OLD.grand_total)
  THEN RAISE EXCEPTION 'Posted Workmen Bill adjustments are immutable'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_posted_workmen_bill_adjustments ON public.workmen_bills;
CREATE TRIGGER prevent_posted_workmen_bill_adjustments
  BEFORE UPDATE ON public.workmen_bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_workmen_bill_adjustments();

-- The original Workmen and Stock Outward generators remain unchanged.
-- They still update bill links while adjustment amounts remain immutable.

-- Bill-level and item-level snapshots are immutable.
ALTER TABLE public.ltms_transporter_bills
  ADD COLUMN IF NOT EXISTS total_fixed_lr NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (total_fixed_lr >= 0);
ALTER TABLE public.ltms_transporter_bill_items
  ADD COLUMN IF NOT EXISTS fixed_lr_charges NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (fixed_lr_charges >= 0);

CREATE OR REPLACE FUNCTION public.prevent_ltms_transporter_bill_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.system_number IS DISTINCT FROM OLD.system_number
     OR NEW.system_date IS DISTINCT FROM OLD.system_date
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.transporter_id IS DISTINCT FROM OLD.transporter_id
     OR NEW.transporter_source_id IS DISTINCT FROM OLD.transporter_source_id
     OR NEW.transporter_bill_number IS DISTINCT FROM OLD.transporter_bill_number
     OR NEW.transporter_bill_date IS DISTINCT FROM OLD.transporter_bill_date
     OR NEW.period_from IS DISTINCT FROM OLD.period_from
     OR NEW.period_to IS DISTINCT FROM OLD.period_to
     OR NEW.total_freight IS DISTINCT FROM OLD.total_freight
     OR NEW.total_loading IS DISTINCT FROM OLD.total_loading
     OR NEW.total_fixed_lr IS DISTINCT FROM OLD.total_fixed_lr
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Generated transporter bills are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_ltms_transporter_bill_mutation ON public.ltms_transporter_bills;
CREATE TRIGGER prevent_ltms_transporter_bill_mutation
  BEFORE UPDATE ON public.ltms_transporter_bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ltms_transporter_bill_mutation();


CREATE OR REPLACE FUNCTION public.generate_ltms_transporter_bill(
  p_branch_id UUID,
  p_transporter_id UUID,
  p_transporter_source_id UUID,
  p_system_date DATE,
  p_transporter_bill_number TEXT,
  p_transporter_bill_date DATE,
  p_period_from DATE DEFAULT NULL,
  p_period_to DATE DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_id UUID;
  v_item JSONB;
  v_consign public.consignments%ROWTYPE;
  v_source public.ltms_transporter_sources%ROWTYPE;
  v_journal UUID;
  v_freight NUMERIC(14, 2) := 0;
  v_loading NUMERIC(14, 2) := 0;
  v_fixed NUMERIC(14, 2) := 0;
  v_fixed_ledger_id UUID;
  v_fixed_kind TEXT;
  v_freight_kind TEXT;
  v_loading_kind TEXT;
  v_source_kind TEXT;
BEGIN
  SELECT * INTO v_source
  FROM public.ltms_transporter_sources
  WHERE id = p_transporter_source_id
    AND transporter_id = p_transporter_id
    AND branch_id = p_branch_id
    AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected transporter source does not belong to the selected transporter and branch'; END IF;
  IF v_source.liability_ledger_id IS NULL OR v_source.freight_expenditure_ledger_id IS NULL OR v_source.loading_expenditure_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map Transporter source, Freight expenditure and Loading expenditure accounts before generating a bill';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.liability_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'liability')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.freight_expenditure_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.loading_expenditure_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure') THEN
    RAISE EXCEPTION 'Transporter source, Freight and Loading accounts must be active accounts from the selected branch with Liability/Expenditure ledger types';
  END IF;
  IF nullif(trim(p_transporter_bill_number), '') IS NULL OR p_transporter_bill_date IS NULL THEN
    RAISE EXCEPTION 'Transporter bill number and bill date are required';
  END IF;
  IF (p_period_from IS NULL) <> (p_period_to IS NULL) OR p_period_from > p_period_to THEN
    RAISE EXCEPTION 'Both duration dates are required and From Date cannot be after To Date';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN RAISE EXCEPTION 'Select at least one consignment'; END IF;

  -- Compute immutable bill totals before inserting the bill. Updating totals after
  -- insertion would correctly be rejected by the generated-bill immutability trigger.
  SELECT
    coalesce(sum(greatest(0, coalesce(NULLIF(item.value->>'final_freight', '')::NUMERIC, 0))), 0),
    coalesce(sum(greatest(0, coalesce(NULLIF(item.value->>'final_loading', '')::NUMERIC, 0))), 0)
  INTO v_freight, v_loading
  FROM jsonb_array_elements(coalesce(p_items, '[]'::JSONB)) AS item(value);

  -- Calculate fixed charges from immutable CONSIGNMENT snapshots, never from
  -- JSON sent by a client or the transporter's current master rate.
  SELECT round(coalesce(sum(coalesce(c.fixed_lr_charges, 0)), 0), 2)
    INTO v_fixed
  FROM jsonb_array_elements(coalesce(p_items, '[]'::JSONB)) AS item(value)
  JOIN public.consignments c ON c.id = NULLIF(item.value->>'consignment_id', '')::UUID;

  IF v_fixed > 0 THEN
    SELECT fixed_lr_charges_ledger_id INTO v_fixed_ledger_id
    FROM public.tms_account_ledger_mappings WHERE branch_id = p_branch_id;
    SELECT account_kind INTO v_fixed_kind
    FROM public.ledger_accounts
    WHERE id = v_fixed_ledger_id AND branch_id = p_branch_id
      AND ledger_type = 'expenditure' AND is_active;
    IF v_fixed_kind IS NULL THEN
      RAISE EXCEPTION 'Map an active Fixed LR Charges expenditure ledger for this branch in Settings > LTMS Accounts Map';
    END IF;
  END IF;

  SELECT account_kind INTO v_source_kind FROM public.ledger_accounts WHERE id = v_source.liability_ledger_id;
  SELECT account_kind INTO v_freight_kind FROM public.ledger_accounts WHERE id = v_source.freight_expenditure_ledger_id;
  SELECT account_kind INTO v_loading_kind FROM public.ledger_accounts WHERE id = v_source.loading_expenditure_ledger_id;

  INSERT INTO public.ltms_transporter_bills (
    branch_id, transporter_id, transporter_source_id, system_date,
    transporter_bill_number, transporter_bill_date, period_from, period_to,
    total_freight, total_loading, total_fixed_lr, created_by
  ) VALUES (
    p_branch_id, p_transporter_id, p_transporter_source_id, coalesce(p_system_date, current_date),
    trim(p_transporter_bill_number), p_transporter_bill_date, p_period_from, p_period_to, round(v_freight, 2), round(v_loading, 2), round(v_fixed, 2), p_created_by
  ) RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_consign FROM public.consignments
    WHERE id = NULLIF(v_item->>'consignment_id', '')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected consignment was not found'; END IF;
    IF v_consign.branch_id IS DISTINCT FROM p_branch_id OR v_consign.transporter_id IS DISTINCT FROM p_transporter_id OR v_consign.transporter_source_id IS DISTINCT FROM p_transporter_source_id THEN
      RAISE EXCEPTION 'Selected consignments must use the chosen branch, transporter and transporter source';
    END IF;
    IF v_consign.transporter_bill_id IS NOT NULL THEN RAISE EXCEPTION 'A selected consignment has already been transporter billed'; END IF;
    IF p_period_from IS NOT NULL AND (v_consign.consignment_date < p_period_from OR v_consign.consignment_date > p_period_to) THEN
      RAISE EXCEPTION 'Selected consignment is outside the transporter billing duration';
    END IF;

    -- Save the final pre-bill adjustment values to the consignment.
    -- The BEFORE UPDATE trigger forbids changing them if Workmen already
    -- locked this consignment, and the subsequent transporter link locks them.
    IF round(greatest(0,
         coalesce(NULLIF(v_item->>'calculated_freight', '')::NUMERIC, 0)
         - coalesce(NULLIF(v_item->>'freight_deduction', '')::NUMERIC, 0)
         + coalesce(NULLIF(v_item->>'additional_freight', '')::NUMERIC, 0)), 2)
       IS DISTINCT FROM round(greatest(0, coalesce(NULLIF(v_item->>'final_freight', '')::NUMERIC, 0)), 2)
       OR round(greatest(0,
         coalesce(NULLIF(v_item->>'calculated_loading', '')::NUMERIC, 0)
         - coalesce(NULLIF(v_item->>'loading_deduction', '')::NUMERIC, 0)
         + coalesce(NULLIF(v_item->>'additional_loading', '')::NUMERIC, 0)), 2)
       IS DISTINCT FROM round(greatest(0, coalesce(NULLIF(v_item->>'final_loading', '')::NUMERIC, 0)), 2)
    THEN
      RAISE EXCEPTION 'Submitted final Freight or Loading does not match the adjustments';
    END IF;

    UPDATE public.consignments
    SET freight_deduction = round(coalesce(NULLIF(v_item->>'freight_deduction', '')::NUMERIC, 0), 2),
        additional_freight = round(coalesce(NULLIF(v_item->>'additional_freight', '')::NUMERIC, 0), 2),
        loading_deduction = round(coalesce(NULLIF(v_item->>'loading_deduction', '')::NUMERIC, 0), 2),
        additional_loading = round(coalesce(NULLIF(v_item->>'additional_loading', '')::NUMERIC, 0), 2)
    WHERE id = v_consign.id;

    INSERT INTO public.ltms_transporter_bill_items (
      bill_id, consignment_id, consignment_number, consignment_date, from_pin_code, to_pin_code,
      calculated_freight, freight_deduction, additional_freight, final_freight,
      calculated_loading, loading_deduction, additional_loading, final_loading,
      fixed_lr_charges
    ) VALUES (
      v_bill_id, v_consign.id, v_consign.consignment_number, v_consign.consignment_date,
      coalesce(v_item->>'from_pin_code', v_consign.from_pin_code, ''), coalesce(v_item->>'to_pin_code', v_consign.to_pin_code, ''),
      round(coalesce(NULLIF(v_item->>'calculated_freight', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'freight_deduction', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'additional_freight', '')::NUMERIC, 0), 2),
      round(greatest(0, coalesce(NULLIF(v_item->>'final_freight', '')::NUMERIC, 0)), 2),
      round(coalesce(NULLIF(v_item->>'calculated_loading', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'loading_deduction', '')::NUMERIC, 0), 2),
      round(coalesce(NULLIF(v_item->>'additional_loading', '')::NUMERIC, 0), 2),
      round(greatest(0, coalesce(NULLIF(v_item->>'final_loading', '')::NUMERIC, 0)), 2),
      round(coalesce(v_consign.fixed_lr_charges, 0), 2)
    );
    UPDATE public.consignments SET transporter_bill_id = v_bill_id WHERE id = v_consign.id;
  END LOOP;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (p_transporter_bill_date, p_branch_id, 'Transporter bill ' || (SELECT transporter_bill_number FROM public.ltms_transporter_bills WHERE id = v_bill_id), 'ltms_transporter_bill:' || v_bill_id, 'ltms', 'approved', now())
  RETURNING id INTO v_journal;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_journal, 1, p_branch_id, v_source.freight_expenditure_ledger_id, v_freight_kind, 'Freight expenditure - transporter bill', round(v_freight, 2), 0),
    (v_journal, 2, p_branch_id, v_source.loading_expenditure_ledger_id, v_loading_kind, 'Loading expenditure - transporter bill', round(v_loading, 2), 0),
    (v_journal, 3, p_branch_id, v_source.liability_ledger_id, v_source_kind, 'Transporter source payable - transporter bill', 0, round(v_freight + v_loading + v_fixed, 2));
  IF v_fixed > 0 THEN
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal, 4, p_branch_id, v_fixed_ledger_id, v_fixed_kind,
      'Fixed LR Charges expenditure - transporter bill', round(v_fixed, 2), 0
    );
  END IF;
  PERFORM public.validate_journal_entry(v_journal);
  UPDATE public.ltms_transporter_bills SET journal_entry_id = v_journal WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE reference = 'ltms_transporter_bill:' || v_bill_id;
    DELETE FROM public.ltms_transporter_bill_items WHERE bill_id = v_bill_id;
    UPDATE public.consignments SET transporter_bill_id = NULL WHERE transporter_bill_id = v_bill_id;
    DELETE FROM public.ltms_transporter_bills WHERE id = v_bill_id;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_ltms_transporter_bill(UUID, UUID, UUID, DATE, TEXT, DATE, DATE, DATE, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_ltms_transporter_bill(UUID, UUID, UUID, DATE, TEXT, DATE, DATE, DATE, UUID, JSONB) TO anon, authenticated, service_role;


-- Generated transporter bill items are a permanent billing snapshot, including
-- per-consignment Fixed LR Charges. No direct editing or removal is permitted.
CREATE OR REPLACE FUNCTION public.prevent_ltms_transporter_bill_item_changes()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Generated Transporter Bill items are immutable';
  END IF;
  RAISE EXCEPTION 'Generated Transporter Bill items cannot be removed';
END;
$;
DROP TRIGGER IF EXISTS prevent_ltms_transporter_bill_item_changes
  ON public.ltms_transporter_bill_items;
CREATE TRIGGER prevent_ltms_transporter_bill_item_changes
  BEFORE UPDATE OR DELETE ON public.ltms_transporter_bill_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ltms_transporter_bill_item_changes();

-- Payment and outstanding balances include the newly posted Fixed LR amount.
ALTER TABLE public.ltms_transporter_bills
  DROP CONSTRAINT IF EXISTS ltms_transporter_bills_paid_amount_check;
ALTER TABLE public.ltms_transporter_bills
  ADD CONSTRAINT ltms_transporter_bills_paid_amount_check
  CHECK (paid_amount >= 0
    AND paid_amount <= total_freight + total_loading + total_fixed_lr);

CREATE OR REPLACE FUNCTION public.validate_ltms_transporter_bill_payment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid_total NUMERIC(14,2);
  v_last_account UUID;
  v_bill_total NUMERIC(14,2);
BEGIN
  SELECT round(coalesce(sum(amount), 0), 2),
         (array_agg(payment_ledger_id ORDER BY created_at DESC, id DESC))[1]
    INTO v_paid_total, v_last_account
  FROM public.ltms_transporter_bill_payments
  WHERE bill_id = NEW.id;

  v_bill_total := round(coalesce(NEW.total_freight, 0) + coalesce(NEW.total_loading, 0) + coalesce(NEW.total_fixed_lr, 0), 2);
  IF round(coalesce(NEW.paid_amount, 0), 2) <> v_paid_total THEN
    RAISE EXCEPTION 'Transporter Bill paid amount must match its posted payment history';
  END IF;
  IF NEW.paid_amount = 0 THEN
    IF NEW.paid_at IS NOT NULL OR NEW.paid_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'An unpaid Transporter Bill cannot have payment metadata';
    END IF;
  ELSE
    IF NEW.paid_account_id IS DISTINCT FROM v_last_account THEN
      RAISE EXCEPTION 'Transporter Bill payment account must match its latest posted payment';
    END IF;
    IF (NEW.paid_amount = v_bill_total) IS DISTINCT FROM (NEW.paid_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Transporter Bill paid timestamp must match its fully-paid status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_ltms_transporter_bill_payment_totals ON public.ltms_transporter_bills;
CREATE TRIGGER validate_ltms_transporter_bill_payment_totals
  BEFORE UPDATE OF paid_amount, paid_at, paid_account_id ON public.ltms_transporter_bills
  FOR EACH ROW EXECUTE FUNCTION public.validate_ltms_transporter_bill_payment_totals();
REVOKE ALL ON FUNCTION public.validate_ltms_transporter_bill_payment_totals() FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.record_ltms_transporter_bill_payment(
  p_bill_id UUID,
  p_payment_ledger_id UUID,
  p_amount NUMERIC,
  p_paid_date DATE DEFAULT CURRENT_DATE,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.ltms_transporter_bills%ROWTYPE;
  v_payment_account public.ledger_accounts%ROWTYPE;
  v_payable_ledger_id UUID;
  v_payable_kind TEXT;
  v_payment_id UUID;
  v_journal_id UUID;
  v_amount NUMERIC(14,2);
  v_bill_total NUMERIC(14,2);
  v_new_paid NUMERIC(14,2);
BEGIN
  IF p_bill_id IS NULL THEN
    RAISE EXCEPTION 'Select a Transporter Bill to pay';
  END IF;

  SELECT * INTO v_bill
  FROM public.ltms_transporter_bills
  WHERE id = p_bill_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transporter Bill was not found or has been deleted';
  END IF;
  IF v_bill.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'This Transporter Bill has no posted payable journal and cannot be paid';
  END IF;

  v_amount := round(coalesce(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF p_paid_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  v_bill_total := round(coalesce(v_bill.total_freight, 0) + coalesce(v_bill.total_loading, 0) + coalesce(v_bill.total_fixed_lr, 0), 2);
  IF round(coalesce(v_bill.paid_amount, 0) + v_amount, 2) > v_bill_total THEN
    RAISE EXCEPTION 'Payment exceeds the Transporter Bill balance of %',
      round(v_bill_total - coalesce(v_bill.paid_amount, 0), 2);
  END IF;

  SELECT * INTO v_payment_account
  FROM public.ledger_accounts
  WHERE id = p_payment_ledger_id
    AND branch_id = v_bill.branch_id
    AND is_active
    AND ledger_type IN ('bank', 'cash');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an active cash or bank account from the Transporter Bill branch';
  END IF;

  -- Settle the liability account credited on this original bill, even if the
  -- transporter source's account mapping was changed after bill generation.
  SELECT ledger_account_id INTO v_payable_ledger_id
  FROM public.journal_lines
  WHERE journal_entry_id = v_bill.journal_entry_id
    AND line_description LIKE 'Transporter source payable - transporter bill%'
    AND credit > 0
  ORDER BY line_no
  LIMIT 1;
  IF v_payable_ledger_id IS NULL THEN
    RAISE EXCEPTION 'The Transporter Bill journal has no posted transporter source payable line';
  END IF;

  SELECT account_kind INTO v_payable_kind
  FROM public.ledger_accounts
  WHERE id = v_payable_ledger_id
    AND branch_id = v_bill.branch_id
    AND is_active
    AND ledger_type = 'liability';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The transporter payable ledger used by this bill is no longer active in its branch';
  END IF;

  v_new_paid := round(coalesce(v_bill.paid_amount, 0) + v_amount, 2);
  v_payment_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    entry_date, branch_id, description, reference, source_module, status, approved_at
  )
  VALUES (
    p_paid_date,
    v_bill.branch_id,
    'Transporter Bill ' || v_bill.transporter_bill_number || ' payment | ' || v_payment_account.account_name || ' | ' || v_amount::TEXT,
    'ltms_transporter_bill_payment:' || v_payment_id::TEXT,
    'ltms',
    'approved',
    now()
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.ltms_transporter_bill_payments (
    id, bill_id, payment_date, amount, payment_ledger_id, journal_entry_id, created_by
  )
  VALUES (
    v_payment_id, p_bill_id, p_paid_date, v_amount,
    p_payment_ledger_id, v_journal_id, p_created_by
  );

  INSERT INTO public.journal_lines (
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  )
  VALUES
    (v_journal_id, 1, v_bill.branch_id, v_payable_ledger_id, v_payable_kind,
     'Transporter source payable settled - ' || v_bill.transporter_bill_number, v_amount, 0),
    (v_journal_id, 2, v_bill.branch_id, v_payment_account.id, v_payment_account.account_kind,
     'Transporter payment from ' || v_payment_account.account_name || ' - ' || v_bill.transporter_bill_number, 0, v_amount);

  PERFORM public.validate_journal_entry(v_journal_id);

  UPDATE public.ltms_transporter_bills
  SET paid_amount = v_new_paid,
      paid_at = CASE WHEN v_new_paid = v_bill_total THEN now() ELSE NULL END,
      paid_account_id = p_payment_ledger_id
  WHERE id = p_bill_id;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ltms_transporter_bill_payment(UUID, UUID, NUMERIC, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ltms_transporter_bill_payment(UUID, UUID, NUMERIC, DATE, UUID)
  TO anon, authenticated, service_role;


COMMIT;
