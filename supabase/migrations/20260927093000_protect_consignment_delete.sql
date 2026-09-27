-- Protect consignments that are already operationally committed.
-- Run this migration in Supabase before relying on the UI delete guard.

CREATE OR REPLACE FUNCTION public.prevent_protected_consignment_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.trip_id IS NOT NULL THEN
    RAISE EXCEPTION 'Consignment % is assigned to a Trip and cannot be deleted', OLD.consignment_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF COALESCE(OLD.transporter_update_status, 'pending') IN ('partial', 'updated') THEN
    RAISE EXCEPTION 'Consignment % has a transporter update and cannot be deleted', OLD.consignment_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_consignment_delete ON public.consignments;
CREATE TRIGGER protect_consignment_delete
  BEFORE DELETE ON public.consignments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_protected_consignment_delete();
