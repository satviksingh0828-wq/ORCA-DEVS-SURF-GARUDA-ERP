BEGIN;

-- Generated bill fields remain immutable. The journal link is maintained by
-- trusted posting/cleanup operations, while deleted_at/deleted_by are the
-- only user-visible mutation allowed by the soft-delete workflow.
CREATE OR REPLACE FUNCTION public.prevent_ltms_transporter_bill_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.system_number IS DISTINCT FROM OLD.system_number
     OR NEW.system_date IS DISTINCT FROM OLD.system_date
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.transporter_id IS DISTINCT FROM OLD.transporter_id
     OR NEW.transporter_source_id IS DISTINCT FROM OLD.transporter_source_id
     OR NEW.transporter_bill_number IS DISTINCT FROM OLD.transporter_bill_number
     OR NEW.transporter_bill_date IS DISTINCT FROM OLD.transporter_bill_date
     OR NEW.period_from IS DISTINCT FROM OLD.period_from
     OR NEW.period_to IS DISTINCT FROM OLD.period_to
     OR NEW.total_freight IS DISTINCT FROM OLD.total_freight
     OR NEW.total_loading IS DISTINCT FROM OLD.total_loading
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Generated transporter bills are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_ltms_transporter_bill_mutation ON public.ltms_transporter_bills;
CREATE TRIGGER prevent_ltms_transporter_bill_mutation
  BEFORE UPDATE ON public.ltms_transporter_bills
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ltms_transporter_bill_mutation();

CREATE OR REPLACE FUNCTION public.soft_delete_ltms_transporter_bill(
  p_bill_id UUID,
  p_deleted_by UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal UUID;
BEGIN
  SELECT journal_entry_id
  INTO v_journal
  FROM public.ltms_transporter_bills
  WHERE id = p_bill_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transporter bill was not found or already deleted';
  END IF;

  -- Delete the posted voucher first. The FK cleanup sets journal_entry_id to
  -- NULL, which is allowed because it is internal journal cleanup, not a bill
  -- value edit.
  IF v_journal IS NOT NULL THEN
    DELETE FROM public.journal_entries
    WHERE id = v_journal OR reference = 'ltms_transporter_bill:' || p_bill_id;
  END IF;

  -- Do not explicitly update journal_entry_id here; ON DELETE SET NULL has
  -- already cleared it. This update changes only the soft-delete audit fields.
  UPDATE public.ltms_transporter_bills
  SET deleted_at = now(),
      deleted_by = coalesce(p_deleted_by, deleted_by)
  WHERE id = p_bill_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transporter bill was not found or already deleted';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_ltms_transporter_bill(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_ltms_transporter_bill(UUID, UUID) TO anon, authenticated, service_role;

COMMIT;
