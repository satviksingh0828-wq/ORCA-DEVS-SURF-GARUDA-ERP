BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS wms_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wms_warehouse_id INTEGER;

ALTER TABLE public.stock_inward_packages
  ADD COLUMN IF NOT EXISTS wms_item_id INTEGER,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS item_name TEXT;

ALTER TABLE public.stock_inward_receipts
  ADD COLUMN IF NOT EXISTS wms_purchase_order_id INTEGER,
  ADD COLUMN IF NOT EXISTS wms_purchase_order_number TEXT;

CREATE INDEX IF NOT EXISTS branches_wms_warehouse_idx
  ON public.branches(wms_warehouse_id)
  WHERE wms_enabled = true;

CREATE INDEX IF NOT EXISTS stock_inward_packages_sku_idx
  ON public.stock_inward_packages(sku);

CREATE UNIQUE INDEX IF NOT EXISTS stock_inward_receipts_wms_po_uidx
  ON public.stock_inward_receipts(wms_purchase_order_id)
  WHERE wms_purchase_order_id IS NOT NULL;

ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_wms_configuration_check;
ALTER TABLE public.branches
  ADD CONSTRAINT branches_wms_configuration_check CHECK (
    (wms_enabled = false AND wms_warehouse_id IS NULL)
    OR (wms_enabled = true AND wms_warehouse_id IS NOT NULL)
  );

COMMENT ON COLUMN public.branches.wms_warehouse_id IS
  'WMS warehouse ID. Multiple ERP branches may intentionally share one warehouse.';
COMMENT ON COLUMN public.stock_inward_packages.sku IS
  'WMS SKU snapshot captured when the Stock Inward package line is created.';
COMMENT ON COLUMN public.stock_inward_packages.item_name IS
  'WMS item-name snapshot captured from the validated SKU.';
COMMENT ON COLUMN public.stock_inward_receipts.wms_purchase_order_id IS
  'WMS Purchase Order created from this Stock Inward receipt.';

COMMIT;
