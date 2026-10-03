BEGIN;

-- Bill generation inserts the bill first, then fills totals and journal_entry_id.
-- Bill deletion clears journal_entry_id and sets deleted_at. Those internal fields
-- must remain writable while bill identity/source/date/company fields stay immutable.
CREATE OR REPLACE FUNCTION public.prevent_ltms_source_bill_mutation()
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
     OR NEW.source_company_name IS DISTINCT FROM OLD.source_company_name
     OR NEW.source_legal_business_name IS DISTINCT FROM OLD.source_legal_business_name
     OR NEW.source_gstin IS DISTINCT FROM OLD.source_gstin
     OR NEW.source_address IS DISTINCT FROM OLD.source_address
     OR NEW.source_address_line1 IS DISTINCT FROM OLD.source_address_line1
     OR NEW.source_address_line2 IS DISTINCT FROM OLD.source_address_line2
     OR NEW.source_city IS DISTINCT FROM OLD.source_city
     OR NEW.source_state IS DISTINCT FROM OLD.source_state
     OR NEW.source_country IS DISTINCT FROM OLD.source_country
     OR NEW.source_pin_code IS DISTINCT FROM OLD.source_pin_code
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Generated source bills are immutable';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
