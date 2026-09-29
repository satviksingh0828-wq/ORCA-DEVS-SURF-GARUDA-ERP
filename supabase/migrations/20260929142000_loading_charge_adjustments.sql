BEGIN;

-- Loading Charges report adjustments are stored per consignment.
-- Final loading = calculated package-rate loading
--                  - loading_deduction + additional_loading.
ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS loading_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_loading NUMERIC(14, 2) NOT NULL DEFAULT 0;

COMMIT;
