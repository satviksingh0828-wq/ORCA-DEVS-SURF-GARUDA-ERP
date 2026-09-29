BEGIN;

-- One immutable outward POD record per consignment.
CREATE TABLE IF NOT EXISTS public.outward_pods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID NOT NULL UNIQUE REFERENCES public.consignments(id) ON DELETE RESTRICT,
  delivery_date DATE NOT NULL,
  transporter_lr_number TEXT,
  transporter_lr_date DATE,
  front_copy_path TEXT NOT NULL,
  back_copy_path TEXT NOT NULL,
  signature_copy_path TEXT NOT NULL,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outward_pods_delivery_date_check CHECK (delivery_date IS NOT NULL),
  CONSTRAINT outward_pods_third_party_lr_check CHECK (
    transporter_lr_number IS NULL OR nullif(trim(transporter_lr_number), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS outward_pods_created_at_idx
  ON public.outward_pods(created_at DESC);
CREATE INDEX IF NOT EXISTS outward_pods_consignment_idx
  ON public.outward_pods(consignment_id);

GRANT SELECT, INSERT ON public.outward_pods TO anon, authenticated;
GRANT ALL ON public.outward_pods TO service_role;
ALTER TABLE public.outward_pods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app can read outward pods" ON public.outward_pods;
CREATE POLICY "app can read outward pods"
  ON public.outward_pods FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "app can create outward pods" ON public.outward_pods;
CREATE POLICY "app can create outward pods"
  ON public.outward_pods FOR INSERT TO anon, authenticated WITH CHECK (true);

-- POD files stay private and are opened through short-lived signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'outward-pod-documents',
  'outward-pod-documents',
  false,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "Authenticated users can read outward POD documents" ON storage.objects;
CREATE POLICY "Authenticated users can read outward POD documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'outward-pod-documents');
DROP POLICY IF EXISTS "Authenticated users can upload outward POD documents" ON storage.objects;
CREATE POLICY "Authenticated users can upload outward POD documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'outward-pod-documents');
DROP POLICY IF EXISTS "Authenticated users can delete outward POD documents" ON storage.objects;
CREATE POLICY "Authenticated users can delete outward POD documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'outward-pod-documents');

-- Once inserted, the POD cannot be edited or deleted through the database API.
REVOKE UPDATE, DELETE ON public.outward_pods FROM anon, authenticated;

COMMIT;
