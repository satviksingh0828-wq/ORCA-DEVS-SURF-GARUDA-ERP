BEGIN;

ALTER TABLE public.stock_inward_documents
  ADD COLUMN IF NOT EXISTS vehicle_number TEXT;

COMMENT ON COLUMN public.stock_inward_documents.vehicle_number IS
  'Vehicle registration number associated with this Stock Inward document.';

COMMIT;
