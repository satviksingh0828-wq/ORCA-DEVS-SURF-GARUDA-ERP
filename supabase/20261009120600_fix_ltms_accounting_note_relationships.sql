BEGIN;

-- ltms_accounting_notes has two foreign keys to ltms_billing_parties. Keep
-- stable names so PostgREST can resolve the main party relationship explicitly.
ALTER TABLE public.ltms_accounting_notes
  DROP CONSTRAINT IF EXISTS ltms_accounting_notes_party_id_fkey,
  DROP CONSTRAINT IF EXISTS ltms_accounting_notes_offset_party_id_fkey;

ALTER TABLE public.ltms_accounting_notes
  ADD CONSTRAINT ltms_accounting_notes_party_id_fkey
    FOREIGN KEY (party_id) REFERENCES public.ltms_billing_parties(id) ON DELETE RESTRICT,
  ADD CONSTRAINT ltms_accounting_notes_offset_party_id_fkey
    FOREIGN KEY (offset_party_id) REFERENCES public.ltms_billing_parties(id) ON DELETE RESTRICT;

-- Ask PostgREST to reload its relationship cache after the FK changes.
NOTIFY pgrst, 'reload schema';

COMMIT;
