BEGIN;

-- The generator creates the bill first and links the posted journal afterward.
-- journal_entry_id must therefore be mutable by the trusted posting function;
-- all user-editable bill identity, source, dates and totals remain immutable.
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

COMMIT;
