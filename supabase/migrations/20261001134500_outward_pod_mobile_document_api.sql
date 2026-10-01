BEGIN;

-- The mobile app and web UI now access POD objects through authenticated
-- server-side endpoints. The Supabase anon key must not expose the POD files.
ALTER TABLE public.outward_pods
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.outward_pods.updated_at IS 'Last time an Outward POD document or its metadata was changed.';
COMMENT ON COLUMN public.outward_pods.updated_by IS 'ERP user who last changed an Outward POD document.';

-- Keep existing list/detail reads for the custom ERP session UI, but route
-- creation and document changes through the server API using a verified session.
REVOKE INSERT, UPDATE, DELETE ON public.outward_pods FROM anon, authenticated;
GRANT SELECT ON public.outward_pods TO anon, authenticated;
DROP POLICY IF EXISTS "app can create outward pods" ON public.outward_pods;
DROP POLICY IF EXISTS "app can update outward pods" ON public.outward_pods;
DROP POLICY IF EXISTS "app can delete outward pods" ON public.outward_pods;

-- Remove the historic public/anon Storage access policies. Only the server
-- service-role API streams, signs, adds or replaces files in this private bucket.
DROP POLICY IF EXISTS "Authenticated users can read outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "App can read outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "App can upload outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "App can delete outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "Service role manages outward POD documents" ON storage.objects;

CREATE POLICY "Service role manages outward POD documents"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'outward-pod-documents')
  WITH CHECK (bucket_id = 'outward-pod-documents');

-- Allow the web Outward POD screen to refresh when a mobile scan changes a file.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'outward_pods'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.outward_pods;
  END IF;
END;
$$;

COMMIT;
