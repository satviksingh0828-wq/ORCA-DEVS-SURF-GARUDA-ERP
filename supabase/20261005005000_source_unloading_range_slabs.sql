BEGIN;

ALTER TABLE public.source_unloading_charge_slabs
  ALTER COLUMN package_type DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS from_value NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS to_value NUMERIC(14,3);

UPDATE public.source_unloading_charge_slabs
SET from_value = COALESCE(from_value, 0)
WHERE from_value IS NULL;

ALTER TABLE public.source_unloading_charge_slabs
  ALTER COLUMN from_value SET NOT NULL;

ALTER TABLE public.source_unloading_charge_slabs
  DROP CONSTRAINT IF EXISTS source_unloading_package_type_check,
  DROP CONSTRAINT IF EXISTS source_unloading_unique_package_basis,
  ADD CONSTRAINT source_unloading_range_check
    CHECK (to_value IS NULL OR to_value >= from_value),
  ADD CONSTRAINT source_unloading_amount_check
    CHECK (amount >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS source_unloading_charge_slabs_range_uidx
  ON public.source_unloading_charge_slabs(contract_id, basis, from_value, COALESCE(to_value, -1));

COMMIT;
