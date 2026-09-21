BEGIN;

CREATE TABLE IF NOT EXISTS public.income_verification_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expenditure_verification_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS income_verification_pending_status_idx
  ON public.income_verification_pending(status, created_at DESC);
CREATE INDEX IF NOT EXISTS expenditure_verification_pending_status_idx
  ON public.expenditure_verification_pending(status, created_at DESC);
CREATE INDEX IF NOT EXISTS income_verification_pending_submitter_idx
  ON public.income_verification_pending(submitted_by, created_at DESC);
CREATE INDEX IF NOT EXISTS expenditure_verification_pending_submitter_idx
  ON public.expenditure_verification_pending(submitted_by, created_at DESC);

ALTER TABLE public.income_verification_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenditure_verification_pending ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app can view pending income verification" ON public.income_verification_pending;
CREATE POLICY "app can view pending income verification" ON public.income_verification_pending
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "app can submit pending income verification" ON public.income_verification_pending;
CREATE POLICY "app can submit pending income verification" ON public.income_verification_pending
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "app can view pending expenditure verification" ON public.expenditure_verification_pending;
CREATE POLICY "app can view pending expenditure verification" ON public.expenditure_verification_pending
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "app can submit pending expenditure verification" ON public.expenditure_verification_pending;
CREATE POLICY "app can submit pending expenditure verification" ON public.expenditure_verification_pending
  FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.income_verification_pending TO anon, authenticated;
GRANT SELECT, INSERT ON public.expenditure_verification_pending TO anon, authenticated;
GRANT ALL ON public.income_verification_pending TO service_role;
GRANT ALL ON public.expenditure_verification_pending TO service_role;

CREATE OR REPLACE FUNCTION public.tms_approve_pending_finance(
  p_kind TEXT,
  p_pending_id UUID,
  p_reviewer_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_payload JSONB;
  v_status TEXT;
  v_actual_id UUID;
BEGIN
  SELECT role INTO v_role
  FROM public.app_users
  WHERE id = p_reviewer_id AND is_active = true AND is_paused = false;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'semi_admin', 'viewer') THEN
    RAISE EXCEPTION 'Only Admin, Semi-Admin, or Viewer users can approve finance entries';
  END IF;

  IF p_kind = 'income' THEN
    SELECT payload, status INTO v_payload, v_status
    FROM public.income_verification_pending
    WHERE id = p_pending_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pending income verification entry not found'; END IF;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'This income entry has already been reviewed'; END IF;

    INSERT INTO public.incomes(
      income_name, amount, note, entry_date, branch_id, vehicle_id, driver_id, transporter_id,
      is_received, received_date, income_ledger_id, income_receivable_ledger_id, payment_ledger_id
    ) VALUES (
      COALESCE(v_payload->>'income_name', ''),
      COALESCE(v_payload->>'amount', ''),
      COALESCE(v_payload->>'note', ''),
      COALESCE(v_payload->>'entry_date', ''),
      NULLIF(v_payload->>'branch_id', '')::UUID,
      NULLIF(v_payload->>'vehicle_id', '')::UUID,
      NULLIF(v_payload->>'driver_id', '')::UUID,
      NULLIF(v_payload->>'transporter_id', '')::UUID,
      COALESCE((v_payload->>'is_received')::BOOLEAN, false),
      COALESCE(v_payload->>'received_date', ''),
      NULLIF(v_payload->>'income_ledger_id', '')::UUID,
      NULLIF(v_payload->>'income_receivable_ledger_id', '')::UUID,
      NULLIF(v_payload->>'payment_ledger_id', '')::UUID
    ) RETURNING id INTO v_actual_id;

    UPDATE public.income_verification_pending
    SET status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now()
    WHERE id = p_pending_id;
    RETURN v_actual_id;
  ELSIF p_kind = 'expenditure' THEN
    SELECT payload, status INTO v_payload, v_status
    FROM public.expenditure_verification_pending
    WHERE id = p_pending_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pending expenditure verification entry not found'; END IF;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'This expenditure entry has already been reviewed'; END IF;

    INSERT INTO public.expenditures(
      expenditure_name, amount, note, entry_date, branch_id, vehicle_id, driver_id, transporter_id,
      is_paid, paid_date, expenditure_ledger_id, expenditure_payable_ledger_id, payment_ledger_id
    ) VALUES (
      COALESCE(v_payload->>'expenditure_name', ''),
      COALESCE(v_payload->>'amount', ''),
      COALESCE(v_payload->>'note', ''),
      COALESCE(v_payload->>'entry_date', ''),
      NULLIF(v_payload->>'branch_id', '')::UUID,
      NULLIF(v_payload->>'vehicle_id', '')::UUID,
      NULLIF(v_payload->>'driver_id', '')::UUID,
      NULLIF(v_payload->>'transporter_id', '')::UUID,
      COALESCE((v_payload->>'is_paid')::BOOLEAN, false),
      COALESCE(v_payload->>'paid_date', ''),
      NULLIF(v_payload->>'expenditure_ledger_id', '')::UUID,
      NULLIF(v_payload->>'expenditure_payable_ledger_id', '')::UUID,
      NULLIF(v_payload->>'payment_ledger_id', '')::UUID
    ) RETURNING id INTO v_actual_id;

    UPDATE public.expenditure_verification_pending
    SET status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now()
    WHERE id = p_pending_id;
    RETURN v_actual_id;
  ELSE
    RAISE EXCEPTION 'Unsupported finance verification kind';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tms_approve_pending_finance(TEXT, UUID, UUID) TO anon, authenticated;

COMMIT;
