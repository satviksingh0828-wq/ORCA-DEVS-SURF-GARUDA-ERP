BEGIN;

ALTER TABLE public.driver_advances
  ADD COLUMN IF NOT EXISTS disbursement_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.driver_payroll_verification_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_advance_verification_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_payroll_verification_pending_status_idx
  ON public.driver_payroll_verification_pending(status, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_advance_verification_pending_status_idx
  ON public.driver_advance_verification_pending(status, created_at DESC);

ALTER TABLE public.driver_payroll_verification_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_advance_verification_pending ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.driver_payroll_verification_pending TO anon, authenticated;
GRANT SELECT, INSERT ON public.driver_advance_verification_pending TO anon, authenticated;
GRANT ALL ON public.driver_payroll_verification_pending TO service_role;
GRANT ALL ON public.driver_advance_verification_pending TO service_role;

CREATE OR REPLACE FUNCTION public.tms_approve_pending_driver_payroll(
  p_pending_id UUID,
  p_reviewer_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_payload JSONB;
  v_status TEXT;
  v_payroll_id UUID;
  v_expenditure_id UUID;
BEGIN
  SELECT role INTO v_role FROM public.app_users
  WHERE id = p_reviewer_id AND is_active = true AND is_paused = false;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'semi_admin', 'viewer') THEN
    RAISE EXCEPTION 'Only Admin, Semi-Admin, or Viewer users can approve driver payroll';
  END IF;

  SELECT payload, status INTO v_payload, v_status
  FROM public.driver_payroll_verification_pending
  WHERE id = p_pending_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending driver payroll was not found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'This driver payroll has already been reviewed'; END IF;

  INSERT INTO public.driver_payrolls(
    driver_id, branch_id, month, salary_amount, advance_deduction, net_amount,
    is_paid, note
  ) VALUES (
    NULLIF(v_payload->>'driver_id', '')::UUID,
    NULLIF(v_payload->>'branch_id', '')::UUID,
    v_payload->>'month',
    COALESCE((v_payload->>'salary_amount')::NUMERIC, 0),
    COALESCE((v_payload->>'advance_deduction')::NUMERIC, 0),
    COALESCE((v_payload->>'net_amount')::NUMERIC, 0),
    false,
    NULLIF(v_payload->>'note', '')
  ) RETURNING id INTO v_payroll_id;

  INSERT INTO public.expenditures(
    expenditure_name, amount, entry_date, driver_id, branch_id,
    is_paid, is_payroll, payroll_id, note
  ) VALUES (
    'Payroll — ' || COALESCE(v_payload->>'driver_name', 'Driver') || ' (' || (v_payload->>'month') || ')',
    COALESCE(v_payload->>'salary_amount', '0'),
    (v_payload->>'month') || '-01',
    NULLIF(v_payload->>'driver_id', '')::UUID,
    NULLIF(v_payload->>'branch_id', '')::UUID,
    false, true, v_payroll_id,
    NULLIF(v_payload->>'note', '')
  ) RETURNING id INTO v_expenditure_id;

  UPDATE public.driver_payrolls SET expenditure_id = v_expenditure_id WHERE id = v_payroll_id;
  UPDATE public.driver_payroll_verification_pending
  SET status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now()
  WHERE id = p_pending_id;
  RETURN v_payroll_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tms_approve_pending_driver_advance(
  p_pending_id UUID,
  p_reviewer_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_payload JSONB;
  v_status TEXT;
  v_advance_id UUID;
  v_schedule JSONB;
  v_row JSONB;
BEGIN
  SELECT role INTO v_role FROM public.app_users
  WHERE id = p_reviewer_id AND is_active = true AND is_paused = false;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'semi_admin', 'viewer') THEN
    RAISE EXCEPTION 'Only Admin, Semi-Admin, or Viewer users can approve driver advances';
  END IF;

  SELECT payload, status INTO v_payload, v_status
  FROM public.driver_advance_verification_pending
  WHERE id = p_pending_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending driver advance was not found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'This driver advance has already been reviewed'; END IF;

  INSERT INTO public.driver_advances(
    driver_id, branch_id, amount, remaining_balance, payment_date,
    monthly_deduction, disbursement_ledger_id, note
  ) VALUES (
    NULLIF(v_payload->>'driver_id', '')::UUID,
    NULLIF(v_payload->>'branch_id', '')::UUID,
    COALESCE((v_payload->>'amount')::NUMERIC, 0),
    COALESCE((v_payload->>'amount')::NUMERIC, 0),
    v_payload->>'payment_date',
    COALESCE((v_payload->>'monthly_deduction')::NUMERIC, 0),
    NULLIF(v_payload->>'disbursement_ledger_id', '')::UUID,
    NULLIF(v_payload->>'note', '')
  ) RETURNING id INTO v_advance_id;

  v_schedule := COALESCE((v_payload->>'schedule')::JSONB, '[]'::JSONB);
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_schedule)
  LOOP
    INSERT INTO public.driver_advance_deductions(
      advance_id, driver_id, month, deduction_amount, is_applied
    ) VALUES (
      v_advance_id,
      NULLIF(v_payload->>'driver_id', '')::UUID,
      v_row->>'month',
      COALESCE((v_row->>'amount')::NUMERIC, 0),
      false
    );
  END LOOP;

  UPDATE public.driver_advance_verification_pending
  SET status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now()
  WHERE id = p_pending_id;
  RETURN v_advance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tms_approve_pending_driver_payroll(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tms_approve_pending_driver_advance(UUID, UUID) TO anon, authenticated;

COMMIT;
