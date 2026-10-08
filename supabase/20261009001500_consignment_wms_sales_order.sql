BEGIN;

ALTER TABLE public.consignment_package_information
  ADD COLUMN IF NOT EXISTS wms_item_id INTEGER,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS item_name TEXT;

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS wms_sales_order_id INTEGER,
  ADD COLUMN IF NOT EXISTS wms_sales_order_number TEXT;

CREATE INDEX IF NOT EXISTS consignment_package_information_sku_idx
  ON public.consignment_package_information(sku);

CREATE UNIQUE INDEX IF NOT EXISTS consignments_wms_sales_order_uidx
  ON public.consignments(wms_sales_order_id)
  WHERE wms_sales_order_id IS NOT NULL;

COMMENT ON COLUMN public.consignment_package_information.sku IS
  'WMS SKU snapshot captured from the validated Consignment package entry.';
COMMENT ON COLUMN public.consignment_package_information.item_name IS
  'WMS item-name snapshot captured from the validated SKU.';
COMMENT ON COLUMN public.consignments.wms_sales_order_id IS
  'WMS Sales Order created from this Consignment when its branch has WMS enabled.';

COMMIT;
