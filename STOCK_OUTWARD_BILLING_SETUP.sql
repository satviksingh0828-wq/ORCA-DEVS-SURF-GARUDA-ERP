-- Forward SQL for Stock Outward billing, Loading Received, Approval Income, and Workmen Loading.
-- Apply after STOCK_OUTWARD_SETUP.sql or the 20261027170000 base migration.

BEGIN;

ALTER TABLE public.stock_outward_receipts
  ADD COLUMN IF NOT EXISTS approval_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (approval_amount >= 0),
  ADD COLUMN IF NOT EXISTS additional_income_mode TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS approval_income_payment_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_income_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approval_income_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_income_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS loading_received_payment_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loading_received_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS loading_received_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loading_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workmen_loading_bill_id UUID REFERENCES public.workmen_bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workmen_loading_billed_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_outward_receipts_additional_income_mode_check' AND conrelid = 'public.stock_outward_receipts'::regclass) THEN
    ALTER TABLE public.stock_outward_receipts ADD CONSTRAINT stock_outward_receipts_additional_income_mode_check CHECK (additional_income_mode IN ('approval', 'source', 'both', 'none'));
  END IF;
END $$;
UPDATE public.stock_outward_receipts
SET additional_income_mode = CASE
  WHEN coalesce(source_income_amount, 0) > 0 AND coalesce(approval_amount, 0) > 0 THEN 'both'
  WHEN coalesce(source_income_amount, 0) > 0 THEN 'source'
  WHEN coalesce(approval_amount, 0) > 0 THEN 'approval'
  ELSE 'none'
END
WHERE additional_income_mode = 'none';
CREATE UNIQUE INDEX IF NOT EXISTS stock_outward_loading_received_journal_uidx ON public.stock_outward_receipts(loading_received_journal_entry_id) WHERE loading_received_journal_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_outward_approval_income_journal_uidx ON public.stock_outward_receipts(approval_income_journal_entry_id) WHERE approval_income_journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_outward_workmen_loading_idx ON public.stock_outward_receipts(workmen_loading_bill_id) WHERE workmen_loading_bill_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stock_outward_source_income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id UUID NOT NULL REFERENCES public.stock_outward_receipts(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  basis TEXT NOT NULL CHECK (basis IN ('quantity','weight')), measure NUMERIC(14,3) NOT NULL CHECK (measure >= 0),
  from_value NUMERIC(14,3) NOT NULL, to_value NUMERIC(14,3), charge_mode TEXT NOT NULL CHECK (charge_mode IN ('fixed','rate')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0), source_income_amount NUMERIC(14,2) NOT NULL CHECK (source_income_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(receipt_id,source_id)
);
ALTER TABLE public.stock_outward_source_income ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_outward_source_income_select ON public.stock_outward_source_income;
CREATE POLICY stock_outward_source_income_select ON public.stock_outward_source_income FOR SELECT TO anon,authenticated USING(true);
GRANT SELECT ON public.stock_outward_source_income TO anon,authenticated;
GRANT ALL ON public.stock_outward_source_income TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_stock_outward_source_income(p_receipt_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.stock_outward_receipts%ROWTYPE; x RECORD; s RECORD; v_basis TEXT; total NUMERIC(14,3);
BEGIN
 SELECT * INTO r FROM public.stock_outward_receipts WHERE id=p_receipt_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock Outward receipt not found'; END IF;
 IF r.loading_received_journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Source-income snapshots cannot be refreshed after Loading Received is posted'; END IF;
 IF EXISTS(SELECT 1 FROM public.ltms_source_bill_stock_outward_items WHERE stock_outward_receipt_id=r.id) THEN RAISE EXCEPTION 'Source-income snapshots cannot be refreshed after source billing'; END IF;
 IF EXISTS (SELECT 1 FROM public.stock_outward_packages p WHERE p.receipt_id=r.id AND NOT EXISTS(SELECT 1 FROM public.stock_outward_sources z WHERE z.receipt_id=r.id AND z.source_id=p.source_id)) THEN RAISE EXCEPTION 'Every package source must be selected on receipt'; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_outward_sources z WHERE z.receipt_id=r.id AND NOT EXISTS(SELECT 1 FROM public.stock_outward_packages p WHERE p.receipt_id=r.id AND p.source_id=z.source_id)) THEN RAISE EXCEPTION 'Each selected source must have package lines'; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_outward_sources z JOIN public.contracts c ON c.id=z.source_id WHERE z.receipt_id=r.id AND c.branch_id IS DISTINCT FROM r.branch_id) THEN RAISE EXCEPTION 'Every selected source must belong to the Stock Outward branch'; END IF;
 DELETE FROM public.stock_outward_source_income WHERE receipt_id=r.id;
 FOR x IN SELECT source_id FROM public.stock_outward_sources WHERE receipt_id=r.id LOOP
   IF (SELECT count(DISTINCT basis) FROM public.source_common_loading_slabs WHERE contract_id=x.source_id)<>1 THEN RAISE EXCEPTION 'Each source must have slabs with one consistent basis'; END IF;
   SELECT basis INTO v_basis FROM public.source_common_loading_slabs WHERE contract_id=x.source_id LIMIT 1;
   SELECT coalesce(sum(CASE WHEN v_basis='weight' THEN p.weight_kg ELSE p.quantity END),0) INTO total FROM public.stock_outward_packages p WHERE p.receipt_id=r.id AND p.source_id=x.source_id;
   SELECT * INTO s FROM public.source_common_loading_slabs WHERE contract_id=x.source_id AND basis=v_basis AND from_value<=total AND (to_value IS NULL OR total<=to_value) ORDER BY from_value DESC LIMIT 1;
   IF NOT FOUND THEN RAISE EXCEPTION 'No matching source common-loading slab for source %',x.source_id; END IF;
   INSERT INTO public.stock_outward_source_income(receipt_id,source_id,basis,measure,from_value,to_value,charge_mode,amount,source_income_amount)
   VALUES(r.id,x.source_id,s.basis,total,s.from_value,s.to_value,s.charge_mode,s.amount,round(CASE WHEN s.charge_mode='rate' THEN s.amount*total ELSE s.amount END,2));
 END LOOP;
 PERFORM set_config('app.allow_stock_outward_income_refresh','on',true);
 UPDATE public.stock_outward_receipts SET source_income_amount=(SELECT round(coalesce(sum(source_income_amount),0),2) FROM public.stock_outward_source_income WHERE receipt_id=r.id),updated_at=now() WHERE id=r.id;
 PERFORM set_config('app.allow_stock_outward_income_refresh','off',true);
