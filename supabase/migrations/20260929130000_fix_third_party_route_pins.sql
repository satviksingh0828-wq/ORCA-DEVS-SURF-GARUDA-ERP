BEGIN;

-- LTMS third-party routes start at the selected branch. Drop routes end at
-- the selected transporter; pickup routes have no destination PIN.
UPDATE public.consignments c
SET
  from_pin_code = NULLIF(
    BTRIM((SELECT b.pin_code FROM public.branches b WHERE b.id = c.branch_id)),
    ''
  ),
  to_pin_code = CASE
    WHEN c.movement_mode = 'drop' THEN NULLIF(
      BTRIM((SELECT t.pin_code FROM public.ltms_transporters t WHERE t.id = c.transporter_id)),
      ''
    )
    ELSE NULL
  END
WHERE c.consignment_type = 'third_party';

COMMIT;
