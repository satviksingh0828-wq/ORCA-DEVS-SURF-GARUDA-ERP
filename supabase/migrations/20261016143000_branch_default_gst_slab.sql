BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS default_gst_slab_id UUID;

-- The composite foreign key below prevents a branch from selecting another branch's slab.
CREATE UNIQUE INDEX IF NOT EXISTS account_gst_slabs_branch_id_id_uidx
  ON public.account_gst_slabs(branch_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.branches'::regclass
      AND conname = 'branches_default_gst_slab_same_branch_fkey'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_default_gst_slab_same_branch_fkey
      FOREIGN KEY (id, default_gst_slab_id)
      REFERENCES public.account_gst_slabs(branch_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
