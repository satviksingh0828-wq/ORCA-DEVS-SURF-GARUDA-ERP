-- Add only the new Manifest Date field to the existing standard Manifest table.
ALTER TABLE public.delivery_manifests
  ADD COLUMN IF NOT EXISTS manifest_date date;
