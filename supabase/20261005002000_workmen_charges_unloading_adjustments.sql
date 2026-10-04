BEGIN;
-- Workmen Charges supports adjustments for both Loading Charges and Inward Receipt unloading.
-- Existing loading adjustments remain on consignments; unloading adjustments are stored on receipts.
ALTER TABLE public.stock_inward_receipts
  ADD COLUMN IF NOT EXISTS unloading_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_unloading NUMERIC(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.stock_inward_receipts
  DROP CONSTRAINT IF EXISTS stock_inward_unloading_deduction_check,
  DROP CONSTRAINT IF EXISTS stock_inward_additional_unloading_check;

ALTER TABLE public.stock_inward_receipts
  ADD CONSTRAINT stock_inward_unloading_deduction_check CHECK (unloading_deduction >= 0),
  ADD CONSTRAINT stock_inward_additional_unloading_check CHECK (additional_unloading >= 0);
COMMIT;