END; $$;
REVOKE ALL ON FUNCTION public.refresh_stock_outward_source_income(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_stock_outward_source_income(UUID) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.ltms_source_bill_stock_outward_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bill_id UUID NOT NULL REFERENCES public.ltms_source_bills(id) ON DELETE CASCADE,
 stock_outward_receipt_id UUID NOT NULL REFERENCES public.stock_outward_receipts(id) ON DELETE RESTRICT,
 source_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT, outward_number TEXT NOT NULL, outward_date DATE NOT NULL,
 calculated_source_income NUMERIC(14,2) NOT NULL CHECK(calculated_source_income>=0), source_income_deduction NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(source_income_deduction>=0),
 additional_source_income NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(additional_source_income>=0), source_income_amount NUMERIC(14,2) NOT NULL CHECK(source_income_amount>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(stock_outward_receipt_id,source_id));
CREATE INDEX IF NOT EXISTS ltms_source_bill_outward_bill_idx ON public.ltms_source_bill_stock_outward_items(bill_id);
CREATE INDEX IF NOT EXISTS ltms_source_bill_outward_source_idx ON public.ltms_source_bill_stock_outward_items(source_id,outward_date);
ALTER TABLE public.ltms_source_bill_stock_outward_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ltms_source_bill_stock_outward_items_select ON public.ltms_source_bill_stock_outward_items;
CREATE POLICY ltms_source_bill_stock_outward_items_select ON public.ltms_source_bill_stock_outward_items FOR SELECT TO anon,authenticated USING(true);
GRANT SELECT ON public.ltms_source_bill_stock_outward_items TO anon,authenticated;
GRANT ALL ON public.ltms_source_bill_stock_outward_items TO service_role;

ALTER TABLE public.workmen_bill_items ADD COLUMN IF NOT EXISTS stock_outward_receipt_id UUID REFERENCES public.stock_outward_receipts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS workmen_bill_items_outward_idx ON public.workmen_bill_items(stock_outward_receipt_id) WHERE stock_outward_receipt_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.post_stock_outward_approval_income(p_receipt_id UUID,p_payment_ledger_id UUID,p_created_by UUID DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.stock_outward_receipts%ROWTYPE; cash public.ledger_accounts%ROWTYPE; inc public.ledger_accounts%ROWTYPE; lid UUID; jid UUID; amt NUMERIC(14,2);
BEGIN
 SELECT * INTO r FROM public.stock_outward_receipts WHERE id=p_receipt_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Stock Outward receipt not found'; END IF;
 IF r.approval_amount<=0 THEN RAISE EXCEPTION 'Approval Amount must be positive'; END IF; IF r.approval_income_journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Approval income already posted'; END IF;
 SELECT * INTO cash FROM public.ledger_accounts WHERE id=p_payment_ledger_id AND branch_id=r.branch_id AND is_active AND ledger_type IN('cash','bank'); IF NOT FOUND THEN RAISE EXCEPTION 'Select an active cash/bank account from this branch'; END IF;
 SELECT approval_charge_income_ledger_id INTO lid FROM public.tms_account_ledger_mappings WHERE branch_id=r.branch_id;
 SELECT * INTO inc FROM public.ledger_accounts WHERE id=lid AND branch_id=r.branch_id AND is_active AND ledger_type='income'; IF NOT FOUND THEN RAISE EXCEPTION 'Mapped Approval Charge Income account is not active for this branch'; END IF;
 amt:=round(r.approval_amount,2);
 INSERT INTO public.journal_entries(entry_date,branch_id,description,reference,source_module,status,approved_at,created_by) VALUES(r.outward_date,r.branch_id,'Stock Outward Approval Income - '||r.outward_number,'stock_outward_approval_income:'||r.id,'ltms','approved',now(),p_created_by) RETURNING id INTO jid;
 INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit) VALUES(jid,1,r.branch_id,cash.id,cash.account_kind,'Cash/bank received - '||r.outward_number,amt,0),(jid,2,r.branch_id,inc.id,inc.account_kind,'Approval Charge income - '||r.outward_number,0,amt);
 PERFORM public.validate_journal_entry(jid);
  PERFORM set_config('app.allow_stock_outward_posting','on',true);
  UPDATE public.stock_outward_receipts SET approval_income_payment_ledger_id=cash.id,approval_income_journal_entry_id=jid,approval_income_by=p_created_by,approval_income_at=now() WHERE id=r.id;
  PERFORM set_config('app.allow_stock_outward_posting','off',true);
  RETURN jid;
END; $$;

CREATE OR REPLACE FUNCTION public.post_stock_outward_loading_received(p_receipt_id UUID,p_payment_ledger_id UUID,p_created_by UUID DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.stock_outward_receipts%ROWTYPE; cash public.ledger_accounts%ROWTYPE; j UUID; n INT; total NUMERIC(14,2); rem NUMERIC(14,2); alloc NUMERIC(14,2); i INT:=0; q RECORD;
BEGIN
 SELECT * INTO r FROM public.stock_outward_receipts WHERE id=p_receipt_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Stock Outward receipt not found'; END IF;
 IF r.loading_amount_received<=0 THEN RAISE EXCEPTION 'Loading Amount Received must be positive'; END IF; IF r.loading_received_journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Loading receipt already posted'; END IF;
 SELECT * INTO cash FROM public.ledger_accounts WHERE id=p_payment_ledger_id AND branch_id=r.branch_id AND is_active AND ledger_type IN('cash','bank'); IF NOT FOUND THEN RAISE EXCEPTION 'Select an active cash/bank account from this branch'; END IF;
 SELECT count(*),round(sum(source_income_amount),2) INTO n,total FROM public.stock_outward_source_income WHERE receipt_id=r.id AND source_income_amount>0;
 IF n=0 OR coalesce(total,0)<=0 THEN RAISE EXCEPTION 'Refresh source-income snapshots before posting'; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_outward_source_income x JOIN public.contracts c ON c.id=x.source_id LEFT JOIN public.ledger_accounts l ON l.id=c.loading_income_ledger_id AND l.branch_id=r.branch_id AND l.is_active AND l.ledger_type='income' WHERE x.receipt_id=r.id AND x.source_income_amount>0 AND l.id IS NULL) THEN RAISE EXCEPTION 'Every income-bearing source requires an active Loading Income ledger'; END IF;
 INSERT INTO public.journal_entries(entry_date,branch_id,description,reference,source_module,status,approved_at,created_by) VALUES(r.loading_date,r.branch_id,'Stock Outward Loading Received - '||r.outward_number,'stock_outward_loading_received:'||r.id,'ltms','approved',now(),p_created_by) RETURNING id INTO j;
 INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit) VALUES(j,1,r.branch_id,cash.id,cash.account_kind,'Cash/bank received - '||r.outward_number,r.loading_amount_received,0);
 rem:=round(r.loading_amount_received,2);
 FOR q IN SELECT x.source_id,x.source_income_amount,c.contract_name,c.loading_income_ledger_id,l.account_kind FROM public.stock_outward_source_income x JOIN public.contracts c ON c.id=x.source_id JOIN public.ledger_accounts l ON l.id=c.loading_income_ledger_id WHERE x.receipt_id=r.id AND x.source_income_amount>0 ORDER BY x.source_id LOOP
  i:=i+1; IF i=n THEN alloc:=rem; ELSE alloc:=least(rem,round(r.loading_amount_received*q.source_income_amount/total,2)); END IF;
  INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit) VALUES(j,i+1,r.branch_id,q.loading_income_ledger_id,q.account_kind,'Loading income received - '||coalesce(q.contract_name,'Source')||' / '||r.outward_number,0,alloc); rem:=round(rem-alloc,2);
 END LOOP;
 IF rem<>0 THEN RAISE EXCEPTION 'Could not allocate full received amount'; END IF;
 PERFORM public.validate_journal_entry(j);
 PERFORM set_config('app.allow_stock_outward_posting','on',true);
 UPDATE public.stock_outward_receipts SET loading_received_payment_ledger_id=cash.id,loading_received_journal_entry_id=j,loading_received_by=p_created_by,loading_received_at=now() WHERE id=r.id;
 PERFORM set_config('app.allow_stock_outward_posting','off',true);
 RETURN j;
