-- Adds vehicle registration number storage for each Stock Inward document.
-- Safe to run more than once. Existing records remain NULL until populated.
ALTER TABLE public.stock_inward_documents
  ADD COLUMN IF NOT EXISTS vehicle_number TEXT;

COMMENT ON COLUMN public.stock_inward_documents.vehicle_number IS
  'Vehicle registration number associated with this Stock Inward document.';
