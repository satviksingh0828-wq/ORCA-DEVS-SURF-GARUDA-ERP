BEGIN;
-- Loading Received is actual package loading income, independent of optional
-- Common Loading Slab / Additional Source Income snapshots.
CREATE FUNCTION public.stock_outward_loading_allocation(p_receipt_id uuid)
RETURNS TABLE(source_id uuid,source_name text,ledger_id uuid,account_kind text,allocation_weight numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.stock_outward_receipts%ROWTYPE; v_count integer; v_total numeric;
BEGIN
 SELECT * INTO r FROM public.stock_outward_receipts WHERE id=p_receipt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock Outward receipt not found'; END IF;
 SELECT count(*) INTO v_count FROM public.stock_outward_sources s WHERE s.receipt_id=r.id;
 IF v_count=0 THEN RAISE EXCEPTION 'No source is linked to this Stock Outward receipt'; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_outward_packages p WHERE p.receipt_id=r.id AND NOT EXISTS(SELECT 1 FROM public.stock_outward_sources s WHERE s.receipt_id=r.id AND s.source_id=p.source_id)) OR EXISTS(SELECT 1 FROM public.stock_outward_sources s WHERE s.receipt_id=r.id AND NOT EXISTS(SELECT 1 FROM public.stock_outward_packages p WHERE p.receipt_id=r.id AND p.source_id=s.source_id)) THEN
  RAISE EXCEPTION 'Each selected source must have linked package lines; check this Stock Outward receipt';
 END IF;
 IF EXISTS(SELECT 1 FROM public.stock_outward_sources s LEFT JOIN public.contracts c ON c.id=s.source_id LEFT JOIN public.ledger_accounts l ON l.id=c.loading_income_ledger_id AND l.branch_id=r.branch_id AND l.is_active AND l.ledger_type='income' WHERE s.receipt_id=r.id AND (c.id IS NULL OR c.branch_id IS DISTINCT FROM r.branch_id OR l.id IS NULL)) THEN
  RAISE EXCEPTION 'Map an active Loading Income ledger in the receipt branch for each selected source before posting';
 END IF;
 -- A sole source receives the full captured amount, without any split or
 -- dependence on current rates. Multiple sources use package loading rates,
 -- matching Stock Outward's Loading Amount calculation and Unloading Received.
 IF v_count=1 THEN
  RETURN QUERY SELECT c.id,c.contract_name,l.id,l.account_kind,1::numeric FROM public.stock_outward_sources s JOIN public.contracts c ON c.id=s.source_id JOIN public.ledger_accounts l ON l.id=c.loading_income_ledger_id WHERE s.receipt_id=r.id;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.stock_outward_packages p LEFT JOIN public.package_rate_types t ON t.id=p.package_rate_type_id AND t.branch_id=r.branch_id LEFT JOIN LATERAL(SELECT e.amount FROM public.package_rate_entries e WHERE e.package_rate_type_id=t.id AND e.branch_id=r.branch_id AND e.rate_kind='loading' AND e.from_value<=CASE WHEN t.basis='weight' THEN p.weight_kg ELSE p.quantity END AND (e.to_value IS NULL OR e.to_value>=CASE WHEN t.basis='weight' THEN p.weight_kg ELSE p.quantity END) ORDER BY e.from_value DESC LIMIT 1) slab ON true WHERE p.receipt_id=r.id AND (t.id IS NULL OR slab.amount IS NULL)) THEN
  RAISE EXCEPTION 'Cannot split Loading Received: a package has no matching branch Loading rate slab. Check Masters package rates.';
 END IF;
 RETURN QUERY
 SELECT c.id,c.contract_name,l.id,l.account_kind,round(sum(CASE WHEN t.charge_mode='rate' THEN slab.amount*CASE WHEN t.basis='weight' THEN p.weight_kg ELSE p.quantity END ELSE slab.amount END),2)
 FROM public.stock_outward_packages p JOIN public.package_rate_types t ON t.id=p.package_rate_type_id AND t.branch_id=r.branch_id
 JOIN public.contracts c ON c.id=p.source_id JOIN public.ledger_accounts l ON l.id=c.loading_income_ledger_id
 JOIN LATERAL(SELECT e.amount FROM public.package_rate_entries e WHERE e.package_rate_type_id=t.id AND e.branch_id=r.branch_id AND e.rate_kind='loading' AND e.from_value<=CASE WHEN t.basis='weight' THEN p.weight_kg ELSE p.quantity END AND (e.to_value IS NULL OR e.to_value>=CASE WHEN t.basis='weight' THEN p.weight_kg ELSE p.quantity END) ORDER BY e.from_value DESC LIMIT 1) slab ON true
 WHERE p.receipt_id=r.id GROUP BY c.id,c.contract_name,l.id,l.account_kind ORDER BY c.id;
