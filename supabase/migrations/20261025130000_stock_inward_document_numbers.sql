BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_inward_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.stock_inward_receipts(id) ON DELETE CASCADE,
  document_no TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_inward_documents_no_check CHECK (length(trim(document_no)) > 0),
  CONSTRAINT stock_inward_documents_unique UNIQUE (receipt_id, document_no)
);

ALTER TABLE public.stock_inward_packages
  ADD COLUMN IF NOT EXISTS inward_document_id UUID
    REFERENCES public.stock_inward_documents(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS stock_inward_documents_receipt_idx
  ON public.stock_inward_documents(receipt_id);
CREATE INDEX IF NOT EXISTS stock_inward_packages_document_idx
  ON public.stock_inward_packages(inward_document_id);

CREATE OR REPLACE FUNCTION public.validate_stock_inward_package_document()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.inward_document_id IS NULL THEN
    RAISE EXCEPTION 'Each Stock Inward package must have an Inward Document No.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.stock_inward_documents d
    WHERE d.id = NEW.inward_document_id
      AND d.receipt_id = NEW.receipt_id
  ) THEN
    RAISE EXCEPTION 'Package Inward Document No. must belong to the same Stock Inward receipt';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_inward_package_document_validate
  ON public.stock_inward_packages;
CREATE TRIGGER stock_inward_package_document_validate
BEFORE INSERT OR UPDATE ON public.stock_inward_packages
FOR EACH ROW EXECUTE FUNCTION public.validate_stock_inward_package_document();

ALTER TABLE public.stock_inward_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_inward_documents_app ON public.stock_inward_documents;
CREATE POLICY stock_inward_documents_app
  ON public.stock_inward_documents
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_inward_documents TO anon, authenticated;
GRANT ALL ON public.stock_inward_documents TO service_role;

COMMIT;
