BEGIN;

-- Transporter is only applicable to Third Party consignments.
-- Own-vehicle and rental movements must store NULL instead of requiring a transporter.
ALTER TABLE public.shipments
  ALTER COLUMN transporter_id DROP NOT NULL;

COMMIT;
