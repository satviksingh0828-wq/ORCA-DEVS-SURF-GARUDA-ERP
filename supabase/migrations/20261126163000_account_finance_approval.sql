BEGIN;
CREATE TABLE public.account_finance_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('receipt','payment','withdrawal','deposit')),
 branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
 entry_date date NOT NULL,
 name text NOT NULL CHECK (length(trim(name))>0),
 description text,
 amount numeric(14,2) NOT NULL CHECK (amount>0),
 supporting_document text,
 first_lines jsonb NOT NULL,
 second_lines jsonb NOT NULL,
 requested_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES public.app_users(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,
 review_note text,
 voucher_id uuid REFERENCES public.account_cash_vouchers(id) ON DELETE RESTRICT,
 journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND journal_entry_id IS NULL)
 OR (status='rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND journal_entry_id IS NULL)
 OR (status='approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND journal_entry_id IS NOT NULL))
);
CREATE INDEX account_finance_requests_scope_idx ON public.account_finance_requests(kind,branch_id,status,entry_date DESC);
ALTER TABLE public.account_finance_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_finance_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.account_finance_requests TO service_role;

-- Only authenticated server handlers call these service-only functions.
CREATE FUNCTION public.validate_account_finance_request(p_kind text,p_branch uuid,p_first jsonb,p_second jsonb)
RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_line jsonb; v_side integer; v_type text; v_id uuid; v_amount numeric; v_totals numeric[] := ARRAY[0::numeric,0::numeric];
BEGIN
 IF p_kind NOT IN ('receipt','payment','withdrawal','deposit') OR p_branch IS NULL THEN RAISE EXCEPTION 'Invalid request type or branch'; END IF;
 IF jsonb_typeof(p_first) IS DISTINCT FROM 'array' OR jsonb_typeof(p_second) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid account lines'; END IF;
 IF jsonb_array_length(p_first) NOT BETWEEN 1 AND 100 OR jsonb_array_length(p_second) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Account lines required'; END IF;
 IF p_kind IN ('withdrawal','deposit') AND (jsonb_array_length(p_first)<>1 OR jsonb_array_length(p_second)<>1) THEN RAISE EXCEPTION 'Select one source and destination account'; END IF;
 FOR v_side IN 1..2 LOOP
  FOR v_line IN SELECT value FROM jsonb_array_elements(CASE WHEN v_side=1 THEN p_first ELSE p_second END) LOOP
   v_id := (v_line->>'account_id')::uuid;
   v_amount := (v_line->>'amount')::numeric;
   IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<=0 OR v_amount<>round(v_amount,2) OR v_amount>=1000000000000 THEN RAISE EXCEPTION 'Enter a positive amount with at most two decimal places'; END IF;
   SELECT ledger_type INTO v_type FROM public.ledger_accounts WHERE id=v_id AND branch_id=p_branch AND is_active;
   IF v_type IS NULL OR NOT (
     (p_kind='receipt' AND ((v_side=1 AND v_type='income') OR (v_side=2 AND v_type IN ('bank','cash'))))
     OR (p_kind='payment' AND ((v_side=1 AND v_type='expenditure') OR (v_side=2 AND v_type IN ('bank','cash'))))
     OR (p_kind='withdrawal' AND ((v_side=1 AND v_type='bank') OR (v_side=2 AND v_type='cash')))
     OR (p_kind='deposit' AND ((v_side=1 AND v_type='cash') OR (v_side=2 AND v_type='bank')))
   ) THEN RAISE EXCEPTION 'Account must be active, of the required type, and in the selected branch'; END IF;
   v_totals[v_side] := v_totals[v_side]+v_amount;
  END LOOP;
 END LOOP;
 IF v_totals[1]<>v_totals[2] OR v_totals[1]<=0 OR v_totals[1]>=1000000000000 THEN RAISE EXCEPTION 'Entry must balance'; END IF;
 RETURN v_totals[1];
END $$;
CREATE FUNCTION public.submit_account_finance_request(p_actor uuid,p_kind text,p_branch uuid,p_date date,p_name text,p_description text,p_document text,p_first jsonb,p_second jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_role text; v_id uuid; v_amount numeric;
BEGIN
 SELECT role INTO v_role FROM public.app_users WHERE id=p_actor AND is_active;
 IF v_role IS DISTINCT FROM 'basic' THEN RAISE EXCEPTION 'Only basic users submit approval requests'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=p_actor AND branch_id=p_branch) THEN RAISE EXCEPTION 'Branch access denied'; END IF;
 IF p_date IS NULL OR nullif(trim(p_name),'') IS NULL THEN RAISE EXCEPTION 'Date and name are required'; END IF;
 IF p_document IS NOT NULL AND (split_part(p_document,'/',1)<>p_branch::text OR p_document LIKE '%..%') THEN RAISE EXCEPTION 'Invalid document path'; END IF;
 v_amount:=public.validate_account_finance_request(p_kind,p_branch,p_first,p_second);
 INSERT INTO public.account_finance_requests(kind,branch_id,entry_date,name,description,amount,supporting_document,first_lines,second_lines,requested_by)
 VALUES(p_kind,p_branch,p_date,trim(p_name),nullif(trim(p_description),''),v_amount,p_document,p_first,p_second,p_actor) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION public.review_account_finance_request(p_actor uuid,p_request uuid,p_approve boolean,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.account_finance_requests%ROWTYPE; v_voucher uuid; v_journal uuid; v_transfer jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_actor AND is_active AND role='admin') THEN RAISE EXCEPTION 'Only administrators can review requests'; END IF;
 SELECT * INTO r FROM public.account_finance_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Request not found or already reviewed'; END IF;
 IF NOT p_approve THEN
  IF nullif(trim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
  UPDATE public.account_finance_requests SET status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_note=trim(p_note) WHERE id=r.id;
  RETURN NULL;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=r.requested_by AND is_active AND role='basic') OR NOT EXISTS(SELECT 1 FROM public.user_branch_access WHERE user_id=r.requested_by AND branch_id=r.branch_id) THEN RAISE EXCEPTION 'Requester no longer has branch access'; END IF;
 IF public.validate_account_finance_request(r.kind,r.branch_id,r.first_lines,r.second_lines)<>r.amount THEN RAISE EXCEPTION 'Request amount mismatch'; END IF;
 IF r.kind IN ('receipt','payment') THEN
  v_voucher:=public.post_account_cash_voucher(r.kind,r.branch_id,r.entry_date,r.name,r.description,r.supporting_document,r.requested_by,r.first_lines,r.second_lines);
  SELECT journal_entry_id INTO STRICT v_journal FROM public.account_cash_vouchers WHERE id=v_voucher;
 ELSE
  v_transfer:=public.post_bank_cash_transfer(jsonb_build_object('entry_date',r.entry_date,'source_branch_id',r.branch_id,'destination_branch_id',r.branch_id,'source_account_id',r.first_lines->0->>'account_id','destination_account_id',r.second_lines->0->>'account_id','amount',r.amount,'description',r.name||coalesce(' — '||r.description,''),'reference','finance-request:'||r.id));
  v_journal:=(v_transfer->>'sender_entry_id')::uuid;
 END IF;
 IF v_journal IS NULL THEN RAISE EXCEPTION 'Journal was not posted'; END IF;
 UPDATE public.journal_entries SET created_by=r.requested_by,approved_by=p_actor,approved_at=now(),verified_by=p_actor,verified_at=now() WHERE id=v_journal;
 UPDATE public.account_finance_requests SET status='approved',reviewed_by=p_actor,reviewed_at=now(),review_note=nullif(trim(p_note),''),voucher_id=v_voucher,journal_entry_id=v_journal WHERE id=r.id;
 RETURN v_journal;
END $$;
REVOKE EXECUTE ON FUNCTION public.validate_account_finance_request(text,uuid,jsonb,jsonb),public.submit_account_finance_request(uuid,text,uuid,date,text,text,text,jsonb,jsonb),public.review_account_finance_request(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_account_finance_request(text,uuid,jsonb,jsonb),public.submit_account_finance_request(uuid,text,uuid,date,text,text,text,jsonb,jsonb),public.review_account_finance_request(uuid,uuid,boolean,text) TO service_role;
-- Prevent bypass via the old browser posting RPCs; existing admin screens now use verified server handlers.
REVOKE EXECUTE ON FUNCTION public.post_account_cash_voucher(text,uuid,date,text,text,text,uuid,jsonb,jsonb),public.post_bank_cash_transfer(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_account_cash_voucher(text,uuid,date,text,text,text,uuid,jsonb,jsonb),public.post_bank_cash_transfer(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;