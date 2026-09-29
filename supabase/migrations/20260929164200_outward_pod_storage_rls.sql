BEGIN;

-- The app uses Supabase's anon client key together with its own application login.
-- Allow that client role to upload and read private POD objects; signed URLs are
-- still used by the UI for document viewing and downloading.
DROP POLICY IF EXISTS "Authenticated users can read outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "App can read outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "App can upload outward POD documents" ON storage.objects;
DROP POLICY IF EXISTS "App can delete outward POD documents" ON storage.objects;

CREATE POLICY "App can read outward POD documents"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'outward-pod-documents');

CREATE POLICY "App can upload outward POD documents"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (bucket_id = 'outward-pod-documents');

CREATE POLICY "App can delete outward POD documents"
  ON storage.objects FOR DELETE TO public
  USING (bucket_id = 'outward-pod-documents');

COMMIT;
