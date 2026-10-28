-- Add the same Additional Income mode used by Stock Inward.
ALTER TABLE public.stock_outward_receipts
  ADD COLUMN IF NOT EXISTS additional_income_mode TEXT NOT NULL DEFAULT 'none';

-- Preserve the meaning of existing Stock Outward rows when introducing the mode.
UPDATE public.stock_outward_receipts
SET additional_income_mode = CASE
  WHEN coalesce(source_income_amount, 0) > 0 AND coalesce(approval_amount, 0) > 0 THEN 'both'
  WHEN coalesce(source_income_amount, 0) > 0 THEN 'source'
  WHEN coalesce(approval_amount, 0) > 0 THEN 'approval'
  ELSE 'none'
END
WHERE additional_income_mode = 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_outward_receipts_additional_income_mode_check'
      AND conrelid = 'public.stock_outward_receipts'::regclass
  ) THEN
    ALTER TABLE public.stock_outward_receipts
      ADD CONSTRAINT stock_outward_receipts_additional_income_mode_check
      CHECK (additional_income_mode IN ('approval', 'source', 'both', 'none'));
  END IF;
END $$;
