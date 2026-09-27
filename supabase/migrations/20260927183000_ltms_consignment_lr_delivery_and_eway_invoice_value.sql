BEGIN;

-- Optional operational dates/identifiers captured when a consignment is created.
ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS transporter_lr_number TEXT,
  ADD COLUMN IF NOT EXISTS transporter_lr_date DATE,
  ADD COLUMN IF NOT EXISTS delivery_date DATE;

-- Keep the daily E-Way Bill snapshot's total invoice value queryable without
-- requiring every screen to parse raw_data JSONB.
ALTER TABLE public.eway_bill_daily_snapshots
  ADD COLUMN IF NOT EXISTS total_invoice_value NUMERIC(14,2);

UPDATE public.eway_bill_daily_snapshots
SET total_invoice_value = COALESCE(
  NULLIF(raw_data->>'totInvValue', '')::NUMERIC,
  NULLIF(raw_data->>'totalInvoiceValue', '')::NUMERIC,
  NULLIF(raw_data->>'total_invoice_value', '')::NUMERIC,
  NULLIF(raw_data->>'totalValue', '')::NUMERIC,
  0
)
WHERE total_invoice_value IS NULL;

COMMIT;
