BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.ltms_source_bill_number_seq;

CREATE TABLE IF NOT EXISTS public.ltms_source_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number TEXT NOT NULL UNIQUE DEFAULT ('SB-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || lpad(nextval('public.ltms_source_bill_number_seq')::TEXT, 5, '0')),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  bill_date DATE NOT NULL,
  due_date DATE NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  total_freight NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_loading NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT ltms_source_bills_dates_check CHECK (period_from <= period_to AND bill_date >= period_from),
  CONSTRAINT ltms_source_bills_due_date_check CHECK (due_date >= bill_date)
);

CREATE TABLE IF NOT EXISTS public.ltms_source_bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.ltms_source_bills(id) ON DELETE RESTRICT,
  consignment_id UUID NOT NULL UNIQUE REFERENCES public.consignments(id) ON DELETE RESTRICT,
  consignment_number TEXT NOT NULL,
  consignment_date DATE,
  from_pin_code TEXT NOT NULL DEFAULT '',
  to_pin_code TEXT NOT NULL DEFAULT '',
  calculated_freight NUMERIC(14, 2) NOT NULL DEFAULT 0,
  freight_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0,
  additional_freight NUMERIC(14, 2) NOT NULL DEFAULT 0,
  final_freight NUMERIC(14, 2) NOT NULL DEFAULT 0,
  calculated_loading NUMERIC(14, 2) NOT NULL DEFAULT 0,
  loading_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0,
  additional_loading NUMERIC(14, 2) NOT NULL DEFAULT 0,
  final_loading NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS source_bill_id UUID REFERENCES public.ltms_source_bills(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_billed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ltms_source_bills_filter_idx
  ON public.ltms_source_bills (branch_id, source_id, bill_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ltms_source_bill_items_bill_idx
  ON public.ltms_source_bill_items (bill_id);
CREATE INDEX IF NOT EXISTS consignments_source_billing_idx
  ON public.consignments (branch_id, source_id, billing_status, consignment_date DESC);

ALTER TABLE public.ltms_source_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltms_source_bill_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.ltms_source_bills TO anon, authenticated;
GRANT SELECT, INSERT ON public.ltms_source_bill_items TO anon, authenticated;
GRANT ALL ON public.ltms_source_bills, public.ltms_source_bill_items TO service_role;
DROP POLICY IF EXISTS ltms_source_bills_app ON public.ltms_source_bills;
CREATE POLICY ltms_source_bills_app ON public.ltms_source_bills
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ltms_source_bill_items_app ON public.ltms_source_bill_items;
CREATE POLICY ltms_source_bill_items_app ON public.ltms_source_bill_items
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.prevent_source_bill_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.bill_number IS DISTINCT FROM OLD.bill_number
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.bill_date IS DISTINCT FROM OLD.bill_date
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.period_from IS DISTINCT FROM OLD.period_from
     OR NEW.period_to IS DISTINCT FROM OLD.period_to
     OR NEW.total_freight IS DISTINCT FROM OLD.total_freight
     OR NEW.total_loading IS DISTINCT FROM OLD.total_loading
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Generated source bills are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_source_bill_mutation ON public.ltms_source_bills;
CREATE TRIGGER prevent_source_bill_mutation
  BEFORE UPDATE ON public.ltms_source_bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_source_bill_mutation();

CREATE OR REPLACE FUNCTION public.prevent_billed_consignment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_bill_id IS NOT NULL OR OLD.billing_status IN ('billed', 'billed_and_paid') THEN
      RAISE EXCEPTION 'A source-billed consignment cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.source_bill_id IS NOT NULL THEN
    IF NEW.source_bill_id IS DISTINCT FROM OLD.source_bill_id
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.consignment_date IS DISTINCT FROM OLD.consignment_date
       OR NEW.billing_status IS DISTINCT FROM OLD.billing_status THEN
      RAISE EXCEPTION 'A source-billed consignment is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_billed_consignment_mutation ON public.consignments;
CREATE TRIGGER prevent_billed_consignment_mutation
  BEFORE UPDATE OR DELETE ON public.consignments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_billed_consignment_mutation();

CREATE OR REPLACE FUNCTION public.generate_ltms_source_bill(
  p_branch_id UUID,
  p_source_id UUID,
  p_bill_date DATE,
  p_due_date DATE,
  p_period_from DATE,
  p_period_to DATE,
  p_items JSONB,
  p_created_by UUID DEFAULT NULL
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
  v_freight NUMERIC(14,2) := 0;
  v_loading NUMERIC(14,2) := 0;
BEGIN
  IF p_branch_id IS NULL OR p_source_id IS NULL THEN RAISE EXCEPTION 'Branch and source are required'; END IF;
  IF p_bill_date IS NULL OR p_due_date IS NULL OR p_period_from IS NULL OR p_period_to IS NULL THEN RAISE EXCEPTION 'Bill date, due date and billing period are required'; END IF;
  IF p_period_from > p_period_to OR p_bill_date < p_period_from OR p_due_date < p_bill_date THEN RAISE EXCEPTION 'Invalid bill dates'; END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::jsonb)) < 1 THEN RAISE EXCEPTION 'Select at least one consignment'; END IF;

  INSERT INTO public.ltms_source_bills (branch_id, source_id, bill_date, due_date, period_from, period_to, total_freight, total_loading, created_by)
  VALUES (p_branch_id, p_source_id, p_bill_date, p_due_date, p_period_from, p_period_to, 0, 0, p_created_by)
  RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_consign FROM public.consignments WHERE id = NULLIF(v_item->>'consignment_id', '')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected consignment was not found'; END IF;
    IF v_consign.branch_id IS DISTINCT FROM p_branch_id OR v_consign.source_id IS DISTINCT FROM p_source_id THEN RAISE EXCEPTION 'Selected consignments must use the chosen branch and source'; END IF;
    IF v_consign.consignment_date IS NULL OR v_consign.consignment_date < p_period_from OR v_consign.consignment_date > p_period_to THEN RAISE EXCEPTION 'Selected consignment is outside the billing period'; END IF;
    IF v_consign.source_bill_id IS NOT NULL OR v_consign.billing_status <> 'to_be_billed' THEN RAISE EXCEPTION 'A selected consignment has already been billed'; END IF;

    INSERT INTO public.ltms_source_bill_items (
      bill_id, consignment_id, consignment_number, consignment_date, from_pin_code, to_pin_code,
      calculated_freight, freight_deduction, additional_freight, final_freight,
      calculated_loading, loading_deduction, additional_loading, final_loading
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
      round(greatest(0, coalesce(NULLIF(v_item->>'final_loading', '')::NUMERIC, 0)), 2)
    );
    v_freight := v_freight + greatest(0, coalesce(NULLIF(v_item->>'final_freight', '')::NUMERIC, 0));
    v_loading := v_loading + greatest(0, coalesce(NULLIF(v_item->>'final_loading', '')::NUMERIC, 0));
    UPDATE public.consignments SET source_bill_id = v_bill_id, source_billed_at = now(), billing_status = 'billed' WHERE id = v_consign.id;
  END LOOP;
  UPDATE public.ltms_source_bills SET total_freight = round(v_freight, 2), total_loading = round(v_loading, 2) WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN DELETE FROM public.ltms_source_bill_items WHERE bill_id = v_bill_id; DELETE FROM public.ltms_source_bills WHERE id = v_bill_id; END IF;
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_ltms_source_bill(UUID, UUID, DATE, DATE, DATE, DATE, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_ltms_source_bill(UUID, UUID, DATE, DATE, DATE, DATE, JSONB, UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.soft_delete_ltms_source_bill(p_bill_id UUID, p_deleted_by UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ltms_source_bills
  SET deleted_at = coalesce(deleted_at, now()), deleted_by = coalesce(p_deleted_by, deleted_by)
  WHERE id = p_bill_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source bill was not found or already deleted'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.soft_delete_ltms_source_bill(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_ltms_source_bill(UUID, UUID) TO anon, authenticated, service_role;

COMMIT;
