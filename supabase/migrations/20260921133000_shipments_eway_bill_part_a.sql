BEGIN;

CREATE TABLE IF NOT EXISTS public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  eway_bill_number TEXT NOT NULL CHECK (eway_bill_number ~ '^[0-9]{12}$'),
  eway_bill_date DATE NOT NULL,
  eway_bill_status TEXT NOT NULL DEFAULT 'Active',
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  supply_type TEXT NOT NULL CHECK (supply_type IN ('Outward', 'Inward')),
  sub_type TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_number TEXT NOT NULL,
  document_date DATE NOT NULL,
  supplier_gstin TEXT NOT NULL DEFAULT 'URP',
  supplier_trade_name TEXT NOT NULL DEFAULT '',
  supplier_legal_name TEXT NOT NULL DEFAULT '',
  supplier_address TEXT NOT NULL DEFAULT '',
  supplier_place TEXT NOT NULL DEFAULT '',
  supplier_state TEXT NOT NULL DEFAULT '',
  supplier_pin_code TEXT NOT NULL DEFAULT '',
  recipient_gstin TEXT NOT NULL DEFAULT 'URP',
  recipient_trade_name TEXT NOT NULL DEFAULT '',
  recipient_legal_name TEXT NOT NULL DEFAULT '',
  recipient_address TEXT NOT NULL DEFAULT '',
  recipient_place TEXT NOT NULL DEFAULT '',
  recipient_state TEXT NOT NULL DEFAULT '',
  recipient_pin_code TEXT NOT NULL DEFAULT '',
  dispatch_from_address TEXT NOT NULL DEFAULT '',
  dispatch_from_place TEXT NOT NULL DEFAULT '',
  dispatch_from_state TEXT NOT NULL DEFAULT '',
  dispatch_from_pin_code TEXT NOT NULL DEFAULT '',
  ship_to_address TEXT NOT NULL DEFAULT '',
  ship_to_place TEXT NOT NULL DEFAULT '',
  ship_to_state TEXT NOT NULL DEFAULT '',
  ship_to_pin_code TEXT NOT NULL DEFAULT '',
  transporter_id TEXT NOT NULL DEFAULT '',
  approximate_distance_km NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (approximate_distance_km >= 0),
  total_taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_invoice_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipments_eway_bill_number_unique ON public.shipments(eway_bill_number);
CREATE INDEX IF NOT EXISTS shipments_branch_date_idx ON public.shipments(branch_id, eway_bill_date DESC);

CREATE TABLE IF NOT EXISTS public.shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  item_no INTEGER NOT NULL,
  description TEXT NOT NULL,
  hsn_code TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'NOS',
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_utgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_tax_charges NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_invoice_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, item_no)
);

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.shipments TO anon, authenticated;
GRANT SELECT, INSERT ON public.shipment_items TO anon, authenticated;
GRANT ALL ON public.shipments TO service_role;
GRANT ALL ON public.shipment_items TO service_role;

COMMIT;
