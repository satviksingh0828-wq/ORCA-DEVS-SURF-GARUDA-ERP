-- Run once in Supabase SQL Editor, before using the new Transporter form.
-- Covers TMS and LTMS Transporter masters; Rentals remain unchanged.
-- This only adds master rates. It does NOT post charges to consignments.
BEGIN;

ALTER TABLE public.transporters
  ADD COLUMN IF NOT EXISTS per_consignment_charges NUMERIC(12,2)
  NOT NULL DEFAULT 0 CHECK (per_consignment_charges >= 0);

ALTER TABLE public.ltms_transporters
  ADD COLUMN IF NOT EXISTS per_consignment_charges NUMERIC(12,2)
  NOT NULL DEFAULT 0 CHECK (per_consignment_charges >= 0);

COMMIT;
