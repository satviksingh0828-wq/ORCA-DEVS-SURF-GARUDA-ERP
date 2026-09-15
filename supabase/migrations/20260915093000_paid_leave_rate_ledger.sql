-- Preserve the daily salary rate used for each payroll month.
ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS paid_leave_daily_rate numeric(14,6) NOT NULL DEFAULT 0;

-- One row per employee and accrual month. Leave is valued using the rate of
-- the month in which it was earned, not the employee's final-month rate.
CREATE TABLE IF NOT EXISTS public.paid_leave_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  accrual_month date NOT NULL,
  earned_units numeric(8,2) NOT NULL DEFAULT 0,
  used_units numeric(8,2) NOT NULL DEFAULT 0,
  daily_pay_rate numeric(14,6) NOT NULL DEFAULT 0,
  source_payroll_id uuid REFERENCES public.payrolls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, accrual_month)
);

CREATE TABLE IF NOT EXISTS public.paid_leave_usage_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  payroll_id uuid NOT NULL REFERENCES public.payrolls(id) ON DELETE CASCADE,
  accrual_id uuid NOT NULL REFERENCES public.paid_leave_accruals(id) ON DELETE CASCADE,
  usage_type text NOT NULL CHECK (usage_type IN ('leave_used', 'final_settlement')),
  units numeric(8,2) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_id, accrual_id, usage_type)
);

ALTER TABLE public.paid_leave_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paid_leave_usage_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY paid_leave_accruals_app_access ON public.paid_leave_accruals
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY paid_leave_usage_app_access ON public.paid_leave_usage_allocations
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