END; $$;
REVOKE ALL ON FUNCTION public.post_stock_outward_approval_income(UUID,UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_stock_outward_loading_received(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_stock_outward_approval_income(UUID,UUID,UUID) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.post_stock_outward_loading_received(UUID,UUID,UUID) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.prevent_billed_stock_outward_mutation() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid UUID;
BEGIN
 IF TG_TABLE_NAME='stock_outward_receipts' THEN rid:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE rid:=CASE WHEN TG_OP='DELETE' THEN OLD.receipt_id ELSE NEW.receipt_id END; END IF;
 IF TG_TABLE_NAME='stock_outward_receipts' THEN
   IF TG_OP='INSERT' AND (coalesce(NEW.source_income_amount,0)<>0 OR NEW.loading_received_payment_ledger_id IS NOT NULL OR NEW.loading_received_journal_entry_id IS NOT NULL OR NEW.loading_received_by IS NOT NULL OR NEW.loading_received_at IS NOT NULL OR NEW.approval_income_payment_ledger_id IS NOT NULL OR NEW.approval_income_journal_entry_id IS NOT NULL OR NEW.approval_income_by IS NOT NULL OR NEW.approval_income_at IS NOT NULL OR NEW.workmen_loading_bill_id IS NOT NULL OR NEW.workmen_loading_billed_at IS NOT NULL) THEN RAISE EXCEPTION 'Calculated income and posting fields are managed by Stock Outward RPCs'; END IF;
   IF TG_OP='DELETE' AND (EXISTS(SELECT 1 FROM public.ltms_source_bill_stock_outward_items i WHERE i.stock_outward_receipt_id=OLD.id) OR EXISTS(SELECT 1 FROM public.workmen_bill_items i WHERE i.stock_outward_receipt_id=OLD.id) OR OLD.workmen_loading_bill_id IS NOT NULL OR OLD.loading_received_journal_entry_id IS NOT NULL OR OLD.approval_income_journal_entry_id IS NOT NULL) THEN RAISE EXCEPTION 'Billed or posted Stock Outward receipt cannot be deleted'; END IF;
   IF TG_OP='UPDATE' THEN
     IF NEW.workmen_loading_bill_id IS DISTINCT FROM OLD.workmen_loading_bill_id AND current_setting('app.allow_stock_outward_workmen_link', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Stock Outward Workmen Loading links can only be changed through Workmen Billing'; END IF;
     IF (NEW.source_income_amount IS DISTINCT FROM OLD.source_income_amount OR NEW.workmen_loading_billed_at IS DISTINCT FROM OLD.workmen_loading_billed_at) AND current_setting('app.allow_stock_outward_income_refresh', true) IS DISTINCT FROM 'on' AND current_setting('app.allow_stock_outward_workmen_link', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Stock Outward calculated income and Workmen lock fields can only be changed through their RPCs'; END IF;
     IF (NEW.loading_received_payment_ledger_id IS DISTINCT FROM OLD.loading_received_payment_ledger_id OR NEW.loading_received_journal_entry_id IS DISTINCT FROM OLD.loading_received_journal_entry_id OR NEW.loading_received_by IS DISTINCT FROM OLD.loading_received_by OR NEW.loading_received_at IS DISTINCT FROM OLD.loading_received_at OR NEW.approval_income_payment_ledger_id IS DISTINCT FROM OLD.approval_income_payment_ledger_id OR NEW.approval_income_journal_entry_id IS DISTINCT FROM OLD.approval_income_journal_entry_id OR NEW.approval_income_by IS DISTINCT FROM OLD.approval_income_by OR NEW.approval_income_at IS DISTINCT FROM OLD.approval_income_at) AND current_setting('app.allow_stock_outward_posting', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Stock Outward income posting metadata can only be changed through posting RPCs'; END IF;
     IF EXISTS(SELECT 1 FROM public.ltms_source_bill_stock_outward_items i WHERE i.stock_outward_receipt_id=OLD.id) AND (NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.outward_date IS DISTINCT FROM OLD.outward_date OR NEW.outward_number IS DISTINCT FROM OLD.outward_number OR NEW.loading_date IS DISTINCT FROM OLD.loading_date OR NEW.source_income_amount IS DISTINCT FROM OLD.source_income_amount) THEN RAISE EXCEPTION 'Stock Outward source billing fields are locked'; END IF;
     IF OLD.loading_received_journal_entry_id IS NOT NULL AND (NEW.loading_amount_received IS DISTINCT FROM OLD.loading_amount_received OR NEW.loading_received_payment_ledger_id IS DISTINCT FROM OLD.loading_received_payment_ledger_id OR NEW.loading_received_journal_entry_id IS DISTINCT FROM OLD.loading_received_journal_entry_id OR NEW.source_income_amount IS DISTINCT FROM OLD.source_income_amount OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.loading_date IS DISTINCT FROM OLD.loading_date OR NEW.outward_number IS DISTINCT FROM OLD.outward_number) THEN RAISE EXCEPTION 'Posted loading receipt amounts and posting references are locked'; END IF;
     IF OLD.approval_income_journal_entry_id IS NOT NULL AND (NEW.approval_amount IS DISTINCT FROM OLD.approval_amount OR NEW.approval_income_payment_ledger_id IS DISTINCT FROM OLD.approval_income_payment_ledger_id OR NEW.approval_income_journal_entry_id IS DISTINCT FROM OLD.approval_income_journal_entry_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.loading_date IS DISTINCT FROM OLD.loading_date OR NEW.outward_date IS DISTINCT FROM OLD.outward_date OR NEW.outward_number IS DISTINCT FROM OLD.outward_number) THEN RAISE EXCEPTION 'Posted Approval Income amounts and posting references are locked'; END IF;
   END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM public.ltms_source_bill_stock_outward_items i WHERE i.stock_outward_receipt_id=rid) OR EXISTS(SELECT 1 FROM public.stock_outward_receipts r WHERE r.id=rid AND r.workmen_loading_bill_id IS NOT NULL) THEN RAISE EXCEPTION 'Billed Stock Outward details are locked'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS stock_outward_receipt_lock ON public.stock_outward_receipts;
CREATE TRIGGER stock_outward_receipt_lock BEFORE INSERT OR UPDATE OR DELETE ON public.stock_outward_receipts FOR EACH ROW EXECUTE FUNCTION public.prevent_billed_stock_outward_mutation();
DROP TRIGGER IF EXISTS stock_outward_source_lock ON public.stock_outward_sources;
CREATE TRIGGER stock_outward_source_lock BEFORE INSERT OR UPDATE OR DELETE ON public.stock_outward_sources FOR EACH ROW EXECUTE FUNCTION public.prevent_billed_stock_outward_mutation();
DROP TRIGGER IF EXISTS stock_outward_package_lock ON public.stock_outward_packages;
CREATE TRIGGER stock_outward_package_lock BEFORE INSERT OR UPDATE OR DELETE ON public.stock_outward_packages FOR EACH ROW EXECUTE FUNCTION public.prevent_billed_stock_outward_mutation();
DROP TRIGGER IF EXISTS stock_outward_document_lock ON public.stock_outward_documents;
CREATE TRIGGER stock_outward_document_lock BEFORE INSERT OR UPDATE OR DELETE ON public.stock_outward_documents FOR EACH ROW EXECUTE FUNCTION public.prevent_billed_stock_outward_mutation();

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
  v_receipt public.stock_inward_receipts%ROWTYPE;
  v_outward_receipt public.stock_outward_receipts%ROWTYPE;
  v_source public.contracts%ROWTYPE;
  v_journal UUID;
  v_freight NUMERIC(14,2) := 0;
  v_loading NUMERIC(14,2) := 0;
  v_unloading_income NUMERIC(14,2) := 0;
  v_receipt_income NUMERIC(14,2) := 0;
  v_receipt_deduction NUMERIC(14,2) := 0;
  v_receipt_addition NUMERIC(14,2) := 0;
  v_final_receipt_income NUMERIC(14,2) := 0;
  v_line_no INTEGER := 1;
  v_source_kind TEXT;
  v_freight_kind TEXT;
  v_loading_kind TEXT;
  v_unloading_kind TEXT;
BEGIN
  SELECT * INTO v_source FROM public.contracts WHERE id = p_source_id AND branch_id = p_branch_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source does not belong to the selected branch'; END IF;
  IF v_source.source_asset_ledger_id IS NULL OR v_source.freight_income_ledger_id IS NULL OR v_source.loading_income_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Map Source Account, Freight Account and Loading Account in the source master before generating a bill';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.source_asset_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'asset')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.freight_income_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'income')
     OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id = v_source.loading_income_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type = 'income') THEN
    RAISE EXCEPTION 'Source, Freight and Loading accounts must be active accounts from the selected branch with Asset/Income ledger types';
  END IF;
  SELECT account_kind INTO v_source_kind FROM public.ledger_accounts WHERE id = v_source.source_asset_ledger_id;
  SELECT account_kind INTO v_freight_kind FROM public.ledger_accounts WHERE id = v_source.freight_income_ledger_id;
  SELECT account_kind INTO v_loading_kind FROM public.ledger_accounts WHERE id = v_source.loading_income_ledger_id;
  IF p_bill_date IS NULL OR p_due_date IS NULL OR p_period_from IS NULL OR p_period_to IS NULL
     OR p_period_from > p_period_to OR p_bill_date < p_period_from OR p_due_date < p_bill_date THEN
    RAISE EXCEPTION 'Invalid bill dates';
  END IF;
  IF jsonb_typeof(coalesce(p_items, '[]'::JSONB)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Billing items must be supplied as a JSON array';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN
    RAISE EXCEPTION 'Select at least one consignment, Stock Inward, or Stock Outward source-income entry';
  END IF;

  INSERT INTO public.ltms_source_bills (
    branch_id, source_id, bill_date, due_date, period_from, period_to,
    source_company_name, source_legal_business_name, source_gstin, source_address,
    source_address_line1, source_address_line2, source_city, source_state, source_country, source_pin_code,
    total_freight, total_loading, total_unloading_income, created_by
  ) VALUES (
    p_branch_id, p_source_id, p_bill_date, p_due_date, p_period_from, p_period_to,
    v_source.company_name, v_source.legal_business_name, v_source.gstin,
    concat_ws(', ', nullif(v_source.address_line1, ''), nullif(v_source.address_line2, ''), nullif(v_source.city, ''), nullif(v_source.state, ''), nullif(v_source.country, ''), nullif(v_source.pin_code, '')),
    v_source.address_line1, v_source.address_line2, v_source.city, v_source.state, v_source.country, v_source.pin_code,
    0, 0, 0, p_created_by
  ) RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF NULLIF(v_item->>'stock_inward_receipt_id', '') IS NOT NULL THEN
      IF NULLIF(v_item->>'consignment_id', '') IS NOT NULL OR NULLIF(v_item->>'stock_outward_receipt_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'A billing line must reference exactly one consignment or receipt';
      END IF;
      SELECT * INTO v_receipt
      FROM public.stock_inward_receipts
      WHERE id = NULLIF(v_item->>'stock_inward_receipt_id', '')::UUID
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A selected Stock Inward receipt was not found'; END IF;
      IF v_receipt.branch_id IS DISTINCT FROM p_branch_id THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt must belong to the chosen branch';
      END IF;
      IF v_receipt.receipt_date < p_period_from OR v_receipt.receipt_date > p_period_to THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt is outside the billing period';
      END IF;
      IF v_receipt.additional_income_mode NOT IN ('source', 'both') THEN
        RAISE EXCEPTION 'Only Stock Inward entries with Additional Income Type Source or Both can be billed as source income';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.stock_inward_sources s
        WHERE s.receipt_id = v_receipt.id AND s.source_id = p_source_id
      ) THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt is not linked to the selected source';
      END IF;
      PERFORM 1 FROM public.stock_inward_sources s
      WHERE s.receipt_id = v_receipt.id AND s.source_id = p_source_id
      FOR SHARE;
      PERFORM 1 FROM public.stock_inward_packages p
      WHERE p.receipt_id = v_receipt.id AND p.source_id = p_source_id
      FOR SHARE;
      IF EXISTS (
        SELECT 1 FROM public.ltms_source_bill_stock_inward_items i
        WHERE i.stock_inward_receipt_id = v_receipt.id AND i.source_id = p_source_id
      ) THEN
        RAISE EXCEPTION 'This Stock Inward source-income entry has already been billed';
      END IF;

      SELECT round(coalesce(sum(
        CASE
          WHEN t.charge_mode = 'rate' THEN coalesce(slab.amount, 0) *
            CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
          ELSE coalesce(slab.amount, 0)
        END
      ), 0), 2)
      INTO v_receipt_income
      FROM public.stock_inward_packages p
      JOIN public.package_rate_types t ON t.id = p.package_rate_type_id
      LEFT JOIN LATERAL (
        SELECT e.amount
        FROM public.package_rate_entries e
        WHERE e.package_rate_type_id = p.package_rate_type_id
          AND e.rate_kind = 'unloading'
          AND e.from_value <= CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
          AND (e.to_value IS NULL OR CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END <= e.to_value)
        ORDER BY e.from_value DESC
        LIMIT 1
      ) slab ON true
      WHERE p.receipt_id = v_receipt.id AND p.source_id = p_source_id;

      IF v_receipt_income <= 0 THEN
        RAISE EXCEPTION 'Selected Stock Inward receipt has no calculated unloading source income for this source';
      END IF;
      IF round(coalesce(NULLIF(v_item->>'calculated_source_income', '')::NUMERIC, 0), 2) IS DISTINCT FROM v_receipt_income THEN
        RAISE EXCEPTION 'Calculated Source Income changed after selection. Reload Stock Inward entries and try again';
      END IF;
      v_receipt_deduction := round(coalesce(NULLIF(v_item->>'source_income_deduction', '')::NUMERIC, 0), 2);
      v_receipt_addition := round(coalesce(NULLIF(v_item->>'additional_source_income', '')::NUMERIC, 0), 2);
      IF v_receipt_deduction < 0 OR v_receipt_addition < 0 THEN
        RAISE EXCEPTION 'Source-income additions and deductions cannot be negative';
      END IF;
      v_final_receipt_income := greatest(0, round(v_receipt_income - v_receipt_deduction + v_receipt_addition, 2));
      IF round(coalesce(NULLIF(v_item->>'source_income_amount', '')::NUMERIC, 0), 2) IS DISTINCT FROM v_final_receipt_income THEN
        RAISE EXCEPTION 'Adjusted Source Income changed after selection. Review the addition and deduction values and try again';
      END IF;
      IF v_source.unloading_income_ledger_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.ledger_accounts
        WHERE id = v_source.unloading_income_ledger_id
          AND branch_id = p_branch_id AND is_active AND ledger_type = 'income'
      ) THEN
        RAISE EXCEPTION 'Map an active Unloading Account (Income) for this source and branch before billing Stock Inward source income';
      END IF;

      INSERT INTO public.ltms_source_bill_stock_inward_items (
        bill_id, stock_inward_receipt_id, source_id, receipt_number, receipt_date,
        calculated_source_income, source_income_deduction, additional_source_income, source_income_amount
      ) VALUES (
        v_bill_id, v_receipt.id, p_source_id, coalesce(v_receipt.receipt_number, v_receipt.id::TEXT), v_receipt.receipt_date,
        v_receipt_income, v_receipt_deduction, v_receipt_addition, v_final_receipt_income
      );
      v_unloading_income := v_unloading_income + v_final_receipt_income;
    ELSIF NULLIF(v_item->>'stock_outward_receipt_id', '') IS NOT NULL THEN
      IF NULLIF(v_item->>'consignment_id', '') IS NOT NULL OR NULLIF(v_item->>'stock_inward_receipt_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'A billing line must reference exactly one consignment or receipt';
      END IF;
      SELECT * INTO v_outward_receipt FROM public.stock_outward_receipts
      WHERE id = NULLIF(v_item->>'stock_outward_receipt_id', '')::UUID FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A selected Stock Outward receipt was not found'; END IF;
      IF v_outward_receipt.branch_id IS DISTINCT FROM p_branch_id THEN RAISE EXCEPTION 'Selected Stock Outward receipt must belong to the chosen branch'; END IF;
      IF v_outward_receipt.outward_date IS NULL OR v_outward_receipt.outward_date < p_period_from OR v_outward_receipt.outward_date > p_period_to THEN RAISE EXCEPTION 'Selected Stock Outward receipt is outside the billing period'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.stock_outward_sources x WHERE x.receipt_id=v_outward_receipt.id AND x.source_id=p_source_id) THEN RAISE EXCEPTION 'Selected Stock Outward receipt is not linked to the selected source'; END IF;
      PERFORM 1 FROM public.stock_outward_sources x WHERE x.receipt_id=v_outward_receipt.id AND x.source_id=p_source_id FOR SHARE;
      PERFORM 1 FROM public.stock_outward_packages x WHERE x.receipt_id=v_outward_receipt.id AND x.source_id=p_source_id FOR SHARE;
      IF EXISTS(SELECT 1 FROM public.ltms_source_bill_stock_outward_items i WHERE i.stock_outward_receipt_id=v_outward_receipt.id AND i.source_id=p_source_id) THEN RAISE EXCEPTION 'This Stock Outward source-income entry has already been billed'; END IF;
      SELECT round(coalesce(max(si.source_income_amount),0),2) INTO v_receipt_income FROM public.stock_outward_source_income si WHERE si.receipt_id=v_outward_receipt.id AND si.source_id=p_source_id;
      IF NOT EXISTS(SELECT 1 FROM public.stock_outward_source_income si WHERE si.receipt_id=v_outward_receipt.id AND si.source_id=p_source_id) THEN RAISE EXCEPTION 'Refresh Stock Outward source-income snapshots before billing this source'; END IF;
      IF round(coalesce(NULLIF(v_item->>'calculated_source_income','')::NUMERIC,0),2) IS DISTINCT FROM v_receipt_income THEN RAISE EXCEPTION 'Calculated Source Income changed after selection. Reload Stock Outward entries and try again'; END IF;
      v_receipt_deduction:=round(coalesce(NULLIF(v_item->>'source_income_deduction','')::NUMERIC,0),2);
      v_receipt_addition:=round(coalesce(NULLIF(v_item->>'additional_source_income','')::NUMERIC,0),2);
      IF v_receipt_deduction<0 OR v_receipt_addition<0 THEN RAISE EXCEPTION 'Source-income additions and deductions cannot be negative'; END IF;
      v_final_receipt_income:=greatest(0,round(v_receipt_income-v_receipt_deduction+v_receipt_addition,2));
      IF round(coalesce(NULLIF(v_item->>'source_income_amount','')::NUMERIC,0),2) IS DISTINCT FROM v_final_receipt_income THEN RAISE EXCEPTION 'Adjusted Source Income changed after selection. Review the addition and deduction values and try again'; END IF;
      IF v_source.loading_income_ledger_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.ledger_accounts WHERE id=v_source.loading_income_ledger_id AND branch_id=p_branch_id AND is_active AND ledger_type='income') THEN RAISE EXCEPTION 'Map an active Loading Account (Income) for this source and branch before billing Stock Outward source income'; END IF;
      INSERT INTO public.ltms_source_bill_stock_outward_items(bill_id,stock_outward_receipt_id,source_id,outward_number,outward_date,calculated_source_income,source_income_deduction,additional_source_income,source_income_amount)
      VALUES(v_bill_id,v_outward_receipt.id,p_source_id,coalesce(v_outward_receipt.outward_number,v_outward_receipt.id::TEXT),v_outward_receipt.outward_date,v_receipt_income,v_receipt_deduction,v_receipt_addition,v_final_receipt_income);
      v_loading:=v_loading+v_final_receipt_income;
    ELSE
      IF NULLIF(v_item->>'consignment_id', '') IS NULL THEN
        RAISE EXCEPTION 'Each billing line must reference a consignment or Stock Inward or Stock Outward receipt';
      END IF;
      SELECT * INTO v_consign FROM public.consignments
      WHERE id = NULLIF(v_item->>'consignment_id', '')::UUID FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A selected consignment was not found'; END IF;
      IF v_consign.branch_id IS DISTINCT FROM p_branch_id OR v_consign.source_id IS DISTINCT FROM p_source_id THEN
        RAISE EXCEPTION 'Selected consignments must use the chosen branch and source';
      END IF;
      IF v_consign.consignment_date IS NULL OR v_consign.consignment_date < p_period_from OR v_consign.consignment_date > p_period_to THEN
        RAISE EXCEPTION 'Selected consignment is outside the billing period';
      END IF;
      IF v_consign.source_bill_id IS NOT NULL THEN RAISE EXCEPTION 'A selected consignment has already been source billed'; END IF;

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
      UPDATE public.consignments
      SET source_bill_id = v_bill_id, source_billed_at = now(), billing_status = 'billed'
      WHERE id = v_consign.id;
    END IF;
  END LOOP;

  UPDATE public.ltms_source_bills
  SET total_freight = round(v_freight, 2),
      total_loading = round(v_loading, 2),
      total_unloading_income = round(v_unloading_income, 2)
  WHERE id = v_bill_id;

  IF round(v_freight + v_loading + v_unloading_income, 2) <= 0 THEN
    RAISE EXCEPTION 'Source bill total must be greater than zero before posting the journal entry';
  END IF;
  IF v_unloading_income > 0 THEN
    SELECT account_kind INTO v_unloading_kind
    FROM public.ledger_accounts WHERE id = v_source.unloading_income_ledger_id;
  END IF;

  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (
    p_bill_date,
    p_branch_id,
    'Source bill ' || (SELECT bill_number FROM public.ltms_source_bills WHERE id = v_bill_id)
      || ' | Date: ' || p_bill_date::TEXT
      || ' | Freight: ' || round(v_freight, 2)::TEXT
      || ' | Loading: ' || round(v_loading, 2)::TEXT
      || ' | Unloading income: ' || round(v_unloading_income, 2)::TEXT,
    'ltms_source_bill:' || v_bill_id,
    'ltms',
    'approved',
    now()
  ) RETURNING id INTO v_journal;

  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES (
    v_journal, v_line_no, p_branch_id, v_source.source_asset_ledger_id, v_source_kind,
    'Source account - source bill', round(v_freight + v_loading + v_unloading_income, 2), 0
  );
  IF round(v_freight, 2) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES (v_journal, v_line_no, p_branch_id, v_source.freight_income_ledger_id, v_freight_kind, 'Freight income - source bill', 0, round(v_freight, 2));
  END IF;
  IF round(v_loading, 2) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES (v_journal, v_line_no, p_branch_id, v_source.loading_income_ledger_id, v_loading_kind, 'Loading income - source bill', 0, round(v_loading, 2));
  END IF;
  IF round(v_unloading_income, 2) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
    VALUES (v_journal, v_line_no, p_branch_id, v_source.unloading_income_ledger_id, v_unloading_kind, 'Unloading income - Stock Inward source income', 0, round(v_unloading_income, 2));
  END IF;
  PERFORM public.validate_journal_entry(v_journal);
  UPDATE public.ltms_source_bills SET journal_entry_id = v_journal WHERE id = v_bill_id;
  RETURN v_bill_id;
EXCEPTION WHEN OTHERS THEN
  IF v_bill_id IS NOT NULL THEN
    DELETE FROM public.journal_entries WHERE reference = 'ltms_source_bill:' || v_bill_id;
    DELETE FROM public.ltms_source_bill_stock_inward_items WHERE bill_id = v_bill_id;
    DELETE FROM public.ltms_source_bill_stock_outward_items WHERE bill_id = v_bill_id;
    DELETE FROM public.ltms_source_bill_items WHERE bill_id = v_bill_id;
    UPDATE public.consignments
    SET source_bill_id = NULL, source_billed_at = NULL, billing_status = 'to_be_billed'
    WHERE source_bill_id = v_bill_id;
    DELETE FROM public.ltms_source_bills WHERE id = v_bill_id;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_ltms_source_bill(UUID, UUID, DATE, DATE, DATE, DATE, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_ltms_source_bill(UUID, UUID, DATE, DATE, DATE, DATE, JSONB, UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.soft_delete_ltms_source_bill(p_bill_id UUID, p_deleted_by UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_journal UUID;
  v_received_journal UUID;
BEGIN
  SELECT journal_entry_id, received_journal_entry_id
    INTO v_journal, v_received_journal
  FROM public.ltms_source_bills
  WHERE id = p_bill_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source bill was not found or already deleted'; END IF;
  IF v_received_journal IS NOT NULL THEN
    RAISE EXCEPTION 'A received source bill cannot be deleted';
  END IF;
  DELETE FROM public.journal_entries WHERE id = v_journal OR reference = 'ltms_source_bill:' || p_bill_id;
  UPDATE public.consignments SET source_bill_id = NULL, source_billed_at = NULL, billing_status = 'to_be_billed' WHERE source_bill_id = p_bill_id;
  DELETE FROM public.ltms_source_bill_items WHERE bill_id = p_bill_id;
  DELETE FROM public.ltms_source_bill_stock_inward_items WHERE bill_id = p_bill_id;
  DELETE FROM public.ltms_source_bill_stock_outward_items WHERE bill_id = p_bill_id;
  UPDATE public.ltms_source_bills SET deleted_at = now(), deleted_by = coalesce(p_deleted_by, deleted_by), journal_entry_id = NULL WHERE id = p_bill_id;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_ltms_source_bill(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_ltms_source_bill(UUID, UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_workmen_bill(
  p_branch_id UUID,
  p_bill_date DATE,
  p_period_from DATE DEFAULT NULL,
  p_period_to DATE DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_additional_pay_amount NUMERIC DEFAULT 0,
  p_additional_pay_note TEXT DEFAULT NULL,
  p_deduction_amount NUMERIC DEFAULT 0,
  p_deduction_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_id UUID;
  v_journal_id UUID;
  v_item JSONB;
  v_type TEXT;
  v_consignment_id UUID;
  v_receipt_id UUID;
  v_outward_receipt_id UUID;
  v_outward public.stock_outward_receipts%ROWTYPE;
  v_ui_calculated NUMERIC(14,2);
  v_calculated NUMERIC(14,2);
  v_deduction NUMERIC(14,2);
  v_addition NUMERIC(14,2);
  v_final NUMERIC(14,2);
  v_loading NUMERIC(14,2) := 0;
  v_unloading NUMERIC(14,2) := 0;
  v_additional_pay NUMERIC(14,2) := round(greatest(0, coalesce(p_additional_pay_amount, 0)), 2);
  v_bill_deduction NUMERIC(14,2) := round(greatest(0, coalesce(p_deduction_amount, 0)), 2);
  v_total_debits NUMERIC(14,2);
  v_payable NUMERIC(14,2);
  v_number TEXT;
  v_map public.tms_account_ledger_mappings%ROWTYPE;
  v_loading_kind TEXT;
  v_unloading_kind TEXT;
  v_additional_pay_kind TEXT;
  v_payable_kind TEXT;
  v_deduction_kind TEXT;
  v_line_no INTEGER := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required';
  END IF;
  IF (p_period_from IS NULL) <> (p_period_to IS NULL)
     OR (p_period_from IS NOT NULL AND p_period_from > p_period_to) THEN
    RAISE EXCEPTION 'Billing period is invalid';
  END IF;
  IF jsonb_array_length(coalesce(p_items, '[]'::JSONB)) < 1 THEN
    RAISE EXCEPTION 'Add at least one loading or unloading entry';
  END IF;

  v_number := 'WB-' || to_char(coalesce(p_bill_date, current_date), 'YYYYMMDD')
    || '-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6));

  INSERT INTO public.workmen_bills (
    bill_number, branch_id, bill_date, period_from, period_to,
    additional_pay_amount, additional_pay_note, deduction_amount, deduction_note, created_by
  )
  VALUES (
    v_number, p_branch_id, coalesce(p_bill_date, current_date), p_period_from, p_period_to,
    v_additional_pay, NULLIF(trim(p_additional_pay_note), ''), v_bill_deduction,
    NULLIF(trim(p_deduction_note), ''), p_created_by
  )
  RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_type := lower(trim(v_item->>'charge_type'));
    v_consignment_id := NULLIF(v_item->>'consignment_id', '')::UUID;
    v_receipt_id := NULLIF(v_item->>'stock_inward_receipt_id', '')::UUID;
    v_outward_receipt_id := NULLIF(v_item->>'stock_outward_receipt_id', '')::UUID;
    v_ui_calculated := round(coalesce(NULLIF(v_item->>'calculated_amount','')::NUMERIC,0),2);
    v_calculated := round(greatest(0, coalesce(NULLIF(v_item->>'calculated_amount', '')::NUMERIC, 0)), 2);
    v_deduction := round(greatest(0, coalesce(NULLIF(v_item->>'deduction', '')::NUMERIC, 0)), 2);
    v_addition := round(greatest(0, coalesce(NULLIF(v_item->>'addition', '')::NUMERIC, 0)), 2);
    v_final := round(greatest(0, v_calculated - v_deduction + v_addition), 2);

    IF v_type = 'loading' THEN
      IF (CASE WHEN v_consignment_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN v_outward_receipt_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN v_receipt_id IS NOT NULL THEN 1 ELSE 0 END) <> 1 THEN
        RAISE EXCEPTION 'Invalid loading billing entry';
      END IF;
      IF v_outward_receipt_id IS NOT NULL THEN
        SELECT * INTO v_outward FROM public.stock_outward_receipts WHERE id=v_outward_receipt_id FOR UPDATE;
        IF NOT FOUND OR v_outward.branch_id IS DISTINCT FROM p_branch_id OR v_outward.workmen_loading_bill_id IS NOT NULL THEN RAISE EXCEPTION 'Stock Outward entry is missing, belongs to another branch, or is already loading billed'; END IF;
        IF p_period_from IS NOT NULL AND (v_outward.outward_date<p_period_from OR v_outward.outward_date>p_period_to) THEN RAISE EXCEPTION 'Stock Outward entry is outside the billing period'; END IF;
        SELECT round(coalesce(sum(CASE WHEN t.charge_mode='rate' THEN coalesce(e.amount,0)*CASE WHEN t.basis='weight' THEN coalesce(p.weight_kg,0) ELSE coalesce(p.quantity,0) END ELSE coalesce(e.amount,0) END),0),2)
          INTO v_calculated FROM public.stock_outward_packages p JOIN public.package_rate_types t ON t.id=p.package_rate_type_id LEFT JOIN LATERAL(SELECT x.amount FROM public.package_rate_entries x WHERE x.package_rate_type_id=p.package_rate_type_id AND x.rate_kind='loading' AND x.from_value<=CASE WHEN t.basis='weight' THEN coalesce(p.weight_kg,0) ELSE coalesce(p.quantity,0) END AND (x.to_value IS NULL OR CASE WHEN t.basis='weight' THEN coalesce(p.weight_kg,0) ELSE coalesce(p.quantity,0) END<=x.to_value) ORDER BY x.from_value DESC LIMIT 1)e ON true WHERE p.receipt_id=v_outward.id;
        IF round(coalesce(v_calculated,0),2) IS DISTINCT FROM v_ui_calculated THEN RAISE EXCEPTION 'Calculated loading amount changed after selection. Reload Stock Outward entries'; END IF;
        v_calculated:=v_ui_calculated; v_deduction:=round(coalesce(NULLIF(v_item->>'deduction','')::NUMERIC,0),2); v_addition:=round(coalesce(NULLIF(v_item->>'addition','')::NUMERIC,0),2);
        IF v_deduction<0 OR v_addition<0 THEN RAISE EXCEPTION 'Loading additions and deductions cannot be negative'; END IF;
        v_final:=greatest(0,round(v_calculated-v_deduction+v_addition,2));
        IF round(coalesce(NULLIF(v_item->>'final_amount','')::NUMERIC,v_final),2) IS DISTINCT FROM v_final THEN RAISE EXCEPTION 'Adjusted loading amount changed after selection'; END IF;
        PERFORM set_config('app.allow_stock_outward_workmen_link','on',true);
        UPDATE public.stock_outward_receipts SET workmen_loading_bill_id=v_bill_id,workmen_loading_billed_at=now() WHERE id=v_outward.id AND workmen_loading_bill_id IS NULL;
        PERFORM set_config('app.allow_stock_outward_workmen_link','off',true);
        INSERT INTO public.workmen_bill_items(bill_id,charge_type,stock_outward_receipt_id,reference_number,reference_date,package_type,calculated_amount,deduction,addition,final_amount) VALUES(v_bill_id,'loading',v_outward.id,coalesce(v_outward.outward_number,v_outward.id::TEXT),v_outward.outward_date,NULLIF(trim(v_item->>'package_type'),''),v_calculated,v_deduction,v_addition,v_final);
      ELSE
      UPDATE public.consignments
      SET workmen_loading_bill_id = v_bill_id,
          workmen_loading_billed_at = now()
      WHERE id = v_consignment_id
        AND branch_id = p_branch_id
        AND workmen_loading_bill_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Consignment is missing, belongs to another branch, or is already loading billed';
      END IF;
      IF p_period_from IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.consignments c
        WHERE c.id = v_consignment_id
          AND (c.consignment_date < p_period_from OR c.consignment_date > p_period_to)
      ) THEN
        RAISE EXCEPTION 'Loading consignment is outside the billing period';
      END IF;
      INSERT INTO public.workmen_bill_items (
        bill_id, charge_type, consignment_id, reference_number, reference_date, package_type,
        calculated_amount, deduction, addition, final_amount
      )
      SELECT v_bill_id, 'loading', c.id, c.consignment_number, c.consignment_date,
        NULLIF(trim(v_item->>'package_type'), ''), v_calculated, v_deduction, v_addition, v_final
      FROM public.consignments c
      WHERE c.id = v_consignment_id;
      END IF;
      v_loading := v_loading + v_final;
    ELSIF v_type = 'unloading' THEN
      IF v_receipt_id IS NULL OR v_consignment_id IS NOT NULL OR v_outward_receipt_id IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid unloading billing entry';
      END IF;
      UPDATE public.stock_inward_receipts
      SET workmen_unloading_bill_id = v_bill_id,
          workmen_unloading_billed_at = now()
      WHERE id = v_receipt_id
        AND branch_id = p_branch_id
        AND workmen_unloading_bill_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock Inward entry is missing, belongs to another branch, or is already unloading billed';
      END IF;
      IF p_period_from IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.stock_inward_receipts r
        WHERE r.id = v_receipt_id
          AND (r.receipt_date < p_period_from OR r.receipt_date > p_period_to)
      ) THEN
        RAISE EXCEPTION 'Stock Inward entry is outside the billing period';
      END IF;
      INSERT INTO public.workmen_bill_items (
        bill_id, charge_type, stock_inward_receipt_id, reference_number, reference_date, package_type,
        calculated_amount, deduction, addition, final_amount
      )
      SELECT v_bill_id, 'unloading', r.id, coalesce(r.receipt_number, r.id::TEXT), r.receipt_date,
        NULLIF(trim(v_item->>'package_type'), ''), v_calculated, v_deduction, v_addition, v_final
      FROM public.stock_inward_receipts r
      WHERE r.id = v_receipt_id;
      v_unloading := v_unloading + v_final;
    ELSE
      RAISE EXCEPTION 'Charge type must be loading or unloading';
    END IF;
  END LOOP;

  v_total_debits := round(v_loading + v_unloading + v_additional_pay, 2);
  IF v_total_debits <= 0 THEN
    RAISE EXCEPTION 'Workmen Bill total must be greater than zero to post a journal entry';
  END IF;
  IF v_bill_deduction > v_total_debits THEN
    RAISE EXCEPTION 'Bill deduction cannot exceed the loading, unloading, and additional pay total';
  END IF;
  v_payable := round(v_total_debits - v_bill_deduction, 2);

  UPDATE public.workmen_bills
  SET total_loading = v_loading,
      total_unloading = v_unloading,
      grand_total = v_payable,
      updated_at = now()
  WHERE id = v_bill_id;

  SELECT * INTO v_map
  FROM public.tms_account_ledger_mappings
  WHERE branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LTMS account mappings are missing for this Workmen Bill branch';
  END IF;

  IF v_loading > 0 THEN
    IF v_map.workmen_loading_expenditure_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Loading Expenditure account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_loading_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_loading_expenditure_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Loading Expenditure must be an active expenditure ledger from this branch';
    END IF;
  END IF;

  IF v_unloading > 0 THEN
    IF v_map.workmen_unloading_expenditure_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Unloading Expenditure account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_unloading_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_unloading_expenditure_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Unloading Expenditure must be an active expenditure ledger from this branch';
    END IF;
  END IF;

  IF v_additional_pay > 0 THEN
    IF v_map.workmen_additional_pay_expenditure_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Additional Pay account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_additional_pay_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_additional_pay_expenditure_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'expenditure';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Additional Pay must be an active expenditure ledger from this branch';
    END IF;
  END IF;

  IF v_payable > 0 THEN
    IF v_map.workmen_payout_liability_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Payout liability account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_payable_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_payout_liability_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'liability';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Payout must be an active liability ledger from this branch';
    END IF;
  END IF;

  IF v_bill_deduction > 0 THEN
    IF v_map.workmen_deduction_income_ledger_id IS NULL THEN
      RAISE EXCEPTION 'Map the Workmen Deduction account in LTMS Accounts Map for this branch';
    END IF;
    SELECT account_kind INTO v_deduction_kind
    FROM public.ledger_accounts
    WHERE id = v_map.workmen_deduction_income_ledger_id
      AND branch_id = p_branch_id AND is_active AND ledger_type = 'income';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workmen Deduction must be an active income ledger from this branch';
    END IF;
  END IF;

  INSERT INTO public.journal_entries (
    entry_date, branch_id, description, reference, source_module, status, approved_at
  )
  VALUES (
    coalesce(p_bill_date, current_date),
    p_branch_id,
    'Workmen Bill ' || v_number,
    'workmen_bill:' || v_bill_id::TEXT,
    'ltms',
    'approved',
    now()
  )
  RETURNING id INTO v_journal_id;

  IF v_loading > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_loading_expenditure_ledger_id,
      v_loading_kind, 'Workmen loading expenditure - ' || v_number, v_loading, 0
    );
  END IF;
  IF v_unloading > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_unloading_expenditure_ledger_id,
      v_unloading_kind, 'Workmen unloading expenditure - ' || v_number, v_unloading, 0
    );
  END IF;
  IF v_additional_pay > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_additional_pay_expenditure_ledger_id,
      v_additional_pay_kind, 'Workmen additional pay - ' || v_number, v_additional_pay, 0
    );
  END IF;
  IF v_payable > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_payout_liability_ledger_id,
      v_payable_kind, 'Workmen payable - ' || v_number, 0, v_payable
    );
  END IF;
  IF v_bill_deduction > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) VALUES (
      v_journal_id, v_line_no, p_branch_id, v_map.workmen_deduction_income_ledger_id,
      v_deduction_kind, 'Workmen deduction - ' || v_number, 0, v_bill_deduction
    );
  END IF;

  PERFORM public.validate_journal_entry(v_journal_id);

  UPDATE public.workmen_bills
  SET journal_entry_id = v_journal_id,
      updated_at = now()
  WHERE id = v_bill_id;

  RETURN v_bill_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workmen_bill(UUID, DATE, DATE, DATE, UUID, JSONB, NUMERIC, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workmen_bill(UUID, DATE, DATE, DATE, UUID, JSONB, NUMERIC, TEXT, NUMERIC, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_workmen_bill(p_bill_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal_id UUID;
BEGIN
  IF p_bill_id IS NULL THEN
    RAISE EXCEPTION 'Workmen Bill is required';
  END IF;

  SELECT journal_entry_id INTO v_journal_id
  FROM public.workmen_bills
  WHERE id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workmen Bill not found';
  END IF;
  IF v_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'This Workmen Bill has a posted journal entry and cannot be deleted';
  END IF;

  UPDATE public.consignments
  SET workmen_loading_bill_id = NULL,
      workmen_loading_billed_at = NULL
  WHERE workmen_loading_bill_id = p_bill_id;

  UPDATE public.stock_inward_receipts
  SET workmen_unloading_bill_id = NULL,
      workmen_unloading_billed_at = NULL
  WHERE workmen_unloading_bill_id = p_bill_id;

  PERFORM set_config('app.allow_stock_outward_workmen_link','on',true);
  UPDATE public.stock_outward_receipts SET workmen_loading_bill_id=NULL, workmen_loading_billed_at=NULL WHERE workmen_loading_bill_id=p_bill_id;
  PERFORM set_config('app.allow_stock_outward_workmen_link','off',true);

  DELETE FROM public.workmen_bills WHERE id = p_bill_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_workmen_bill(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_workmen_bill(UUID) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.post_stock_outward_approval_income(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_stock_outward_loading_received(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_outward_approval_income(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_stock_outward_loading_received(UUID, UUID, UUID) TO service_role;
COMMIT;
