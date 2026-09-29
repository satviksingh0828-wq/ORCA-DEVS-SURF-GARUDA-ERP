BEGIN;

-- The consignment form displays the first E-Way Bill's supplier and recipient
-- PINs as "Consignment From PIN" and "Consignment To PIN". Keep the dedicated
-- route columns equal to those same displayed values for report rate matching.
UPDATE public.consignments
SET
  from_pin_code = NULLIF(BTRIM(from_details->>'pincode'), ''),
  to_pin_code = NULLIF(BTRIM(to_details->>'pincode'), '')
WHERE jsonb_typeof(from_details) = 'object'
  AND jsonb_typeof(to_details) = 'object'
  AND NULLIF(BTRIM(from_details->>'pincode'), '') IS NOT NULL
  AND NULLIF(BTRIM(to_details->>'pincode'), '') IS NOT NULL;

COMMIT;
