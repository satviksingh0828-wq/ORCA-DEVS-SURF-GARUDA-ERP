BEGIN;

-- Own movements use the E-Way Bill destination as the Consignment To PIN.
UPDATE public.consignments c
SET to_pin_code = s.ship_to_pin_code
FROM LATERAL (
  SELECT NULLIF(trim(ship_to_pin_code), '') AS ship_to_pin_code
  FROM public.shipments
  WHERE consignment_id = c.id
  ORDER BY eway_bill_date DESC NULLS LAST
  LIMIT 1
) s
WHERE c.consignment_type = 'own'
  AND NULLIF(trim(c.to_pin_code), '') IS NULL
  AND s.ship_to_pin_code IS NOT NULL;

-- Drop movements use the selected Transporter master PIN as the Consignment To PIN.
UPDATE public.consignments c
SET to_pin_code = t.pin_code
FROM public.ltms_transporters t
WHERE c.consignment_type = 'third_party'
  AND c.movement_mode = 'drop'
  AND c.transporter_id = t.id
  AND NULLIF(trim(c.to_pin_code), '') IS NULL
  AND NULLIF(trim(t.pin_code), '') IS NOT NULL;

-- The branch is the actual From location for movements created without a From PIN.
UPDATE public.consignments c
SET from_pin_code = b.pin_code
FROM public.branches b
WHERE c.branch_id = b.id
  AND NULLIF(trim(c.from_pin_code), '') IS NULL
  AND NULLIF(trim(b.pin_code), '') IS NOT NULL;

COMMIT;
