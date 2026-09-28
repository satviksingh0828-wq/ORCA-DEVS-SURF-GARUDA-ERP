-- Add mandatory Billing status to LTMS consignments.
-- Existing consignments default to "To be billed".
ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'to_be_billed';

ALTER TABLE public.consignments
  DROP CONSTRAINT IF EXISTS consignments_billing_status_check;

ALTER TABLE public.consignments
  ADD CONSTRAINT consignments_billing_status_check
  CHECK (billing_status IN ('to_be_billed', 'billed', 'billed_and_paid'));
