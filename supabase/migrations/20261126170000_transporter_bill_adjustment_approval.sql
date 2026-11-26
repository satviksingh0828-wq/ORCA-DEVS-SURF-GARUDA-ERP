BEGIN;
CREATE TABLE public.transporter_bill_approval_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
 transporter_id uuid NOT NULL REFERENCES public.ltms_transporters(id) ON DELETE RESTRICT,
 transporter_source_id uuid NOT NULL REFERENCES public.ltms_transporter_sources(id) ON DELETE RESTRICT,
 system_date date NOT NULL, transporter_bill_number text NOT NULL, transporter_bill_date date NOT NULL,
 period_from date, period_to date,
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)>0),
 grand_total numeric(14,2) NOT NULL CHECK(grand_total>0),
 requested_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT, reviewed_at timestamptz, review_note text,
 bill_id uuid UNIQUE REFERENCES public.ltms_transporter_bills(id) ON DELETE RESTRICT,
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND bill_id IS NULL) OR
 (status='approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND bill_id IS NOT NULL) OR
 (status='rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND bill_id IS NULL))
);
CREATE INDEX transporter_approval_scope_idx ON public.transporter_bill_approval_requests(branch_id,status,created_at DESC);
CREATE UNIQUE INDEX transporter_approval_pending_number_idx ON public.transporter_bill_approval_requests(branch_id,transporter_id,transporter_source_id,transporter_bill_number) WHERE status='pending';
ALTER TABLE public.transporter_bill_approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transporter_bill_approval_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.transporter_bill_approval_requests TO service_role;
CREATE TABLE public.transporter_bill_approval_sources(
 consignment_id uuid PRIMARY KEY REFERENCES public.consignments(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL REFERENCES public.transporter_bill_approval_requests(id) ON DELETE CASCADE
);
ALTER TABLE public.transporter_bill_approval_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transporter_bill_approval_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.transporter_bill_approval_sources TO service_role;
CREATE FUNCTION public.transporter_approval_slab(p_ranges jsonb,p_measure numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT CASE WHEN r->>'working'='fixed' THEN coalesce(nullif(r->>'value','')::numeric,0) ELSE coalesce(nullif(r->>'value','')::numeric,0)*p_measure END
 FROM jsonb_array_elements(coalesce(p_ranges,'[]'::jsonb)) r
 WHERE coalesce(nullif(trim(r->>'start'),'')::numeric,0)<=p_measure AND (nullif(trim(r->>'end'),'') IS NULL OR p_measure<=nullif(trim(r->>'end'),'')::numeric)
 ORDER BY coalesce(nullif(trim(r->>'start'),'')::numeric,0) DESC LIMIT 1),0)
$$;
CREATE FUNCTION public.validate_transporter_approval_items(p_branch uuid,p_transporter uuid,p_source uuid,p_from date,p_to date,p_items jsonb,p_request uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i jsonb; c public.consignments%ROWTYPE; e public.ltms_transporter_entries%ROWTYPE; result jsonb:='[]'; seen uuid[]:=ARRAY[]::uuid[]; sid uuid; fp text; tp text; qty numeric; wt numeric; f numeric; l numeric; fd numeric; fa numeric; ld numeric; la numeric; fixed numeric; v numeric; k text;
BEGIN
 IF (p_from IS NULL)<>(p_to IS NULL) OR p_from>p_to OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid period or entries'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Select 1 to 1000 consignments'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ltms_transporter_sources WHERE id=p_source AND transporter_id=p_transporter AND branch_id=p_branch AND is_active) THEN RAISE EXCEPTION 'Invalid transporter source'; END IF;
 FOR i IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  sid:=(i->>'consignment_id')::uuid;
  SELECT * INTO c FROM public.consignments WHERE id=sid FOR UPDATE;
  IF NOT FOUND OR c.branch_id IS DISTINCT FROM p_branch OR c.transporter_id IS DISTINCT FROM p_transporter OR c.transporter_source_id IS DISTINCT FROM p_source OR c.transporter_bill_id IS NOT NULL OR (p_from IS NOT NULL AND (c.consignment_date IS NULL OR c.consignment_date NOT BETWEEN p_from AND p_to)) THEN RAISE EXCEPTION 'Consignment missing, billed or outside chosen branch/transporter/source/period'; END IF;
  IF sid=ANY(seen) THEN RAISE EXCEPTION 'Duplicate consignment'; END IF;
  seen:=array_append(seen,sid);
  IF EXISTS(SELECT 1 FROM public.transporter_bill_approval_sources s WHERE s.consignment_id=sid AND s.request_id IS DISTINCT FROM p_request) THEN RAISE EXCEPTION 'Consignment already reserved for approval'; END IF;
  fp:=trim(coalesce(CASE WHEN c.movement_mode='drop' THEN c.to_pin_code ELSE c.from_pin_code END,''));
  tp:=trim(coalesce(CASE WHEN c.movement_mode='drop' THEN coalesce(c.to_details->>'pincode',c.to_pin_code) ELSE c.to_pin_code END,''));
  SELECT coalesce(sum(quantity),0),coalesce(sum(weight_kg),0) INTO qty,wt FROM public.consignment_package_information WHERE consignment_id=sid;
  SELECT * INTO e FROM public.ltms_transporter_entries WHERE transporter_id=p_transporter AND source_id=p_source AND upper(trim(coalesce(mode,'')))=upper(trim(coalesce(c.transport_mode,''))) AND trim(coalesce(from_pin_code,''))=fp AND trim(coalesce(to_pin_code,''))=tp ORDER BY id LIMIT 1;
  f:=round(public.transporter_approval_slab(e.freight_route_ranges,CASE WHEN coalesce(e.freight_route_range_type,'weight')='weight' THEN wt ELSE qty END),2);
  l:=round(public.transporter_approval_slab(e.loading_route_ranges,CASE WHEN coalesce(e.loading_route_range_type,'weight')='weight' THEN wt ELSE qty END),2);
  fixed:=round(coalesce(c.fixed_lr_charges,0),2);
  IF f IS DISTINCT FROM round((i->>'calculated_freight')::numeric,2) OR l IS DISTINCT FROM round((i->>'calculated_loading')::numeric,2) OR fixed IS DISTINCT FROM round((i->>'fixed_lr_charges')::numeric,2) THEN RAISE EXCEPTION 'Rates or fixed LR charges changed for %. Reload the consignment.',c.consignment_number; END IF;
  FOREACH k IN ARRAY ARRAY['freight_deduction','additional_freight','loading_deduction','additional_loading'] LOOP
   v:=coalesce((i->>k)::numeric,0);
   IF v<0 OR v::text IN ('NaN','Infinity','-Infinity') OR v<>round(v,2) THEN RAISE EXCEPTION 'Adjustments must be nonnegative with at most two decimal places'; END IF;
  END LOOP;
  fd:=coalesce((i->>'freight_deduction')::numeric,0);fa:=coalesce((i->>'additional_freight')::numeric,0);ld:=coalesce((i->>'loading_deduction')::numeric,0);la:=coalesce((i->>'additional_loading')::numeric,0);
  IF c.charge_adjustments_locked_at IS NOT NULL AND (fd IS DISTINCT FROM coalesce(c.freight_deduction,0) OR fa IS DISTINCT FROM coalesce(c.additional_freight,0) OR ld IS DISTINCT FROM coalesce(c.loading_deduction,0) OR la IS DISTINCT FROM coalesce(c.additional_loading,0)) THEN RAISE EXCEPTION 'Consignment adjustments are locked'; END IF;
  result:=result||jsonb_build_array(i||jsonb_build_object('consignment_number',c.consignment_number,'from_pin_code',fp,'to_pin_code',tp,'calculated_freight',f,'calculated_loading',l,'freight_deduction',fd,'additional_freight',fa,'loading_deduction',ld,'additional_loading',la,'final_freight',greatest(0,f-fd+fa),'final_loading',greatest(0,l-ld+la),'fixed_lr_charges',fixed,'saved_adjustment',coalesce(c.freight_deduction,0)>0 OR coalesce(c.additional_freight,0)>0 OR coalesce(c.loading_deduction,0)>0 OR coalesce(c.additional_loading,0)>0));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.submit_transporter_bill_approval(p_actor uuid,p_branch uuid,p_transporter uuid,p_source uuid,p_system_date date,p_number text,p_date date,p_from date,p_to date,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_role text; v_items jsonb; i jsonb; v_adjusted boolean; v_total numeric; v_id uuid; v_bill uuid;
BEGIN
 SELECT role INTO v_role FROM public.app_users WHERE id=p_actor AND is_active;
 IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') THEN RAISE EXCEPTION 'Posting access denied'; END IF;
 IF v_role='basic' AND NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=p_actor AND branch_id=p_branch) THEN RAISE EXCEPTION 'Branch access denied'; END IF;
 IF p_system_date IS NULL OR p_date IS NULL OR nullif(trim(p_number),'') IS NULL THEN RAISE EXCEPTION 'Bill dates and number required'; END IF;
 PERFORM pg_advisory_xact_lock(620261127);
 IF EXISTS(SELECT 1 FROM public.transporter_bill_approval_requests WHERE branch_id=p_branch AND transporter_id=p_transporter AND transporter_source_id=p_source AND transporter_bill_number=trim(p_number) AND status='pending') THEN RAISE EXCEPTION 'Bill number already pending approval'; END IF;
 v_items:=public.validate_transporter_approval_items(p_branch,p_transporter,p_source,p_from,p_to,p_items,NULL);
 SELECT sum((x->>'final_freight')::numeric+(x->>'final_loading')::numeric+(x->>'fixed_lr_charges')::numeric),bool_or((x->>'freight_deduction')::numeric>0 OR (x->>'additional_freight')::numeric>0 OR (x->>'loading_deduction')::numeric>0 OR (x->>'additional_loading')::numeric>0 OR (x->>'saved_adjustment')::boolean) INTO v_total,v_adjusted FROM jsonb_array_elements(v_items)x;
 IF v_total<=0 THEN RAISE EXCEPTION 'Bill total must be positive'; END IF;
 IF NOT v_adjusted THEN
  v_bill:=public.generate_ltms_transporter_bill(p_branch,p_transporter,p_source,p_system_date,trim(p_number),p_date,p_from,p_to,p_actor,v_items);
  RETURN jsonb_build_object('id',v_bill,'pending',false);
 END IF;
 INSERT INTO public.transporter_bill_approval_requests(branch_id,transporter_id,transporter_source_id,system_date,transporter_bill_number,transporter_bill_date,period_from,period_to,items,grand_total,requested_by)
 VALUES(p_branch,p_transporter,p_source,p_system_date,trim(p_number),p_date,p_from,p_to,v_items,v_total,p_actor) RETURNING id INTO v_id;
 FOR i IN SELECT value FROM jsonb_array_elements(v_items) LOOP
  INSERT INTO public.transporter_bill_approval_sources(consignment_id,request_id) VALUES((i->>'consignment_id')::uuid,v_id);
 END LOOP;
 RETURN jsonb_build_object('id',v_id,'pending',true);
END $$;
CREATE FUNCTION public.review_transporter_bill_approval(p_actor uuid,p_request uuid,p_approve boolean,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.transporter_bill_approval_requests%ROWTYPE; v_items jsonb; v_bill uuid; v_role text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_actor AND is_active AND role='admin') THEN RAISE EXCEPTION 'Administrator approval required'; END IF;
 PERFORM pg_advisory_xact_lock(620261127);
 SELECT * INTO r FROM public.transporter_bill_approval_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Request already reviewed or missing'; END IF;
 IF p_approve THEN
  SELECT role INTO v_role FROM public.app_users WHERE id=r.requested_by AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') OR (v_role='basic' AND NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=r.requested_by AND branch_id=r.branch_id)) THEN RAISE EXCEPTION 'Requester no longer has branch access'; END IF;
  v_items:=public.validate_transporter_approval_items(r.branch_id,r.transporter_id,r.transporter_source_id,r.period_from,r.period_to,r.items,r.id);
  v_bill:=public.generate_ltms_transporter_bill(r.branch_id,r.transporter_id,r.transporter_source_id,r.system_date,r.transporter_bill_number,r.transporter_bill_date,r.period_from,r.period_to,r.requested_by,v_items);
  UPDATE public.journal_entries SET created_by=r.requested_by,approved_by=p_actor,approved_at=now(),verified_by=p_actor,verified_at=now() WHERE id=(SELECT journal_entry_id FROM public.ltms_transporter_bills WHERE id=v_bill);
 ELSE
  IF nullif(trim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
 END IF;
 UPDATE public.transporter_bill_approval_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,reviewed_by=p_actor,reviewed_at=now(),review_note=nullif(trim(p_note),''),bill_id=v_bill WHERE id=r.id;
 DELETE FROM public.transporter_bill_approval_sources WHERE request_id=r.id;
 RETURN v_bill;
END $$;
REVOKE EXECUTE ON FUNCTION public.generate_ltms_transporter_bill(uuid,uuid,uuid,date,text,date,date,date,uuid,jsonb),public.transporter_approval_slab(jsonb,numeric),public.validate_transporter_approval_items(uuid,uuid,uuid,date,date,jsonb,uuid),public.submit_transporter_bill_approval(uuid,uuid,uuid,uuid,date,text,date,date,date,jsonb),public.review_transporter_bill_approval(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.generate_ltms_transporter_bill(uuid,uuid,uuid,date,text,date,date,date,uuid,jsonb),public.transporter_approval_slab(jsonb,numeric),public.validate_transporter_approval_items(uuid,uuid,uuid,date,date,jsonb,uuid),public.submit_transporter_bill_approval(uuid,uuid,uuid,uuid,date,text,date,date,date,jsonb),public.review_transporter_bill_approval(uuid,uuid,boolean,text) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.ltms_transporter_bills,public.ltms_transporter_bill_items FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;