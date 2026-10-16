BEGIN;

-- Party phones are copied into shipment snapshots when a consignment is created.
-- Keep those snapshots and the consignment JSON details synchronized whenever a
-- branch-scoped consignor or consignee master phone is edited.
CREATE OR REPLACE FUNCTION public.sync_party_master_phone_to_consignment_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT := btrim(coalesce(NEW.phone_number, ''));
BEGIN
  IF NEW.party_type = 'consignor' THEN
    UPDATE public.shipments AS s
    SET supplier_phone = v_phone
    WHERE upper(coalesce(s.supplier_gstin, '')) = upper(NEW.gstin)
      AND (NEW.branch_id IS NULL OR s.branch_id = NEW.branch_id);

    UPDATE public.consignments AS c
    SET from_details = jsonb_set(
      coalesce(c.from_details, '{}'::jsonb),
      '{phone}',
      to_jsonb(v_phone),
      true
    )
    WHERE upper(coalesce(c.from_gstin, '')) = upper(NEW.gstin)
      AND (NEW.branch_id IS NULL OR c.branch_id = NEW.branch_id);
  ELSIF NEW.party_type = 'consignee' THEN
    UPDATE public.shipments AS s
    SET recipient_phone = v_phone
    WHERE upper(coalesce(s.recipient_gstin, '')) = upper(NEW.gstin)
      AND (NEW.branch_id IS NULL OR s.branch_id = NEW.branch_id);

    UPDATE public.consignments AS c
    SET to_details = jsonb_set(
      coalesce(c.to_details, '{}'::jsonb),
      '{phone}',
      to_jsonb(v_phone),
      true
    )
    WHERE upper(coalesce(c.to_gstin, '')) = upper(NEW.gstin)
      AND (NEW.branch_id IS NULL OR c.branch_id = NEW.branch_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS party_master_phone_sync ON public.party_masters;
CREATE TRIGGER party_master_phone_sync
AFTER UPDATE OF phone_number ON public.party_masters
FOR EACH ROW
WHEN (OLD.phone_number IS DISTINCT FROM NEW.phone_number)
EXECUTE FUNCTION public.sync_party_master_phone_to_consignment_records();

-- Backfill all historical shipment phone snapshots from the current master.
-- A branch-specific master wins over a legacy NULL-branch master; the newest
-- master is used if old duplicate legacy rows exist.
UPDATE public.shipments AS s
SET supplier_phone = (
  SELECT p.phone_number
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignor'
    AND upper(p.gstin) = upper(s.supplier_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = s.branch_id)
  ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignor'
    AND upper(p.gstin) = upper(s.supplier_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = s.branch_id)
)
AND s.supplier_phone IS DISTINCT FROM (
  SELECT p.phone_number
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignor'
    AND upper(p.gstin) = upper(s.supplier_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = s.branch_id)
  ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
  LIMIT 1
);

UPDATE public.shipments AS s
SET recipient_phone = (
  SELECT p.phone_number
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignee'
    AND upper(p.gstin) = upper(s.recipient_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = s.branch_id)
  ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignee'
    AND upper(p.gstin) = upper(s.recipient_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = s.branch_id)
)
AND s.recipient_phone IS DISTINCT FROM (
  SELECT p.phone_number
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignee'
    AND upper(p.gstin) = upper(s.recipient_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = s.branch_id)
  ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
  LIMIT 1
);

-- Backfill the JSON party snapshots stored on the consignment itself. The same
-- branch-specific/newest-master precedence is used as for shipments.
UPDATE public.consignments AS c
SET from_details = jsonb_set(
  coalesce(c.from_details, '{}'::jsonb),
  '{phone}',
  to_jsonb((
    SELECT p.phone_number
    FROM public.party_masters AS p
    WHERE p.party_type = 'consignor'
      AND upper(p.gstin) = upper(c.from_gstin)
      AND (p.branch_id IS NULL OR p.branch_id = c.branch_id)
    ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
    LIMIT 1
  )),
  true
)
WHERE coalesce(c.from_details->>'phone', '') IS DISTINCT FROM (
  SELECT p.phone_number
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignor'
    AND upper(p.gstin) = upper(c.from_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = c.branch_id)
  ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
  LIMIT 1
)
AND EXISTS (
  SELECT 1
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignor'
    AND upper(p.gstin) = upper(c.from_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = c.branch_id)
);

UPDATE public.consignments AS c
SET to_details = jsonb_set(
  coalesce(c.to_details, '{}'::jsonb),
  '{phone}',
  to_jsonb((
    SELECT p.phone_number
    FROM public.party_masters AS p
    WHERE p.party_type = 'consignee'
      AND upper(p.gstin) = upper(c.to_gstin)
      AND (p.branch_id IS NULL OR p.branch_id = c.branch_id)
    ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
    LIMIT 1
  )),
  true
)
WHERE coalesce(c.to_details->>'phone', '') IS DISTINCT FROM (
  SELECT p.phone_number
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignee'
    AND upper(p.gstin) = upper(c.to_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = c.branch_id)
  ORDER BY (p.branch_id IS NULL), p.updated_at DESC, p.id DESC
  LIMIT 1
)
AND EXISTS (
  SELECT 1
  FROM public.party_masters AS p
  WHERE p.party_type = 'consignee'
    AND upper(p.gstin) = upper(c.to_gstin)
    AND (p.branch_id IS NULL OR p.branch_id = c.branch_id)
);

GRANT EXECUTE ON FUNCTION public.sync_party_master_phone_to_consignment_records() TO anon, authenticated;

COMMIT;

-- Verification queries:
-- SELECT p.party_type, p.branch_id, p.gstin, p.phone_number,
--        count(s.id) AS linked_shipments
-- FROM public.party_masters p
-- LEFT JOIN public.shipments s
--   ON upper(s.supplier_gstin) = upper(p.gstin)
--  AND p.party_type = 'consignor'
--  AND (p.branch_id IS NULL OR s.branch_id = p.branch_id)
-- GROUP BY p.party_type, p.branch_id, p.gstin, p.phone_number;
--
-- SELECT c.consignment_number, c.from_gstin, c.to_gstin,
--        c.from_details->>'phone' AS consignor_phone,
--        c.to_details->>'phone' AS consignee_phone
-- FROM public.consignments c
-- ORDER BY c.created_at DESC;
