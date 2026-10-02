BEGIN;

-- The generation RPC inserts a bill with zero totals, then writes the final
-- freight/loading totals after inserting all selected items. Permit only that
-- internal zero-to-final-total transition; all bill header fields remain locked.
CREATE OR REPLACE FUNCTION public.prevent_source_bill_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.bill_number IS DISTINCT FROM OLD.bill_number
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.bill_date IS DISTINCT FROM OLD.bill_date
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.period_from IS DISTINCT FROM OLD.period_from
     OR NEW.period_to IS DISTINCT FROM OLD.period_to
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
    RAISE EXCEPTION 'Generated source bills are immutable';
  END IF;

  -- generate_ltms_source_bill creates the row with both totals at zero and
  -- updates them exactly once after all bill items are inserted.
  IF OLD.total_freight <> 0
     OR OLD.total_loading <> 0
     OR NEW.total_freight < 0
     OR NEW.total_loading < 0 THEN
    IF NEW.total_freight IS DISTINCT FROM OLD.total_freight
       OR NEW.total_loading IS DISTINCT FROM OLD.total_loading THEN
      RAISE EXCEPTION 'Generated source bills are immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
