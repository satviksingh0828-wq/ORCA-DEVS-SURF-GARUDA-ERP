BEGIN;

CREATE TABLE IF NOT EXISTS public.account_depreciation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  asset_ledger_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  expense_ledger_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  current_value NUMERIC(14,2) NOT NULL CHECK (current_value > 0),
  period TEXT NOT NULL CHECK (period IN ('monthly','quarterly','yearly')),
  depreciation_type TEXT NOT NULL CHECK (depreciation_type IN ('fixed','reducing_balance')),
  fixed_method TEXT CHECK (fixed_method IN ('amount','percentage')),
  rate NUMERIC(9,4),
  fixed_amount NUMERIC(14,2),
  first_period DATE NOT NULL,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (depreciation_type = 'fixed' AND fixed_method IS NOT NULL AND fixed_amount IS NOT NULL AND fixed_amount > 0 AND rate IS NULL)
    OR
    (depreciation_type = 'reducing_balance' AND rate IS NOT NULL AND rate > 0 AND rate <= 100 AND fixed_method IS NULL AND fixed_amount IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.account_depreciation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.account_depreciation_schedules(id) ON DELETE SET NULL,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  asset_ledger_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  expense_ledger_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  opening_value NUMERIC(14,2) NOT NULL CHECK (opening_value >= 0),
  depreciation_amount NUMERIC(14,2) NOT NULL CHECK (depreciation_amount > 0),
  closing_value NUMERIC(14,2) NOT NULL CHECK (closing_value >= 0),
  journal_entry_id UUID NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  posted_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, period_start)
);

CREATE INDEX IF NOT EXISTS account_depreciation_schedules_filter_idx
  ON public.account_depreciation_schedules(branch_id, asset_ledger_id);
CREATE INDEX IF NOT EXISTS account_depreciation_entries_filter_idx
  ON public.account_depreciation_entries(branch_id, asset_ledger_id, period_start DESC);