END $$;
CREATE OR REPLACE FUNCTION public.post_stock_outward_loading_received(p_receipt_id uuid,p_payment_ledger_id uuid,p_created_by uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.stock_outward_receipts%ROWTYPE; cash public.ledger_accounts%ROWTYPE; j uuid; n integer; total numeric; rem numeric(14,2); alloc numeric(14,2); i integer:=0; line_no integer:=1; q record; weights jsonb;
BEGIN
 SELECT * INTO r FROM public.stock_outward_receipts WHERE id=p_receipt_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock Outward receipt not found'; END IF;
 IF r.loading_amount_received<=0 THEN RAISE EXCEPTION 'Loading Amount Received must be positive'; END IF;
 IF r.loading_received_journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Loading receipt already posted'; END IF;
 SELECT * INTO cash FROM public.ledger_accounts WHERE id=p_payment_ledger_id AND branch_id=r.branch_id AND is_active AND ledger_type IN('cash','bank');
 IF NOT FOUND THEN RAISE EXCEPTION 'Select an active cash/bank account from this branch'; END IF;
 -- Materialize the exact allocation once, then reuse it for posting.
 SELECT count(*),coalesce(sum(a.allocation_weight),0),jsonb_agg(to_jsonb(a) ORDER BY a.source_id)
 INTO n,total,weights FROM public.stock_outward_loading_allocation(r.id) a WHERE a.allocation_weight>0;
 IF n=0 OR total<=0 THEN RAISE EXCEPTION 'Cannot split Loading Received: calculated package loading charges are zero. Check package loading rates.'; END IF;
 INSERT INTO public.journal_entries(entry_date,branch_id,description,reference,source_module,status,approved_at,created_by)
 VALUES(r.loading_date,r.branch_id,'Stock Outward Loading Received - '||r.outward_number,'stock_outward_loading_received:'||r.id,'ltms','approved',now(),p_created_by) RETURNING id INTO j;
 INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit)
 VALUES(j,1,r.branch_id,cash.id,cash.account_kind,'Cash/bank received - '||r.outward_number,r.loading_amount_received,0);
 rem:=round(r.loading_amount_received,2);
 FOR q IN SELECT * FROM jsonb_to_recordset(weights) AS x(source_id uuid,source_name text,ledger_id uuid,account_kind text,allocation_weight numeric) ORDER BY source_id LOOP
  i:=i+1;
  IF i=n THEN alloc:=rem; ELSE alloc:=least(rem,round(r.loading_amount_received*q.allocation_weight/total,2)); END IF;
  IF alloc>0 THEN
   line_no:=line_no+1;
   INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit)
   VALUES(j,line_no,r.branch_id,q.ledger_id,q.account_kind,'Loading income received - '||coalesce(q.source_name,'Source')||' / '||r.outward_number,0,alloc);
   rem:=round(rem-alloc,2);
  END IF;
 END LOOP;
 IF rem<>0 THEN RAISE EXCEPTION 'Could not allocate full received amount'; END IF;
 PERFORM public.validate_journal_entry(j);
 PERFORM set_config('app.allow_stock_outward_posting','on',true);
 UPDATE public.stock_outward_receipts SET loading_received_payment_ledger_id=cash.id,loading_received_journal_entry_id=j,loading_received_by=p_created_by,loading_received_at=now() WHERE id=r.id;
 PERFORM set_config('app.allow_stock_outward_posting','off',true);
 RETURN j;
END $$;
REVOKE EXECUTE ON FUNCTION public.stock_outward_loading_allocation(uuid),public.post_stock_outward_loading_received(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stock_outward_loading_allocation(uuid),public.post_stock_outward_loading_received(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;