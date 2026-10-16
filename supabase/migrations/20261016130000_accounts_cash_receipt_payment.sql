BEGIN;
CREATE TABLE IF NOT EXISTS public.account_cash_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number TEXT NOT NULL UNIQUE,
  voucher_type TEXT NOT NULL CHECK (voucher_type IN ('receipt','payment')),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  voucher_date DATE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  supporting_document TEXT,
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_cash_vouchers_filter_idx ON public.account_cash_vouchers(voucher_type, branch_id, voucher_date DESC);
ALTER TABLE public.account_cash_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_cash_vouchers_app ON public.account_cash_vouchers;
CREATE POLICY account_cash_vouchers_app ON public.account_cash_vouchers FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.account_cash_vouchers TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_account_cash_voucher(
  p_voucher_type TEXT,
  p_branch_id UUID,
  p_voucher_date DATE,
  p_name TEXT,
  p_description TEXT,
  p_supporting_document TEXT,
  p_created_by UUID,
  p_income_expense_lines JSONB,
  p_cash_bank_lines JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_voucher_id UUID;
  v_journal_id UUID;
  v_number TEXT;
  v_amount NUMERIC(14,2) := 0;
  v_cash_total NUMERIC(14,2) := 0;
  v_line JSONB;
  v_account UUID;
  v_line_amount NUMERIC(14,2);
  v_kind TEXT;
  v_expected TEXT;
  v_idx INTEGER := 0;
BEGIN
  IF p_voucher_type NOT IN ('receipt','payment') THEN RAISE EXCEPTION 'Voucher type must be receipt or payment'; END IF;
  IF p_branch_id IS NULL OR p_created_by IS NULL OR NULLIF(trim(coalesce(p_name,'')), '') IS NULL THEN RAISE EXCEPTION 'Branch, user and name are required'; END IF;
  SELECT role INTO v_role FROM public.app_users WHERE id = p_created_by AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') THEN RAISE EXCEPTION 'This user cannot post cash vouchers'; END IF;
  IF v_role = 'basic' AND NOT EXISTS (SELECT 1 FROM public.user_branch_access WHERE user_id = p_created_by AND branch_id = p_branch_id) THEN
    RAISE EXCEPTION 'Basic users can post only to an assigned branch';
  END IF;
  IF jsonb_typeof(p_income_expense_lines) <> 'array' OR jsonb_array_length(p_income_expense_lines) = 0
     OR jsonb_typeof(p_cash_bank_lines) <> 'array' OR jsonb_array_length(p_cash_bank_lines) = 0 THEN
    RAISE EXCEPTION 'At least one income/expense line and one cash/bank line are required';
  END IF;
  v_expected := CASE WHEN p_voucher_type = 'receipt' THEN 'income' ELSE 'expenditure' END;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_income_expense_lines) LOOP
    v_account := NULLIF(v_line->>'account_id','')::UUID;
    v_line_amount := round(coalesce((v_line->>'amount')::NUMERIC,0),2);
    IF v_line_amount <= 0 OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id=v_account AND branch_id=p_branch_id AND is_active AND ledger_type=v_expected) THEN
      RAISE EXCEPTION 'Each income/expense account must be active, of the correct type, and belong to the selected branch';
    END IF;
    v_amount := v_amount + v_line_amount;
  END LOOP;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_cash_bank_lines) LOOP
    v_account := NULLIF(v_line->>'account_id','')::UUID;
    v_line_amount := round(coalesce((v_line->>'amount')::NUMERIC,0),2);
    IF v_line_amount <= 0 OR NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id=v_account AND branch_id=p_branch_id AND is_active AND ledger_type IN ('cash','bank')) THEN
      RAISE EXCEPTION 'Each cash/bank account must be active and belong to the selected branch';
    END IF;
    v_cash_total := v_cash_total + v_line_amount;
  END LOOP;
  IF v_amount <= 0 OR abs(v_amount-v_cash_total) > 0.005 THEN RAISE EXCEPTION 'Voucher lines must be balanced'; END IF;
  IF p_supporting_document IS NOT NULL AND (split_part(p_supporting_document,'/',1) <> p_branch_id::TEXT OR p_supporting_document LIKE '%..%') THEN
    RAISE EXCEPTION 'Invalid supporting document path';
  END IF;
  v_number := CASE WHEN p_voucher_type='receipt' THEN 'CR-' ELSE 'CP-' END || to_char(coalesce(p_voucher_date,current_date),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::TEXT,'-',''),1,6));
  INSERT INTO public.journal_entries(entry_date,branch_id,description,reference,source_module,status,approved_at)
  VALUES(coalesce(p_voucher_date,current_date),p_branch_id,trim(p_name)||CASE WHEN NULLIF(trim(coalesce(p_description,'')),'') IS NULL THEN '' ELSE ' — '||trim(p_description) END,'account_cash_voucher:'||v_number,'manual','approved',now())
  RETURNING id INTO v_journal_id;
  v_idx := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_income_expense_lines) LOOP
    v_idx := v_idx+1; v_account := (v_line->>'account_id')::UUID; v_line_amount := round((v_line->>'amount')::NUMERIC,2);
    SELECT account_kind INTO v_kind FROM public.ledger_accounts WHERE id=v_account;
    INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit)
    VALUES(v_journal_id,v_idx,p_branch_id,v_account,coalesce(v_kind,'ledger'),trim(p_name),CASE WHEN p_voucher_type='payment' THEN v_line_amount ELSE 0 END,CASE WHEN p_voucher_type='receipt' THEN v_line_amount ELSE 0 END);
  END LOOP;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_cash_bank_lines) LOOP
    v_idx := v_idx+1; v_account := (v_line->>'account_id')::UUID; v_line_amount := round((v_line->>'amount')::NUMERIC,2);
    SELECT account_kind INTO v_kind FROM public.ledger_accounts WHERE id=v_account;
    INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit)
    VALUES(v_journal_id,v_idx,p_branch_id,v_account,coalesce(v_kind,'ledger'),trim(p_name),CASE WHEN p_voucher_type='receipt' THEN v_line_amount ELSE 0 END,CASE WHEN p_voucher_type='payment' THEN v_line_amount ELSE 0 END);
  END LOOP;
  PERFORM public.validate_journal_entry(v_journal_id);
  INSERT INTO public.account_cash_vouchers(voucher_number,voucher_type,branch_id,voucher_date,name,description,amount,supporting_document,journal_entry_id,created_by)
  VALUES(v_number,p_voucher_type,p_branch_id,coalesce(p_voucher_date,current_date),trim(p_name),NULLIF(trim(coalesce(p_description,'')),''),v_amount,p_supporting_document,v_journal_id,p_created_by)
  RETURNING id INTO v_voucher_id;
  RETURN v_voucher_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.post_account_cash_voucher(TEXT,UUID,DATE,TEXT,TEXT,TEXT,UUID,JSONB,JSONB) TO anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('account-cash-vouchers','account-cash-vouchers',false,10485760,ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS account_cash_vouchers_upload ON storage.objects;
DROP POLICY IF EXISTS account_cash_vouchers_read ON storage.objects;
CREATE POLICY account_cash_vouchers_upload ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id='account-cash-vouchers');
CREATE POLICY account_cash_vouchers_read ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id='account-cash-vouchers');
COMMIT;
