BEGIN;

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS gst_slab_id UUID;

-- Make the branch/slab pair referenceable by a composite foreign key.
CREATE UNIQUE INDEX IF NOT EXISTS account_gst_slabs_branch_id_id_uidx
  ON public.account_gst_slabs(branch_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.consignments'::regclass
      AND conname = 'consignments_gst_slab_same_branch_fkey'
  ) THEN
    ALTER TABLE public.consignments
      ADD CONSTRAINT consignments_gst_slab_same_branch_fkey
      FOREIGN KEY (branch_id, gst_slab_id)
      REFERENCES public.account_gst_slabs(branch_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
