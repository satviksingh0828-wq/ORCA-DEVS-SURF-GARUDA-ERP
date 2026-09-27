BEGIN;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS part_b_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS part_b_locked_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL;

ALTER TABLE public.consignments
  ADD COLUMN IF NOT EXISTS part_b_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS part_b_vehicle_no TEXT,
  ADD COLUMN IF NOT EXISTS part_b_from_pin_code TEXT,
  ADD COLUMN IF NOT EXISTS part_b_from_state INTEGER,
  ADD COLUMN IF NOT EXISTS part_b_from_place TEXT,
  ADD COLUMN IF NOT EXISTS part_b_transport_mode TEXT,
  ADD COLUMN IF NOT EXISTS part_b_vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS part_b_trans_doc_no TEXT,
  ADD COLUMN IF NOT EXISTS part_b_trans_doc_date DATE,
  ADD COLUMN IF NOT EXISTS part_b_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS part_b_reason_rem TEXT,
  ADD COLUMN IF NOT EXISTS part_b_updated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS part_b_updated_at TIMESTAMPTZ;

ALTER TABLE public.shipment_part_b_history
  ADD COLUMN IF NOT EXISTS consignment_id UUID REFERENCES public.consignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS from_pin_code TEXT,
  ADD COLUMN IF NOT EXISTS from_state_name TEXT;

CREATE INDEX IF NOT EXISTS consignments_part_b_updated_idx
  ON public.consignments(part_b_updated_at) WHERE part_b_updated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_part_b_locked_idx
  ON public.trips(part_b_locked_at) WHERE part_b_locked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipment_part_b_history_consignment_idx
  ON public.shipment_part_b_history(consignment_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_locked_trip_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.part_b_locked_at IS NOT NULL THEN
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
      RAISE EXCEPTION 'Branch and vehicle cannot be changed after Part-B update for trip %', OLD.trip_code
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_locked_trip_update ON public.trips;
CREATE TRIGGER trg_prevent_locked_trip_update
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_trip_update();

CREATE OR REPLACE FUNCTION public.prevent_locked_trip_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.part_b_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Trip % cannot be deleted after Part-B update', OLD.trip_code
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_locked_trip_delete ON public.trips;
CREATE TRIGGER trg_prevent_locked_trip_delete
  BEFORE DELETE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_trip_delete();

CREATE OR REPLACE FUNCTION public.prevent_locked_trip_movement_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT part_b_locked_at INTO locked_at FROM public.trips WHERE id = OLD.trip_id;
  ELSE
    SELECT part_b_locked_at INTO locked_at FROM public.trips WHERE id = OLD.trip_id;
    IF locked_at IS NULL AND NEW.trip_id IS DISTINCT FROM OLD.trip_id AND NEW.trip_id IS NOT NULL THEN
      SELECT part_b_locked_at INTO locked_at FROM public.trips WHERE id = NEW.trip_id;
    END IF;
  END IF;
  IF locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Movement cannot be unlinked or changed after Part-B update'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_locked_trip_movement_change ON public.consignments;
CREATE TRIGGER trg_prevent_locked_trip_movement_change
  BEFORE UPDATE OF trip_id OR DELETE ON public.consignments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_trip_movement_change();

COMMIT;
