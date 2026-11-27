BEGIN;
CREATE TABLE public.ltms_note_approval_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 note_type text NOT NULL CHECK(note_type IN ('debit','credit')),
 branch_id uuid NOT NULL REFERENCES public.branches(id),
 party_id uuid NOT NULL REFERENCES public.ltms_billing_parties(id),
 note_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>0),
 description text, offset_party_id uuid REFERENCES public.ltms_billing_parties(id),
 offset_ledger_id uuid REFERENCES public.ledger_accounts(id),
 requested_by uuid NOT NULL REFERENCES public.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(offset_party_id,offset_ledger_id)=1)
);
ALTER TABLE public.ltms_note_approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ltms_note_approval_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ltms_note_approval_requests TO service_role;
CREATE INDEX ltms_note_approval_scope ON public.ltms_note_approval_requests(note_type,branch_id,note_date);
CREATE FUNCTION public.validate_note_approval(p_branch uuid,p_party uuid,p_offset_party uuid,p_offset_ledger uuid,p_amount numeric,p_date date)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a uuid; b uuid;
BEGIN
 IF p_date IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 OR round(p_amount,2)<>p_amount OR p_amount>=1000000000000 THEN RAISE EXCEPTION 'Valid date and positive amount required'; END IF;
 SELECT ledger_account_id INTO a FROM public.ltms_billing_parties WHERE id=p_party AND branch_id=p_branch AND is_active;
 IF a IS NULL OR num_nonnulls(p_offset_party,p_offset_ledger)<>1 THEN RAISE EXCEPTION 'Select main party and one offset account'; END IF;
 IF p_offset_party IS NOT NULL THEN
 SELECT ledger_account_id INTO b FROM public.ltms_billing_parties WHERE id=p_offset_party AND branch_id=p_branch AND is_active;
 ELSE b:=p_offset_ledger; END IF;
 IF b IS NULL OR a=b OR NOT EXISTS(SELECT 1 FROM public.ledger_accounts WHERE id=b AND branch_id=p_branch AND is_active AND ledger_type IN ('asset','liability','income','expenditure')) OR NOT EXISTS(SELECT 1 FROM public.ledger_accounts WHERE id=a AND branch_id=p_branch AND is_active) THEN RAISE EXCEPTION 'Select two different active accounts in this branch'; END IF;
END $$;
CREATE FUNCTION public.submit_note_approval(p_actor uuid,p_type text,p_branch uuid,p_party uuid,p_date date,p_amount numeric,p_description text,p_offset_party uuid,p_offset_ledger uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_role text; v_id uuid;
BEGIN
 SELECT role INTO v_role FROM public.app_users WHERE id=p_actor AND is_active AND NOT is_paused;
 IF v_role IS NULL OR v_role NOT IN ('basic','admin','semi_admin') OR p_type NOT IN ('debit','credit') THEN RAISE EXCEPTION 'Posting access denied'; END IF;
 PERFORM public.validate_note_approval(p_branch,p_party,p_offset_party,p_offset_ledger,p_amount,p_date);
 IF v_role='basic' THEN
 IF NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=p_actor AND branch_id=p_branch) THEN RAISE EXCEPTION 'Branch access denied'; END IF;
 INSERT INTO public.ltms_note_approval_requests(note_type,branch_id,party_id,note_date,amount,description,offset_party_id,offset_ledger_id,requested_by) VALUES(p_type,p_branch,p_party,p_date,p_amount,p_description,p_offset_party,p_offset_ledger,p_actor) RETURNING id INTO v_id;
 RETURN jsonb_build_object('id',v_id,'pending',true);
 END IF;
 v_id:=public.create_ltms_accounting_note(p_type,p_branch,p_party,p_date,p_amount,p_description,p_offset_party,p_offset_ledger,p_actor);
 RETURN jsonb_build_object('id',v_id,'pending',false);
