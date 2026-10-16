BEGIN;
CREATE TABLE IF NOT EXISTS public.account_gst_slabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  slab_name TEXT NOT NULL,
  igst_rate NUMERIC(5,2) NOT NULL CHECK (igst_rate BETWEEN 0 AND 100),
  cgst_rate NUMERIC(5,2) NOT NULL CHECK (cgst_rate BETWEEN 0 AND 100),
  sgst_rate NUMERIC(5,2) NOT NULL CHECK (sgst_rate BETWEEN 0 AND 100),
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, slab_name)
);
CREATE INDEX IF NOT EXISTS account_gst_slabs_branch_idx ON public.account_gst_slabs(branch_id, slab_name);
ALTER TABLE public.account_gst_slabs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_gst_slabs_read ON public.account_gst_slabs;
CREATE POLICY account_gst_slabs_read ON public.account_gst_slabs FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.account_gst_slabs TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_account_gst_slab_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'GST slabs are view-only after creation; create another slab instead';
END; $$;
DROP TRIGGER IF EXISTS account_gst_slabs_immutable ON public.account_gst_slabs;
CREATE TRIGGER account_gst_slabs_immutable BEFORE UPDATE OR DELETE ON public.account_gst_slabs
FOR EACH ROW EXECUTE FUNCTION public.prevent_account_gst_slab_mutation();

CREATE OR REPLACE FUNCTION public.create_account_gst_slab(
  p_branch_id UUID,
  p_igst_rate NUMERIC,
  p_cgst_rate NUMERIC,
  p_sgst_rate NUMERIC,
  p_created_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_name TEXT;
  v_id UUID;
  v_igst NUMERIC(5,2) := round(coalesce(p_igst_rate,0),2);
  v_cgst NUMERIC(5,2) := round(coalesce(p_cgst_rate,0),2);
  v_sgst NUMERIC(5,2) := round(coalesce(p_sgst_rate,0),2);
BEGIN
  IF p_branch_id IS NULL OR p_created_by IS NULL THEN RAISE EXCEPTION 'Branch and user are required'; END IF;
  IF v_igst NOT BETWEEN 0 AND 100 OR v_cgst NOT BETWEEN 0 AND 100 OR v_sgst NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'GST rates must be between 0 and 100'; END IF;
  SELECT role INTO v_role FROM public.app_users WHERE id=p_created_by AND is_active=true;
  IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') THEN RAISE EXCEPTION 'This user cannot create GST slabs'; END IF;
  IF v_role='basic' AND NOT EXISTS (SELECT 1 FROM public.user_branch_access WHERE user_id=p_created_by AND branch_id=p_branch_id) THEN RAISE EXCEPTION 'Basic users can create GST slabs only for an assigned branch'; END IF;
  v_name := 'IGST '||trim(trailing '.' from trim(trailing '0' from to_char(v_igst,'FM990.99')))||'% + CGST '||trim(trailing '.' from trim(trailing '0' from to_char(v_cgst,'FM990.99')))||'% + SGST '||trim(trailing '.' from trim(trailing '0' from to_char(v_sgst,'FM990.99')))||'%';
  INSERT INTO public.account_gst_slabs(branch_id,slab_name,igst_rate,cgst_rate,sgst_rate,created_by)
  VALUES(p_branch_id,v_name,v_igst,v_cgst,v_sgst,p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This GST slab already exists for the selected branch';
END; $$;
GRANT EXECUTE ON FUNCTION public.create_account_gst_slab(UUID,NUMERIC,NUMERIC,NUMERIC,UUID) TO anon, authenticated;
COMMIT;
