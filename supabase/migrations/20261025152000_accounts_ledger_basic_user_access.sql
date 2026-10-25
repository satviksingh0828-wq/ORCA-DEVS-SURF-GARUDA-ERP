BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_basic_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_account_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE CASCADE,
  basic_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_basic_user_access_unique UNIQUE (ledger_account_id, basic_user_id)
);

CREATE INDEX IF NOT EXISTS ledger_basic_user_access_user_idx
  ON public.ledger_basic_user_access(basic_user_id, ledger_account_id);
CREATE INDEX IF NOT EXISTS ledger_basic_user_access_ledger_idx
  ON public.ledger_basic_user_access(ledger_account_id, basic_user_id);

CREATE OR REPLACE FUNCTION public.validate_ledger_basic_user_access()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE id = NEW.basic_user_id
      AND role = 'basic'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active Basic users can be assigned to a ledger';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_basic_user_access_validate
  ON public.ledger_basic_user_access;
CREATE TRIGGER ledger_basic_user_access_validate
BEFORE INSERT OR UPDATE ON public.ledger_basic_user_access
FOR EACH ROW EXECUTE FUNCTION public.validate_ledger_basic_user_access();

ALTER TABLE public.ledger_basic_user_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_basic_user_access_app ON public.ledger_basic_user_access;
CREATE POLICY ledger_basic_user_access_app
  ON public.ledger_basic_user_access
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_basic_user_access TO anon, authenticated;
GRANT ALL ON public.ledger_basic_user_access TO service_role;

COMMIT;
