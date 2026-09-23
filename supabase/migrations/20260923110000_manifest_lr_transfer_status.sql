BEGIN;

ALTER TABLE public.delivery_manifest_lorry_receipts
  ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (transfer_status IN ('pending', 'transferred', 'failed')),
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transfer_error TEXT;

CREATE INDEX IF NOT EXISTS delivery_manifest_lorry_receipts_transfer_status_idx
  ON public.delivery_manifest_lorry_receipts (transfer_status);

COMMIT;

-- Transfer status is tracked separately for every LR linked to a Manifest.
-- A Manifest is considered transferred only when every linked LR is transferred.
