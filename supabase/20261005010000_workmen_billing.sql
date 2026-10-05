BEGIN;

CREATE TABLE IF NOT EXISTS public.workmen_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number TEXT NOT NULL UNIQUE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
  period_from DATE,
  period_to DATE,
  total_loading NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_loading >= 0),
  total_unloading NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_unloading >= 0),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT workmen_bill_period_check CHECK (
    (period_from IS NULL AND period_to IS NULL) OR
    (period_from IS NOT NULL AND period_to IS NOT NULL AND period_from <= period_to)
  )
);

CREATE TABLE IF NOT EXISTS public.workmen_bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.workmen_bills(id) ON DELETE CASCADE,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('loading', 'unloading')),
  consignment_id UUID REFERENCES public.consignments(id) ON DELETE RESTRICT,
  stock_inward_receipt_id UUID REFERENCES public.stock_inward_receipts(id) ON DELETE RESTRICT,
  reference_number TEXT NOT NULL,
  reference_date DATE,
  package_type TEXT,
  calculated_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (calculated_amount >= 0),
  deduction NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deduction >= 0),
  addition NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (addition >= 0),
  final_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (final_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workmen_bill_item_reference_check CHECK (
    (charge_type = 'loading' AND consignment_id IS NOT NULL AND stock_inward_receipt_id IS NULL) OR
    (charge_type = 'unloading' AND stock_inward_receipt_id IS NOT NULL AND consignment_id IS NULL)
  )
);

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS workmen_loading_bill_id UUID REFERENCES public.workmen_bills(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS workmen_loading_billed_at TIMESTAMPTZ;

ALTER TABLE public.stock_inward_receipts
  ADD COLUMN IF NOT EXISTS workmen_unloading_bill_id UUID REFERENCES public.workmen_bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workmen_unloading_billed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS workmen_loading_item_consignment_uidx
  ON public.workmen_bill_items(consignment_id)
  WHERE charge_type = 'loading';
CREATE UNIQUE INDEX IF NOT EXISTS workmen_unloading_item_receipt_uidx
  ON public.workmen_bill_items(stock_inward_receipt_id)
  WHERE charge_type = 'unloading';
CREATE INDEX IF NOT EXISTS workmen_bills_branch_date_idx
  ON public.workmen_bills(branch_id, bill_date DESC);
CREATE INDEX IF NOT EXISTS workmen_bill_items_bill_idx
  ON public.workmen_bill_items(bill_id, charge_type);

CREATE OR REPLACE FUNCTION public.prevent_workmen_loading_source_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_consignment_id UUID;
BEGIN
  v_consignment_id := COALESCE(OLD.consignment_id, NEW.consignment_id);
  IF EXISTS (
    SELECT 1 FROM public.consignments
    WHERE id = v_consignment_id AND workmen_loading_bill_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Loading-billed consignment package information is locked';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_workmen_loading_package_mutation ON public.consignment_package_information;
CREATE TRIGGER prevent_workmen_loading_package_mutation
BEFORE UPDATE OR DELETE ON public.consignment_package_information
FOR EACH ROW EXECUTE FUNCTION public.prevent_workmen_loading_source_mutation();

CREATE OR REPLACE FUNCTION public.prevent_workmen_loading_consignment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.workmen_loading_bill_id IS NOT NULL THEN
    RAISE EXCEPTION 'Loading-billed consignment cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS prevent_workmen_loading_consignment_delete ON public.consignments;
CREATE TRIGGER prevent_workmen_loading_consignment_delete
BEFORE DELETE ON public.consignments
FOR EACH ROW EXECUTE FUNCTION public.prevent_workmen_loading_consignment_delete();

CREATE OR REPLACE FUNCTION public.create_workmen_bill(
  p_branch_id UUID,
  p_bill_date DATE,
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
  v_type TEXT;
  v_consignment_id UUID;
  v_receipt_id UUID;
  v_calculated NUMERIC(14,2);
  v_deduction NUMERIC(14,2);
  v_addition NUMERIC(14,2);
  v_final NUMERIC(14,2);
  v_loading NUMERIC(14,2) := 0;
  v_unloading NUMERIC(14,2) := 0;
  v_number TEXT;
BEGIN
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Branch is required'; END IF;
  IF (p_period_from IS NULL) <> (p_period_to IS NULL) OR (p_period_from IS NOT NULL AND p_period_from > p_period_to) THEN
    RAISE EXCEPTION 'Billing period is invalid';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN
    RAISE EXCEPTION 'Add at least one loading or unloading entry';
  END IF;

  v_number := 'WB-' || to_char(coalesce(p_bill_date, current_date), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6));
  INSERT INTO public.workmen_bills (bill_number, branch_id, bill_date, period_from, period_to, created_by)
  VALUES (v_number, p_branch_id, coalesce(p_bill_date, current_date), p_period_from, p_period_to, p_created_by)
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
      IF v_consignment_id IS NULL OR v_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid loading billing entry'; END IF;
      UPDATE public.consignments
      SET workmen_loading_bill_id = v_bill_id, workmen_loading_billed_at = now()
      WHERE id = v_consignment_id AND branch_id = p_branch_id AND workmen_loading_bill_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Consignment is missing, belongs to another branch, or is already loading billed'; END IF;
      IF p_period_from IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.consignments c WHERE c.id = v_consignment_id
          AND (c.consignment_date < p_period_from OR c.consignment_date > p_period_to)
      ) THEN RAISE EXCEPTION 'Loading consignment is outside the billing period'; END IF;
      INSERT INTO public.workmen_bill_items (
        bill_id, charge_type, consignment_id, reference_number, reference_date, package_type,
        calculated_amount, deduction, addition, final_amount
      )
      SELECT v_bill_id, 'loading', c.id, c.consignment_number, c.consignment_date,
        NULLIF(trim(v_item->>'package_type'), ''), v_calculated, v_deduction, v_addition, v_final
      FROM public.consignments c WHERE c.id = v_consignment_id;
      v_loading := v_loading + v_final;
    ELSIF v_type = 'unloading' THEN
      IF v_receipt_id IS NULL OR v_consignment_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid unloading billing entry'; END IF;
      UPDATE public.stock_inward_receipts
      SET workmen_unloading_bill_id = v_bill_id, workmen_unloading_billed_at = now()
      WHERE id = v_receipt_id AND branch_id = p_branch_id AND workmen_unloading_bill_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Stock Inward entry is missing, belongs to another branch, or is already unloading billed'; END IF;
      IF p_period_from IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.stock_inward_receipts r WHERE r.id = v_receipt_id
          AND (r.receipt_date < p_period_from OR r.receipt_date > p_period_to)
      ) THEN RAISE EXCEPTION 'Stock Inward entry is outside the billing period'; END IF;
      INSERT INTO public.workmen_bill_items (
        bill_id, charge_type, stock_inward_receipt_id, reference_number, reference_date, package_type,
        calculated_amount, deduction, addition, final_amount
      )
      SELECT v_bill_id, 'unloading', r.id, coalesce(r.receipt_number, r.id::TEXT), r.receipt_date,
        NULLIF(trim(v_item->>'package_type'), ''), v_calculated, v_deduction, v_addition, v_final
      FROM public.stock_inward_receipts r WHERE r.id = v_receipt_id;
      v_unloading := v_unloading + v_final;
    ELSE
      RAISE EXCEPTION 'Charge type must be loading or unloading';
    END IF;
  END LOOP;

  UPDATE public.workmen_bills
  SET total_loading = v_loading, total_unloading = v_unloading, updated_at = now()
  WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.workmen_bills WHERE id = v_bill_id;
  END IF;
  RAISE;
END;
$$;

ALTER TABLE public.workmen_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workmen_bill_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workmen_bills_app ON public.workmen_bills;
CREATE POLICY workmen_bills_app ON public.workmen_bills FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS workmen_bill_items_app ON public.workmen_bill_items;
CREATE POLICY workmen_bill_items_app ON public.workmen_bill_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT ON public.workmen_bills, public.workmen_bill_items TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_workmen_bill(UUID, DATE, DATE, DATE, UUID, JSONB) TO anon, authenticated, service_role;
GRANT ALL ON public.workmen_bills, public.workmen_bill_items TO service_role;

COMMIT;
