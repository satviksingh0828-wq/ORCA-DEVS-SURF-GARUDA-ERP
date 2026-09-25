BEGIN;

-- Backfill older Consignment-generated Shipments whose header total was stored
-- as zero while the goods rows already contained the invoice/taxable amount.
WITH item_totals AS (
  SELECT
    shipment_id,
    SUM(COALESCE(total_invoice_value, 0)) AS invoice_total,
    SUM(COALESCE(taxable_value, 0)) AS taxable_total
  FROM public.shipment_items
  GROUP BY shipment_id
)
UPDATE public.shipments AS s
SET
  total_invoice_value = CASE
    WHEN COALESCE(s.total_invoice_value, 0) = 0 AND item_totals.invoice_total > 0
      THEN item_totals.invoice_total
    ELSE s.total_invoice_value
  END,
  total_taxable_value = CASE
    WHEN COALESCE(s.total_taxable_value, 0) = 0 AND item_totals.taxable_total > 0
      THEN item_totals.taxable_total
    ELSE s.total_taxable_value
  END
FROM item_totals
WHERE item_totals.shipment_id = s.id;

COMMIT;