ALTER TABLE public.account_depreciation_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_depreciation_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_depreciation_schedules_app ON public.account_depreciation_schedules;
DROP POLICY IF EXISTS account_depreciation_entries_app ON public.account_depreciation_entries;
CREATE POLICY account_depreciation_schedules_app ON public.account_depreciation_schedules FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY account_depreciation_entries_app ON public.account_depreciation_entries FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.account_depreciation_schedules, public.account_depreciation_entries TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_account_depreciation_schedule(
  p_branch_id UUID,
  p_asset_ledger_id UUID,
  p_expense_ledger_id UUID,
  p_current_value NUMERIC,
  p_period TEXT,
  p_depreciation_type TEXT,
  p_fixed_method TEXT,
  p_rate NUMERIC,
  p_fixed_amount NUMERIC,
  p_first_period DATE,
  p_created_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_role TEXT;
  v_fixed_amount NUMERIC(14,2) := round(coalesce(p_fixed_amount, 0), 2);
BEGIN
  SELECT role INTO v_role FROM public.app_users WHERE id = p_created_by AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') THEN RAISE EXCEPTION 'This user cannot create depreciation schedules'; END IF;
  IF v_role = 'basic' AND NOT EXISTS (SELECT 1 FROM public.user_branch_access WHERE user_id=p_created_by AND branch_id=p_branch_id) THEN
    RAISE EXCEPTION 'Basic users can create schedules only for an assigned branch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id=p_branch_id) THEN RAISE EXCEPTION 'Branch was not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id=p_asset_ledger_id AND branch_id=p_branch_id AND is_active AND ledger_type='asset') THEN
    RAISE EXCEPTION 'Asset must be an active asset ledger from the selected branch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE id=p_expense_ledger_id AND branch_id=p_branch_id AND is_active AND ledger_type='expenditure') THEN
    RAISE EXCEPTION 'Depreciation account must be an active expenditure ledger from the selected branch';
  END IF;
  IF p_current_value IS NULL OR p_current_value <= 0 THEN RAISE EXCEPTION 'Current asset value must be greater than zero'; END IF;
  IF p_period NOT IN ('monthly','quarterly','yearly') THEN RAISE EXCEPTION 'Invalid depreciation period'; END IF;
  IF p_depreciation_type = 'fixed' THEN
    IF p_fixed_method NOT IN ('amount','percentage') THEN RAISE EXCEPTION 'Select a fixed depreciation method'; END IF;
    IF p_fixed_method = 'percentage' THEN
      IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 100 THEN RAISE EXCEPTION 'Fixed percentage must be between 0 and 100'; END IF;
      v_fixed_amount := round(p_current_value * p_rate / 100, 2);
    END IF;
    IF v_fixed_amount <= 0 OR v_fixed_amount > p_current_value THEN RAISE EXCEPTION 'Fixed depreciation amount must be greater than zero and not exceed current value'; END IF;
  ELSIF p_depreciation_type = 'reducing_balance' THEN
    IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 100 THEN RAISE EXCEPTION 'Reducing-balance percentage must be between 0 and 100'; END IF;
    p_fixed_method := NULL;
    v_fixed_amount := NULL;
  ELSE
    RAISE EXCEPTION 'Invalid depreciation type';
  END IF;
  INSERT INTO public.account_depreciation_schedules(branch_id,asset_ledger_id,expense_ledger_id,current_value,period,depreciation_type,fixed_method,rate,fixed_amount,first_period,created_by)
  VALUES(p_branch_id,p_asset_ledger_id,p_expense_ledger_id,round(p_current_value,2),p_period,p_depreciation_type,p_fixed_method,p_rate,v_fixed_amount,coalesce(p_first_period,current_date),p_created_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_account_depreciation_schedule(UUID,UUID,UUID,NUMERIC,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,DATE,UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_account_depreciation_entry(
  p_schedule_id UUID,
  p_period_start DATE,
  p_posted_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_schedule public.account_depreciation_schedules%ROWTYPE;
  v_last public.account_depreciation_entries%ROWTYPE;
  v_opening NUMERIC(14,2);
  v_amount NUMERIC(14,2);
  v_closing NUMERIC(14,2);
  v_journal UUID;
  v_kind TEXT;
  v_role TEXT;
  v_step INTERVAL;
BEGIN
  SELECT role INTO v_role FROM public.app_users WHERE id=p_posted_by AND is_active=true;
  IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') THEN RAISE EXCEPTION 'This user cannot post depreciation'; END IF;
  SELECT * INTO v_schedule FROM public.account_depreciation_schedules WHERE id=p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depreciation schedule was not found'; END IF;
  IF v_role='basic' AND NOT EXISTS (SELECT 1 FROM public.user_branch_access WHERE user_id=p_posted_by AND branch_id=v_schedule.branch_id) THEN
    RAISE EXCEPTION 'Basic users can post only to an assigned branch';
  END IF;
  IF p_period_start IS NULL OR p_period_start < v_schedule.first_period THEN RAISE EXCEPTION 'Posting period is before the schedule start'; END IF;
  IF EXISTS (SELECT 1 FROM public.account_depreciation_entries WHERE schedule_id=p_schedule_id AND period_start=p_period_start) THEN
    RAISE EXCEPTION 'Depreciation for this period has already been posted';
  END IF;
  v_step := CASE v_schedule.period WHEN 'monthly' THEN interval '1 month' WHEN 'quarterly' THEN interval '3 months' ELSE interval '1 year' END;
  IF p_period_start <> date_trunc('month', p_period_start)::date THEN RAISE EXCEPTION 'Posting period must be the first day of a month'; END IF;
  SELECT * INTO v_last FROM public.account_depreciation_entries WHERE schedule_id=p_schedule_id ORDER BY period_start DESC LIMIT 1;
  IF v_last.id IS NOT NULL AND p_period_start <> (date_trunc('month', v_last.period_start)::date + v_step)::date THEN
    RAISE EXCEPTION 'Post periods in order; the next period is %', (date_trunc('month', v_last.period_start)::date + v_step)::date;
  END IF;
  v_opening := coalesce(v_last.closing_value, v_schedule.current_value);
  IF v_opening <= 0 THEN RAISE EXCEPTION 'Asset has no remaining value'; END IF;
  v_amount := CASE WHEN v_schedule.depreciation_type='fixed' THEN least(v_schedule.fixed_amount, v_opening) ELSE round(v_opening * v_schedule.rate / 100, 2) END;
  v_amount := least(v_amount, v_opening);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Calculated depreciation is zero'; END IF;
  v_closing := round(v_opening-v_amount,2);
  SELECT account_kind INTO v_kind FROM public.ledger_accounts WHERE id=v_schedule.expense_ledger_id;
  INSERT INTO public.journal_entries(entry_date,branch_id,description,reference,source_module,status,approved_at)
  VALUES(p_period_start,v_schedule.branch_id,'Depreciation - ' || (SELECT account_name FROM public.ledger_accounts WHERE id=v_schedule.asset_ledger_id),'account_depreciation:'||p_schedule_id||':'||to_char(p_period_start,'YYYY-MM-DD'),'manual','approved',now()) RETURNING id INTO v_journal;
  INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit)
  VALUES
    (v_journal,1,v_schedule.branch_id,v_schedule.expense_ledger_id,v_kind,'Depreciation expense',v_amount,0),
    (v_journal,2,v_schedule.branch_id,v_schedule.asset_ledger_id,(SELECT account_kind FROM public.ledger_accounts WHERE id=v_schedule.asset_ledger_id),'Asset depreciation',0,v_amount);
  PERFORM public.validate_journal_entry(v_journal);
  INSERT INTO public.account_depreciation_entries(schedule_id,branch_id,asset_ledger_id,expense_ledger_id,period_start,opening_value,depreciation_amount,closing_value,journal_entry_id,posted_by)
  VALUES(p_schedule_id,v_schedule.branch_id,v_schedule.asset_ledger_id,v_schedule.expense_ledger_id,p_period_start,v_opening,v_amount,v_closing,v_journal,p_posted_by);
  RETURN v_journal;
EXCEPTION WHEN others THEN
  IF v_journal IS NOT NULL THEN DELETE FROM public.journal_entries WHERE id=v_journal; END IF;
  RAISE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_account_depreciation_entry(UUID,DATE,UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_account_depreciation_schedule(p_schedule_id UUID, p_deleted_by UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role TEXT; v_branch UUID;
BEGIN
  SELECT role INTO v_role FROM public.app_users WHERE id=p_deleted_by AND is_active=true;
  SELECT branch_id INTO v_branch FROM public.account_depreciation_schedules WHERE id=p_schedule_id;
  IF v_role IS NULL OR v_role NOT IN ('admin','semi_admin','basic') THEN RAISE EXCEPTION 'This user cannot delete schedules'; END IF;
  IF v_role='basic' AND NOT EXISTS (SELECT 1 FROM public.user_branch_access WHERE user_id=p_deleted_by AND branch_id=v_branch) THEN RAISE EXCEPTION 'Basic users can delete only schedules for an assigned branch'; END IF;
  DELETE FROM public.account_depreciation_schedules WHERE id=p_schedule_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_account_depreciation_schedule(UUID,UUID) TO anon, authenticated;
COMMIT;