END $$;
CREATE FUNCTION public.manage_pending_approval(p_actor uuid,p_category text,p_id uuid,p_action text,p_patch jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE a public.account_finance_requests%ROWTYPE; w public.workmen_bill_approval_requests%ROWTYPE; t public.transporter_bill_approval_requests%ROWTYPE; n public.ltms_note_approval_requests%ROWTYPE; j uuid; v_items jsonb; v_total numeric; v_add numeric; v_deduct numeric; v_payload jsonb; v_branch uuid; v_table text; v_status text; v_party uuid; v_offset_party uuid; v_offset_ledger uuid; v_date date; v_amount numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_actor AND role='admin' AND is_active AND NOT is_paused) THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF p_action NOT IN ('edit','reject','approve') THEN RAISE EXCEPTION 'Invalid action'; END IF;
 IF p_category='account' THEN
  SELECT * INTO a FROM public.account_finance_requests WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR a.status<>'pending' THEN RAISE EXCEPTION 'Request no longer pending'; END IF;
  IF p_action='reject' THEN DELETE FROM public.account_finance_requests WHERE id=p_id;
  ELSIF p_action='approve' THEN PERFORM public.review_account_finance_request(p_actor,p_id,true,NULL);
  ELSE
   v_amount:=public.validate_account_finance_request(a.kind,a.branch_id,p_patch->'first_lines',p_patch->'second_lines');
   v_date:=(p_patch->>'entry_date')::date;
   IF v_date IS NULL OR nullif(trim(p_patch->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Name and date required'; END IF;
   UPDATE public.account_finance_requests SET entry_date=v_date,name=trim(p_patch->>'name'),description=nullif(trim(p_patch->>'description'),''),first_lines=p_patch->'first_lines',second_lines=p_patch->'second_lines',amount=v_amount WHERE id=p_id;
  END IF;
 ELSIF p_category='workmen' THEN
  PERFORM pg_advisory_xact_lock(620261126);
  SELECT * INTO w FROM public.workmen_bill_approval_requests WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR w.status<>'pending' THEN RAISE EXCEPTION 'Request no longer pending'; END IF;
  IF p_action='reject' THEN DELETE FROM public.workmen_bill_approval_requests WHERE id=p_id;
  ELSIF p_action='approve' THEN PERFORM public.review_workmen_bill_approval(p_actor,p_id,true,NULL);
  ELSE
   IF jsonb_typeof(p_patch->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_patch->'items')<>jsonb_array_length(w.items) THEN RAISE EXCEPTION 'Source entries cannot be changed'; END IF;
   SELECT jsonb_agg(x.value||jsonb_build_object('addition',y.value->'addition','deduction',y.value->'deduction') ORDER BY x.ordinality) INTO v_items FROM jsonb_array_elements(w.items) WITH ORDINALITY x JOIN jsonb_array_elements(p_patch->'items') WITH ORDINALITY y USING(ordinality);
   v_items:=public.validate_workmen_approval_items(w.branch_id,w.period_from,w.period_to,v_items,w.id);
   v_add:=(p_patch->>'additional_pay_amount')::numeric; v_deduct:=(p_patch->>'deduction_amount')::numeric;
   v_date:=(p_patch->>'bill_date')::date;
   IF v_date IS NULL OR v_add IS NULL OR v_deduct IS NULL OR v_add::text IN ('NaN','Infinity','-Infinity') OR v_deduct::text IN ('NaN','Infinity','-Infinity') OR v_add<0 OR v_deduct<0 OR round(v_add,2)<>v_add OR round(v_deduct,2)<>v_deduct THEN RAISE EXCEPTION 'Invalid adjustments'; END IF;
   SELECT coalesce(sum((x->>'final_amount')::numeric),0)+v_add-v_deduct INTO v_total FROM jsonb_array_elements(v_items)x;
   IF v_total<0 THEN RAISE EXCEPTION 'Deduction exceeds bill amount'; END IF;
   UPDATE public.workmen_bill_approval_requests SET bill_date=v_date,items=v_items,additional_pay_amount=v_add,deduction_amount=v_deduct,additional_pay_note=p_patch->>'additional_pay_note',deduction_note=p_patch->>'deduction_note',grand_total=v_total WHERE id=p_id;
  END IF;
 ELSIF p_category='transporter' THEN
  PERFORM pg_advisory_xact_lock(620261127);
  SELECT * INTO t FROM public.transporter_bill_approval_requests WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR t.status<>'pending' THEN RAISE EXCEPTION 'Request no longer pending'; END IF;
  IF p_action='reject' THEN DELETE FROM public.transporter_bill_approval_requests WHERE id=p_id;
  ELSIF p_action='approve' THEN PERFORM public.review_transporter_bill_approval(p_actor,p_id,true,NULL);
  ELSE
   IF jsonb_typeof(p_patch->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_patch->'items')<>jsonb_array_length(t.items) THEN RAISE EXCEPTION 'Consignments cannot be changed'; END IF;
   SELECT jsonb_agg(x.value||jsonb_build_object('freight_deduction',y.value->'freight_deduction','additional_freight',y.value->'additional_freight','loading_deduction',y.value->'loading_deduction','additional_loading',y.value->'additional_loading') ORDER BY x.ordinality) INTO v_items FROM jsonb_array_elements(t.items) WITH ORDINALITY x JOIN jsonb_array_elements(p_patch->'items') WITH ORDINALITY y USING(ordinality);
   v_items:=public.validate_transporter_approval_items(t.branch_id,t.transporter_id,t.transporter_source_id,t.period_from,t.period_to,v_items,t.id);
   SELECT sum((x->>'final_freight')::numeric+(x->>'final_loading')::numeric+(x->>'fixed_lr_charges')::numeric) INTO v_total FROM jsonb_array_elements(v_items)x;
   v_date:=(p_patch->>'transporter_bill_date')::date;
   IF v_total<=0 OR v_date IS NULL OR nullif(trim(p_patch->>'transporter_bill_number'),'') IS NULL THEN RAISE EXCEPTION 'Valid bill number, date and positive total required'; END IF;
   UPDATE public.transporter_bill_approval_requests SET items=v_items,grand_total=v_total,transporter_bill_date=v_date,transporter_bill_number=trim(p_patch->>'transporter_bill_number') WHERE id=p_id;
  END IF;
 ELSIF p_category='note' THEN
  SELECT * INTO n FROM public.ltms_note_approval_requests WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request no longer pending'; END IF;
  IF p_action='reject' THEN DELETE FROM public.ltms_note_approval_requests WHERE id=p_id;
  ELSIF p_action='approve' THEN
   IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=n.requested_by AND is_active AND NOT is_paused AND role='basic') OR NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=n.requested_by AND branch_id=n.branch_id) THEN RAISE EXCEPTION 'Requester no longer has branch access'; END IF;
   PERFORM public.validate_note_approval(n.branch_id,n.party_id,n.offset_party_id,n.offset_ledger_id,n.amount,n.note_date);
   j:=public.create_ltms_accounting_note(n.note_type,n.branch_id,n.party_id,n.note_date,n.amount,n.description,n.offset_party_id,n.offset_ledger_id,n.requested_by);
   UPDATE public.journal_entries SET created_by=n.requested_by,approved_by=p_actor,approved_at=now(),verified_by=p_actor,verified_at=now() WHERE id=(SELECT journal_entry_id FROM public.ltms_accounting_notes WHERE id=j);
   DELETE FROM public.ltms_note_approval_requests WHERE id=p_id;
  ELSE
   v_party:=(p_patch->>'party_id')::uuid; v_offset_party:=nullif(p_patch->>'offset_party_id','')::uuid; v_offset_ledger:=nullif(p_patch->>'offset_ledger_id','')::uuid; v_date:=(p_patch->>'note_date')::date; v_amount:=(p_patch->>'amount')::numeric;
   PERFORM public.validate_note_approval(n.branch_id,v_party,v_offset_party,v_offset_ledger,v_amount,v_date);
   UPDATE public.ltms_note_approval_requests SET party_id=v_party,offset_party_id=v_offset_party,offset_ledger_id=v_offset_ledger,note_date=v_date,amount=v_amount,description=p_patch->>'description' WHERE id=p_id;
  END IF;
 ELSIF p_category IN ('income','expenditure') THEN
  v_table:=CASE WHEN p_category='income' THEN 'income_verification_pending' ELSE 'expenditure_verification_pending' END;
  EXECUTE format('SELECT status FROM public.%I WHERE id=$1 FOR UPDATE',v_table) INTO v_status USING p_id;
  IF v_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Request no longer pending'; END IF;
  IF p_action='reject' THEN EXECUTE format('DELETE FROM public.%I WHERE id=$1',v_table) USING p_id;
  ELSIF p_action='approve' THEN PERFORM public.tms_approve_pending_finance(p_category,p_id,p_actor);
  ELSE
   v_branch:=nullif(p_patch->>'branch_id','')::uuid;
   IF v_branch IS NULL OR nullif(trim(p_patch->>(p_category||'_name')),'') IS NULL THEN RAISE EXCEPTION 'Name and branch required'; END IF;
   v_amount:=(p_patch->>'amount')::numeric;
   IF v_amount IS NULL OR v_amount<=0 OR v_amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Positive amount required'; END IF;
   EXECUTE format('UPDATE public.%I SET payload=$2,branch_id=$3 WHERE id=$1',v_table) USING p_id,p_patch,v_branch;
  END IF;
 ELSE RAISE EXCEPTION 'Unsupported request category';
 END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.validate_note_approval(uuid,uuid,uuid,uuid,numeric,date),public.submit_note_approval(uuid,text,uuid,uuid,date,numeric,text,uuid,uuid),public.manage_pending_approval(uuid,text,uuid,text,jsonb),public.create_ltms_accounting_note(text,uuid,uuid,date,numeric,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_note_approval(uuid,uuid,uuid,uuid,numeric,date),public.submit_note_approval(uuid,text,uuid,uuid,date,numeric,text,uuid,uuid),public.manage_pending_approval(uuid,text,uuid,text,jsonb),public.create_ltms_accounting_note(text,uuid,uuid,date,numeric,text,uuid,uuid,uuid) TO service_role;
GRANT DELETE ON public.account_finance_requests,public.workmen_bill_approval_requests,public.transporter_bill_approval_requests,public.income_verification_pending,public.expenditure_verification_pending TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;