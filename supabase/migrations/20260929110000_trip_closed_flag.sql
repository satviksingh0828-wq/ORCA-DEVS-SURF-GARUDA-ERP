ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS closed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS trips_closed_created_at_idx
  ON public.trips (closed, created_at DESC);
