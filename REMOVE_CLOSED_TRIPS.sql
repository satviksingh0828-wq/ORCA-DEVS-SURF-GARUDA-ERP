-- Run only after confirming that closed-trip history is no longer required.
-- The corrected Close Trip action now keeps records in public.trips and sets
-- public.trips.closed = true; it does not use public.closed_trips.
-- CASCADE removes foreign keys, policies, indexes, and functions that depend
-- on the legacy archive table.
DROP TABLE IF EXISTS public.closed_trips CASCADE;
