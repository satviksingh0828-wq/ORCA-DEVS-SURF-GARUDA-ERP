BEGIN;

ALTER TABLE public.stock_inward_packages
  DROP CONSTRAINT IF EXISTS stock_inward_package_measurement;

ALTER TABLE public.stock_inward_packages
  ADD CONSTRAINT stock_inward_package_both_measurements CHECK (
    quantity IS NOT NULL AND quantity > 0
    AND weight_kg IS NOT NULL AND weight_kg > 0
  );

COMMIT;
