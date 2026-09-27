BEGIN;

UPDATE public.consignment_package_information
SET quantity = COALESCE(quantity, 0),
    weight_kg = COALESCE(weight_kg, 0);
ALTER TABLE public.consignment_package_information
  ALTER COLUMN quantity SET DEFAULT 0,
  ALTER COLUMN quantity SET NOT NULL,
  ALTER COLUMN weight_kg SET DEFAULT 0,
  ALTER COLUMN weight_kg SET NOT NULL;
ALTER TABLE public.consignment_package_information
  DROP CONSTRAINT IF EXISTS consignment_package_one_measurement;
ALTER TABLE public.consignment_package_information
  ADD CONSTRAINT consignment_package_both_measurements_check
  CHECK (quantity >= 0 AND weight_kg >= 0);

COMMIT;
