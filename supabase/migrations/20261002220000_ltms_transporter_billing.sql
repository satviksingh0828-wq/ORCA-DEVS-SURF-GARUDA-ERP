BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.ltms_transporter_bill_system_number_seq;

CREATE TABLE IF NOT EXISTS public.ltms_transporter_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_number TEXT NOT NULL UNIQUE DEFAULT ('TB-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || lpad(nextval('public.ltms_transporter_bill_system_number_seq')::TEXT, 5, '0')),
  system_date DATE NOT NULL DEFAULT CURRENT_DATE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  transporter_id UUID NOT NULL REFERENCES public.ltms_transporters(id) ON DELETE RESTRICT,
  transporter_source_id UUID NOT NULL REFERENCES public.ltms_transporter_sources(id) ON DELETE RESTRICT,
  transporter_bill_number TEXT NOT NULL UNIQUE,
  transporter_bill_date DATE NOT NULL,
  period_from DATE,
  period_to DATE,
  total_freight NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_loading NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT ltms_transporter_bills_period_check CHECK (
    (period_from IS NULL AND period_to IS NULL) OR
    (period_from IS NOT NULL AND period_to IS NOT NULL AND period_from <= period_to)
  )
);

CREATE TABLE IF NOT EXISTS public.ltms_transporter_bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.ltms_transporter_bills(id) ON DELETE RESTRICT,
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
  ADD COLUMN IF NOT EXISTS transporter_bill_id UUID REFERENCES public.ltms_transporter_bills(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ltms_transporter_bills_filter_idx
  ON public.ltms_transporter_bills (system_date DESC, branch_id, transporter_id, transporter_source_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ltms_transporter_bill_items_bill_idx
  ON public.ltms_transporter_bill_items (bill_id);
CREATE INDEX IF NOT EXISTS consignments_transporter_billing_idx
  ON public.consignments (branch_id, transporter_id, transporter_source_id, consignment_date DESC)
  WHERE transporter_bill_id IS NULL;

ALTER TABLE public.ltms_transporter_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltms_transporter_bill_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.ltms_transporter_bills TO anon, authenticated;
GRANT SELECT, INSERT ON public.ltms_transporter_bill_items TO anon, authenticated;
GRANT ALL ON public.ltms_transporter_bills, public.ltms_transporter_bill_items TO service_role;
DROP POLICY IF EXISTS ltms_transporter_bills_app ON public.ltms_transporter_bills;
CREATE POLICY ltms_transporter_bills_app ON public.ltms_transporter_bills
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ltms_transporter_bill_items_app ON public.ltms_transporter_bill_items;
CREATE POLICY ltms_transporter_bill_items_app ON public.ltms_transporter_bill_items
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.prevent_ltms_billed_consignment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_bill_id IS NOT NULL
       OR OLD.transporter_bill_id IS NOT NULL
       OR OLD.billing_status IN ('billed', 'billed_and_paid') THEN
      RAISE EXCEPTION 'A billed consignment cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.source_bill_id IS NOT NULL THEN
    IF NEW.source_bill_id IS DISTINCT FROM OLD.source_bill_id
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.consignment_date IS DISTINCT FROM OLD.consignment_date
       OR NEW.billing_status IS DISTINCT FROM OLD.billing_status THEN
      RAISE EXCEPTION 'A source-billed consignment source assignment is immutable';
    END IF;
  END IF;

  IF OLD.transporter_bill_id IS NOT NULL THEN
    IF NEW.transporter_bill_id IS DISTINCT FROM OLD.transporter_bill_id
       OR NEW.transporter_id IS DISTINCT FROM OLD.transporter_id
       OR NEW.transporter_source_id IS DISTINCT FROM OLD.transporter_source_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.consignment_date IS DISTINCT FROM OLD.consignment_date THEN
      RAISE EXCEPTION 'A transporter-billed consignment transporter assignment is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_billed_consignment_mutation ON public.consignments;
CREATE TRIGGER prevent_billed_consignment_mutation
  BEFORE UPDATE OR DELETE ON public.consignments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ltms_billed_consignment_mutation();

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
  v_freight NUMERIC(14, 2) := 0;
  v_loading NUMERIC(14, 2) := 0;
BEGIN
  IF p_branch_id IS NULL OR p_transporter_id IS NULL OR p_transporter_source_id IS NULL THEN
    RAISE EXCEPTION 'Branch, transporter and transporter source are required';
  END IF;
  IF nullif(trim(p_transporter_bill_number), '') IS NULL OR p_transporter_bill_date IS NULL THEN
    RAISE EXCEPTION 'Transporter bill number and bill date are required';
  END IF;
  IF (p_period_from IS NULL) <> (p_period_to IS NULL) OR p_period_from > p_period_to THEN
    RAISE EXCEPTION 'Both duration dates are required and From Date cannot be after To Date';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ltms_transporter_sources
    WHERE id = p_transporter_source_id
      AND transporter_id = p_transporter_id
      AND (branch_id IS NULL OR branch_id = p_branch_id)
      AND is_active
  ) THEN
    RAISE EXCEPTION 'The selected transporter source does not belong to the selected transporter and branch';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN
    RAISE EXCEPTION 'Select at least one consignment';
  END IF;

  INSERT INTO public.ltms_transporter_bills (
    branch_id, transporter_id, transporter_source_id, system_date,
    transporter_bill_number, transporter_bill_date, period_from, period_to,
    total_freight, total_loading, created_by
  ) VALUES (
    p_branch_id, p_transporter_id, p_transporter_source_id, coalesce(p_system_date, current_date),
    trim(p_transporter_bill_number), p_transporter_bill_date, p_period_from, p_period_to,
    0, 0, p_created_by
  ) RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_consign
    FROM public.consignments
    WHERE id = NULLIF(v_item->>'consignment_id', '')::UUID
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected consignment was not found'; END IF;
    IF v_consign.branch_id IS DISTINCT FROM p_branch_id
       OR v_consign.transporter_id IS DISTINCT FROM p_transporter_id
       OR v_consign.transporter_source_id IS DISTINCT FROM p_transporter_source_id THEN
      RAISE EXCEPTION 'Selected consignments must use the chosen branch, transporter and transporter source';
    END IF;
    IF v_consign.transporter_bill_id IS NOT NULL THEN
      RAISE EXCEPTION 'A selected consignment has already been transporter billed';
    END IF;
    IF p_period_from IS NOT NULL AND (v_consign.consignment_date < p_period_from OR v_consign.consignment_date > p_period_to) THEN
      RAISE EXCEPTION 'Selected consignment is outside the transporter billing duration';
    END IF;

    INSERT INTO public.ltms_transporter_bill_items (
      bill_id, consignment_id, consignment_number, consignment_date, from_pin_code, to_pin_code,
      calculated_freight, freight_deduction, additional_freight, final_freight,
      calculated_loading, loading_deduction, additional_loading, final_loading
    ) VALUES (
      v_bill_id, v_consign.id, v_consign.consignment_number, v_consign.consignment_date,
      coalesce(v_item->>'from_pin_code', v_consign.from_pin_code, ''),
      coalesce(v_item->>'to_pin_code', v_consign.to_pin_code, ''),
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
    UPDATE public.consignments
    SET transporter_bill_id = v_bill_id
    WHERE id = v_consign.id;
  END LOOP;

  UPDATE public.ltms_transporter_bills
  SET total_freight = round(v_freight, 2), total_loading = round(v_loading, 2)
  WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.ltms_transporter_bill_items WHERE bill_id = v_bill_id;
    DELETE FROM public.ltms_transporter_bills WHERE id = v_bill_id;
  END IF;
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_ltms_transporter_bill(UUID, UUID, UUID, DATE, TEXT, DATE, DATE, DATE, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_ltms_transporter_bill(UUID, UUID, UUID, DATE, TEXT, DATE, DATE, UUID, JSONB) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.soft_delete_ltms_transporter_bill(p_bill_id UUID, p_deleted_by UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ltms_transporter_bills
  SET deleted_at = coalesce(deleted_at, now()), deleted_by = coalesce(p_deleted_by, deleted_by)
  WHERE id = p_bill_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transporter bill was not found or already deleted'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.soft_delete_ltms_transporter_bill(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_ltms_transporter_bill(UUID, UUID) TO anon, authenticated, service_role;

COMMIT;
