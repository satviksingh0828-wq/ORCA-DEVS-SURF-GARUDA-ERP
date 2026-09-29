BEGIN;

-- A POD may contain Front, Back, Signature, or any combination, but at least one copy is required.
ALTER TABLE public.outward_pods
  ALTER COLUMN front_copy_path DROP NOT NULL,
  ALTER COLUMN back_copy_path DROP NOT NULL,
  ALTER COLUMN signature_copy_path DROP NOT NULL;

ALTER TABLE public.outward_pods
  DROP CONSTRAINT IF EXISTS outward_pods_at_least_one_document_check;

ALTER TABLE public.outward_pods
  ADD CONSTRAINT outward_pods_at_least_one_document_check CHECK (
    num_nonnulls(front_copy_path, back_copy_path, signature_copy_path) >= 1
  );

COMMIT;
