BEGIN;

-- Recover the trip lock for Part-B updates that were completed before the trip
-- lock write or before the lock migration was applied.
UPDATE public.trips t
SET part_b_locked_at = source.latest_part_b,
    part_b_locked_by = NULL
FROM (
  SELECT trip_id, max(part_b_updated_at) AS latest_part_b
  FROM public.consignments
  WHERE trip_id IS NOT NULL
    AND part_b_updated_at IS NOT NULL
  GROUP BY trip_id
) source
WHERE t.id = source.trip_id
  AND t.part_b_locked_at IS NULL;

COMMIT;
