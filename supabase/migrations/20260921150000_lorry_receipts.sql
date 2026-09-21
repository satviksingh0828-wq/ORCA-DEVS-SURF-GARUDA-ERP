BEGIN;

CREATE TABLE IF NOT EXISTS public.lorry_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  lr_number TEXT NOT NULL CHECK (lr_number ~ '^[0-9]{10}$'),
  source_id UUID REFERENCES public.contracts(id) ON DELETE RESTRICT,
  base_shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lr_number),
  UNIQUE (base_shipment_id)
);

CREATE OR REPLACE FUNCTION public.generate_lr_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
    IF NOT EXISTS (SELECT 1 FROM public.lorry_receipts WHERE lr_number = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.lorry_receipts
  ALTER COLUMN lr_number SET DEFAULT public.generate_lr_number();

CREATE TABLE IF NOT EXISTS public.lr_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lr_id UUID NOT NULL REFERENCES public.lorry_receipts(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lr_id, shipment_id),
  UNIQUE (shipment_id)
);

CREATE INDEX IF NOT EXISTS lorry_receipts_branch_created_idx
  ON public.lorry_receipts(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lr_shipments_shipment_idx
  ON public.lr_shipments(shipment_id);

CREATE OR REPLACE FUNCTION public.validate_lr_shipment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lr_row public.lorry_receipts%ROWTYPE;
  base_row public.shipments%ROWTYPE;
  next_row public.shipments%ROWTYPE;
BEGIN
  SELECT * INTO lr_row FROM public.lorry_receipts WHERE id = NEW.lr_id;
  SELECT * INTO base_row FROM public.shipments WHERE id = lr_row.base_shipment_id;
  SELECT * INTO next_row FROM public.shipments WHERE id = NEW.shipment_id;
  IF base_row.id IS NULL OR next_row.id IS NULL THEN
    RAISE EXCEPTION 'The LR base or selected shipment no longer exists';
  END IF;
  IF lr_row.branch_id <> next_row.branch_id
     OR base_row.branch_id <> next_row.branch_id
     OR upper(coalesce(base_row.supplier_gstin, '')) <> upper(coalesce(next_row.supplier_gstin, ''))
     OR upper(coalesce(base_row.recipient_gstin, '')) <> upper(coalesce(next_row.recipient_gstin, ''))
     OR coalesce(base_row.dispatch_from_pin_code, '') <> coalesce(next_row.dispatch_from_pin_code, '')
     OR coalesce(base_row.ship_to_pin_code, '') <> coalesce(next_row.ship_to_pin_code, '') THEN
    RAISE EXCEPTION 'Shipment must match the LR branch, consignor GSTIN, consignee GSTIN, dispatch PIN and ship-to PIN';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_lr_shipment ON public.lr_shipments;
CREATE TRIGGER trg_validate_lr_shipment
  BEFORE INSERT OR UPDATE ON public.lr_shipments
  FOR EACH ROW EXECUTE FUNCTION public.validate_lr_shipment();

ALTER TABLE public.lorry_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lr_shipments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.lorry_receipts TO anon, authenticated;
GRANT SELECT, INSERT ON public.lr_shipments TO anon, authenticated;
GRANT ALL ON public.lorry_receipts TO service_role;
GRANT ALL ON public.lr_shipments TO service_role;

COMMIT;

-- Shipment rows can display the LR number through:
-- lr_shipments(shipment_id) -> lorry_receipts(lr_id).lr_number
-- A shipment can belong to at most one LR because shipment_id is unique above.
