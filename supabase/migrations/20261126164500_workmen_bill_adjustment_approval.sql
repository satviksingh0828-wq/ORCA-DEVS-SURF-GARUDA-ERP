BEGIN;
CREATE TABLE public.workmen_bill_approval_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
 bill_date date NOT NULL, period_from date NOT NULL, period_to date NOT NULL CHECK(period_to>=period_from),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)>0),
 additional_pay_amount numeric(14,2) NOT NULL CHECK(additional_pay_amount>=0),
 additional_pay_note text, deduction_amount numeric(14,2) NOT NULL CHECK(deduction_amount>=0), deduction_note text,
 grand_total numeric(14,2) NOT NULL CHECK(grand_total>=0),
 requested_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
 reviewed_at timestamptz, review_note text,
 bill_id uuid REFERENCES public.workmen_bills(id) ON DELETE RESTRICT UNIQUE,
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND bill_id IS NULL) OR
 (status='approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND bill_id IS NOT NULL) OR
 (status='rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND bill_id IS NULL))
);
CREATE INDEX workmen_approval_branch_status_idx ON public.workmen_bill_approval_requests(branch_id,status,created_at DESC);
ALTER TABLE public.workmen_bill_approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workmen_bill_approval_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.workmen_bill_approval_requests TO service_role;
CREATE TABLE public.workmen_bill_approval_sources(
 source_kind text NOT NULL CHECK(source_kind IN ('consignment','inward','outward')),
 source_id uuid NOT NULL,
 request_id uuid NOT NULL REFERENCES public.workmen_bill_approval_requests(id) ON DELETE CASCADE,
 PRIMARY KEY(source_kind,source_id)
);
ALTER TABLE public.workmen_bill_approval_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workmen_bill_approval_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.workmen_bill_approval_sources TO service_role;

-- Independently calculate the charges from current source packages and branch rate slabs.
CREATE FUNCTION public.validate_workmen_approval_items(p_branch uuid,p_from date,p_to date,p_items jsonb,p_request uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; result jsonb:='[]'; k text; sid uuid; charge text; src_branch uuid; src_date date; src_bill uuid; ref text; calculated numeric; d numeric; a numeric; seen text[]:=ARRAY[]::text[];
BEGIN
 IF p_branch IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>p_to OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid branch, period or bill entries'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Add between 1 and 1000 entries'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF num_nonnulls(nullif(item->>'consignment_id',''),nullif(item->>'stock_inward_receipt_id',''),nullif(item->>'stock_outward_receipt_id',''))<>1 THEN RAISE EXCEPTION 'Exactly one source required'; END IF;
  IF nullif(item->>'consignment_id','') IS NOT NULL THEN
   k:='consignment';sid:=(item->>'consignment_id')::uuid;charge:='loading';
   SELECT branch_id,consignment_date,workmen_loading_bill_id,consignment_number INTO src_branch,src_date,src_bill,ref FROM public.consignments WHERE id=sid FOR UPDATE;
  ELSIF nullif(item->>'stock_inward_receipt_id','') IS NOT NULL THEN
   k:='inward';sid:=(item->>'stock_inward_receipt_id')::uuid;charge:='unloading';
   SELECT branch_id,receipt_date,workmen_unloading_bill_id,coalesce(receipt_number,id::text) INTO src_branch,src_date,src_bill,ref FROM public.stock_inward_receipts WHERE id=sid FOR UPDATE;
  ELSE
   k:='outward';sid:=(item->>'stock_outward_receipt_id')::uuid;charge:='loading';
   SELECT branch_id,outward_date,workmen_loading_bill_id,coalesce(outward_number,id::text) INTO src_branch,src_date,src_bill,ref FROM public.stock_outward_receipts WHERE id=sid FOR UPDATE;
  END IF;
  IF src_branch IS DISTINCT FROM p_branch OR src_date IS NULL OR src_date NOT BETWEEN p_from AND p_to OR src_bill IS NOT NULL OR item->>'charge_type' IS DISTINCT FROM charge THEN RAISE EXCEPTION 'Source missing, already billed, in another branch or outside billing period'; END IF;
  IF (k||':'||sid)=ANY(seen) THEN RAISE EXCEPTION 'Duplicate source entry'; END IF;
  seen:=array_append(seen,k||':'||sid);
  IF EXISTS(SELECT 1 FROM public.workmen_bill_approval_sources s WHERE s.source_kind=k AND s.source_id=sid AND s.request_id IS DISTINCT FROM p_request) THEN RAISE EXCEPTION 'Source already reserved by a pending Workmen Bill approval'; END IF;
  SELECT round(coalesce(sum(CASE WHEN m.measure<=0 THEN 0 WHEN t.charge_mode='rate' THEN coalesce(e.amount,0)*m.measure ELSE coalesce(e.amount,0) END),0),2) INTO calculated
  FROM (
    SELECT package_rate_type_id,quantity,weight_kg FROM public.consignment_package_information WHERE k='consignment' AND consignment_id=sid
    UNION ALL SELECT package_rate_type_id,quantity,weight_kg FROM public.stock_inward_packages WHERE k='inward' AND receipt_id=sid
    UNION ALL SELECT package_rate_type_id,quantity,weight_kg FROM public.stock_outward_packages WHERE k='outward' AND receipt_id=sid
  ) p JOIN public.package_rate_types t ON t.id=p.package_rate_type_id AND t.branch_id=p_branch
  CROSS JOIN LATERAL(SELECT CASE WHEN t.basis='weight' THEN coalesce(p.weight_kg,0) ELSE coalesce(p.quantity,0) END AS measure)m
  LEFT JOIN LATERAL(SELECT x.amount FROM public.package_rate_entries x WHERE x.branch_id=p_branch AND x.package_rate_type_id=t.id AND x.rate_kind=charge AND x.from_value<=m.measure AND (x.to_value IS NULL OR m.measure<=x.to_value) ORDER BY x.from_value DESC LIMIT 1)e ON true;
  IF calculated IS DISTINCT FROM round((item->>'calculated_amount')::numeric,2) THEN RAISE EXCEPTION 'Calculated charge changed for %. Reload the entries and submit again.',ref; END IF;
  d:=coalesce((item->>'deduction')::numeric,0);a:=coalesce((item->>'addition')::numeric,0);
  IF d<0 OR a<0 OR d::text IN ('NaN','Infinity','-Infinity') OR a::text IN ('NaN','Infinity','-Infinity') OR d<>round(d,2) OR a<>round(a,2) THEN RAISE EXCEPTION 'Adjustments must be nonnegative with at most two decimals'; END IF;
  result:=result||jsonb_build_array(item||jsonb_build_object('calculated_amount',calculated,'deduction',d,'addition',a,'final_amount',greatest(0,calculated-d+a),'source_kind',k,'source_id',sid,'reference_number',ref));
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION public.submit_workmen_bill_approval(p_actor uuid,p_branch uuid,p_date date,p_from date,p_to date,p_items jsonb,p_add numeric,p_add_note text,p_deduct numeric,p_deduct_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_role text; v_items jsonb; v_item jsonb; v_adjusted boolean; v_total numeric; v_id uuid; v_bill uuid;
BEGIN
 SELECT role INTO v_role FROM public.app_users WHERE id=p_actor AND is_active;
 IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') THEN RAISE EXCEPTION 'Posting access denied'; END IF;
 IF v_role='basic' AND NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=p_actor AND branch_id=p_branch) THEN RAISE EXCEPTION 'Branch access denied'; END IF;
 IF p_date IS NULL OR p_add IS NULL OR p_deduct IS NULL OR p_add<0 OR p_deduct<0 OR p_add<>round(p_add,2) OR p_deduct<>round(p_deduct,2) OR p_add::text IN ('NaN','Infinity','-Infinity') OR p_deduct::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Invalid bill date or adjustment'; END IF;
 PERFORM pg_advisory_xact_lock(620261126);
 v_items:=public.validate_workmen_approval_items(p_branch,p_from,p_to,p_items,NULL);
 SELECT coalesce(sum((x->>'final_amount')::numeric),0)+p_add, coalesce(bool_or((x->>'addition')::numeric>0 OR (x->>'deduction')::numeric>0),false) INTO v_total,v_adjusted FROM jsonb_array_elements(v_items)x;
 IF v_total<=0 OR p_deduct>v_total THEN RAISE EXCEPTION 'Invalid bill total or deduction'; END IF;
 v_adjusted:=v_adjusted OR p_add>0 OR p_deduct>0;
 IF NOT v_adjusted THEN
  v_bill:=public.create_workmen_bill(p_branch,p_date,p_from,p_to,p_actor,v_items,0,NULL,0,NULL);
  RETURN jsonb_build_object('id',v_bill,'pending',false);
 END IF;
 INSERT INTO public.workmen_bill_approval_requests(branch_id,bill_date,period_from,period_to,items,additional_pay_amount,additional_pay_note,deduction_amount,deduction_note,grand_total,requested_by)
 VALUES(p_branch,p_date,p_from,p_to,v_items,p_add,nullif(trim(p_add_note),''),p_deduct,nullif(trim(p_deduct_note),''),v_total-p_deduct,p_actor) RETURNING id INTO v_id;
 FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
  INSERT INTO public.workmen_bill_approval_sources(source_kind,source_id,request_id) VALUES(v_item->>'source_kind',(v_item->>'source_id')::uuid,v_id);
 END LOOP;
 RETURN jsonb_build_object('id',v_id,'pending',true);
END $$;
CREATE FUNCTION public.review_workmen_bill_approval(p_actor uuid,p_request uuid,p_approve boolean,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.workmen_bill_approval_requests%ROWTYPE; v_items jsonb; v_bill uuid; v_role text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_actor AND is_active AND role='admin') THEN RAISE EXCEPTION 'Administrator approval required'; END IF;
 PERFORM pg_advisory_xact_lock(620261126);
 SELECT * INTO r FROM public.workmen_bill_approval_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Request already reviewed or missing'; END IF;
 IF p_approve THEN
  SELECT role INTO v_role FROM public.app_users WHERE id=r.requested_by AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') OR (v_role='basic' AND NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=r.requested_by AND branch_id=r.branch_id)) THEN RAISE EXCEPTION 'Requester no longer has branch access'; END IF;
  v_items:=public.validate_workmen_approval_items(r.branch_id,r.period_from,r.period_to,r.items,r.id);
  v_bill:=public.create_workmen_bill(r.branch_id,r.bill_date,r.period_from,r.period_to,r.requested_by,v_items,r.additional_pay_amount,r.additional_pay_note,r.deduction_amount,r.deduction_note);
  UPDATE public.journal_entries SET created_by=r.requested_by,approved_by=p_actor,approved_at=now(),verified_by=p_actor,verified_at=now() WHERE id=(SELECT journal_entry_id FROM public.workmen_bills WHERE id=v_bill);
 ELSE
  IF nullif(trim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
 END IF;
 UPDATE public.workmen_bill_approval_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,reviewed_by=p_actor,reviewed_at=now(),review_note=nullif(trim(p_note),''),bill_id=v_bill WHERE id=r.id;
 DELETE FROM public.workmen_bill_approval_sources WHERE request_id=r.id;
 RETURN v_bill;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_workmen_bill(uuid,date,date,date,uuid,jsonb,numeric,text,numeric,text),public.validate_workmen_approval_items(uuid,date,date,jsonb,uuid),public.submit_workmen_bill_approval(uuid,uuid,date,date,date,jsonb,numeric,text,numeric,text),public.review_workmen_bill_approval(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_workmen_bill(uuid,date,date,date,uuid,jsonb,numeric,text,numeric,text),public.validate_workmen_approval_items(uuid,date,date,jsonb,uuid),public.submit_workmen_bill_approval(uuid,uuid,date,date,date,jsonb,numeric,text,numeric,text),public.review_workmen_bill_approval(uuid,uuid,boolean,text) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.workmen_bills,public.workmen_bill_items FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;