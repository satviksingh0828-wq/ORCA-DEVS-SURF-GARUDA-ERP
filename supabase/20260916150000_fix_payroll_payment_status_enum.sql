-- Avoid coercing an empty string to the payroll_payment_status enum.
-- This replaces the enum-unsafe condition introduced by the payroll journal trigger.
BEGIN;

CREATE OR REPLACE FUNCTION public.hrms_payroll_accounting_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.hrms_create_payroll_generated_journal(NEW);
  END IF;

  IF NEW.payment_status IN (
    'paid'::public.payroll_payment_status,
    'partial_paid'::public.payroll_payment_status
  ) THEN
    IF TG_OP = 'INSERT'
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount THEN
      PERFORM public.hrms_create_payroll_paid_journal(NEW);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
