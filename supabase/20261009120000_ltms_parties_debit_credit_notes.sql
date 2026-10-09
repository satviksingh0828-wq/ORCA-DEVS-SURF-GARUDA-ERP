BEGIN;

CREATE TABLE IF NOT EXISTS public.ltms_billing_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  party_name TEXT,
  gstin TEXT,
  party_type TEXT NOT NULL CHECK (party_type IN ('debtor','creditor')),
  ledger_account_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ltms_billing_parties_branch_idx ON public.ltms_billing_parties(branch_id, party_type);
CREATE UNIQUE INDEX IF NOT EXISTS ltms_billing_parties_account_uidx ON public.ltms_billing_parties(ledger_account_id);

CREATE TABLE IF NOT EXISTS public.ltms_accounting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_number TEXT NOT NULL UNIQUE,
  note_type TEXT NOT NULL CHECK (note_type IN ('debit','credit')),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  party_id UUID NOT NULL REFERENCES public.ltms_billing_parties(id) ON DELETE RESTRICT,
  note_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  offset_party_id UUID REFERENCES public.ltms_billing_parties(id) ON DELETE RESTRICT,
  offset_ledger_id UUID REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  settlement_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  settled_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0 AND settled_amount <= amount),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((offset_party_id IS NOT NULL) <> (offset_ledger_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ltms_accounting_notes_filter_idx ON public.ltms_accounting_notes(note_type, branch_id, note_date DESC, status);

ALTER TABLE public.ltms_billing_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ltms_accounting_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ltms_billing_parties_app ON public.ltms_billing_parties;
DROP POLICY IF EXISTS ltms_accounting_notes_app ON public.ltms_accounting_notes;
CREATE POLICY ltms_billing_parties_app ON public.ltms_billing_parties FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY ltms_accounting_notes_app ON public.ltms_accounting_notes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ltms_billing_parties, public.ltms_accounting_notes TO anon, authenticated;

DROP VIEW IF EXISTS public.ltms_billing_parties_summary;
CREATE VIEW public.ltms_billing_parties_summary AS
SELECT p.id, p.branch_id, p.party_name, p.gstin, p.party_type, p.ledger_account_id,
       b.branch_name,
       COALESCE(SUM(jl.debit), 0)::NUMERIC(14,2) AS total_debit,
       COALESCE(SUM(jl.credit), 0)::NUMERIC(14,2) AS total_credit,
       (COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0))::NUMERIC(14,2) AS balance
FROM public.ltms_billing_parties p
LEFT JOIN public.branches b ON b.id = p.branch_id
LEFT JOIN public.journal_lines jl ON jl.ledger_account_id = p.ledger_account_id AND jl.branch_id = p.branch_id
WHERE p.is_active
GROUP BY p.id, b.branch_name;
GRANT SELECT ON public.ltms_billing_parties_summary TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_ltms_billing_party(
  p_branch_id UUID, p_party_name TEXT, p_gstin TEXT, p_party_type TEXT,
  p_ledger_account_id UUID, p_created_by UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_type TEXT; v_branch UUID;
BEGIN
  IF p_branch_id IS NULL OR p_party_type NOT IN ('debtor','creditor') THEN RAISE EXCEPTION 'Branch and valid party type are required'; END IF;
  IF NULLIF(trim(coalesce(p_party_name,'')), '') IS NULL THEN RAISE EXCEPTION 'Party name is required'; END IF;
  SELECT ledger_type, branch_id INTO v_type, v_branch FROM public.ledger_accounts WHERE id = p_ledger_account_id AND is_active;
  IF v_branch IS DISTINCT FROM p_branch_id OR v_type IS DISTINCT FROM CASE WHEN p_party_type = 'debtor' THEN 'asset' ELSE 'liability' END THEN
    RAISE EXCEPTION 'Party account must be an active branch % account', CASE WHEN p_party_type = 'debtor' THEN 'asset' ELSE 'liability' END;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ltms_billing_parties WHERE branch_id = p_branch_id AND lower(coalesce(party_name,'')) = lower(trim(p_party_name)) AND is_active) THEN RAISE EXCEPTION 'A party with this name already exists in the branch'; END IF;
  INSERT INTO public.ltms_billing_parties(branch_id,party_name,gstin,party_type,ledger_account_id,created_by)
  VALUES (p_branch_id,trim(p_party_name),NULLIF(trim(coalesce(p_gstin,'')),''),p_party_type,p_ledger_account_id,p_created_by) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_ltms_billing_party(UUID,TEXT,TEXT,TEXT,UUID,UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_ltms_accounting_note(
  p_note_type TEXT, p_branch_id UUID, p_party_id UUID, p_note_date DATE,
  p_amount NUMERIC, p_description TEXT DEFAULT NULL, p_offset_party_id UUID DEFAULT NULL,
  p_offset_ledger_id UUID DEFAULT NULL, p_created_by UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_note_id UUID; v_journal_id UUID; v_number TEXT; v_party_account UUID; v_offset_account UUID; v_kind TEXT; v_amount NUMERIC(14,2); v_party_branch UUID;
BEGIN
  v_amount := round(coalesce(p_amount,0),2); IF p_note_type NOT IN ('debit','credit') OR v_amount <= 0 THEN RAISE EXCEPTION 'Valid note type and positive amount are required'; END IF;
  SELECT ledger_account_id, branch_id INTO v_party_account, v_party_branch FROM public.ltms_billing_parties WHERE id = p_party_id AND is_active;
  IF v_party_account IS NULL OR v_party_branch IS DISTINCT FROM p_branch_id THEN RAISE EXCEPTION 'Party is missing or belongs to another branch'; END IF;
  IF (p_offset_party_id IS NOT NULL) = (p_offset_ledger_id IS NOT NULL) THEN RAISE EXCEPTION 'Select exactly one offset party or account'; END IF;
  IF p_offset_party_id IS NOT NULL THEN SELECT ledger_account_id INTO v_offset_account FROM public.ltms_billing_parties WHERE id = p_offset_party_id AND branch_id = p_branch_id AND is_active; IF v_offset_account IS NULL THEN RAISE EXCEPTION 'Offset party is invalid'; END IF;
  ELSE SELECT id, ledger_type INTO v_offset_account, v_kind FROM public.ledger_accounts WHERE id = p_offset_ledger_id AND branch_id = p_branch_id AND is_active AND ledger_type IN ('asset','liability','income','expenditure'); IF v_offset_account IS NULL THEN RAISE EXCEPTION 'Offset account must be an active asset, liability, income, or expenditure account from the branch'; END IF; END IF;
  v_number := upper(substr(p_note_type,1,2)) || '-' || to_char(coalesce(p_note_date,current_date),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::TEXT,'-',''),1,6));
  INSERT INTO public.ltms_accounting_notes(note_number,note_type,branch_id,party_id,note_date,amount,description,offset_party_id,offset_ledger_id,created_by)
  VALUES(v_number,p_note_type,p_branch_id,p_party_id,coalesce(p_note_date,current_date),v_amount,NULLIF(trim(coalesce(p_description,'')),''),p_offset_party_id,CASE WHEN p_offset_party_id IS NULL THEN v_offset_account END,p_created_by) RETURNING id INTO v_note_id;
  INSERT INTO public.journal_entries(entry_date,branch_id,description,reference,source_module,status,approved_at)
  VALUES(coalesce(p_note_date,current_date),p_branch_id,initcap(p_note_type)||' Note '||v_number,'ltms_accounting_note:'||v_note_id::TEXT,'ltms','approved',now()) RETURNING id INTO v_journal_id;
  IF p_note_type = 'debit' THEN
    INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit) VALUES(v_journal_id,1,p_branch_id,v_party_account,'ledger',initcap(p_note_type)||' Note - party',v_amount,0),(v_journal_id,2,p_branch_id,v_offset_account,'ledger',initcap(p_note_type)||' Note - offset',0,v_amount);
  ELSE
    INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit) VALUES(v_journal_id,1,p_branch_id,v_offset_account,'ledger',initcap(p_note_type)||' Note - offset',v_amount,0),(v_journal_id,2,p_branch_id,v_party_account,'ledger',initcap(p_note_type)||' Note - party',0,v_amount);
  END IF;
  PERFORM public.validate_journal_entry(v_journal_id);
  UPDATE public.ltms_accounting_notes SET journal_entry_id=v_journal_id WHERE id=v_note_id;
  RETURN v_note_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_ltms_accounting_note(TEXT,UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.settle_ltms_accounting_note(
  p_note_id UUID, p_settlement_ledger_id UUID, p_amount NUMERIC,
  p_settlement_date DATE DEFAULT CURRENT_DATE, p_created_by UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.ltms_accounting_notes%ROWTYPE; v_account public.ledger_accounts%ROWTYPE; v_party UUID; v_amount NUMERIC(14,2); v_journal UUID; v_payment UUID;
BEGIN
  SELECT * INTO n FROM public.ltms_accounting_notes WHERE id=p_note_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Note not found'; END IF;
  v_amount := round(coalesce(p_amount,0),2); IF v_amount <= 0 OR v_amount > round(n.amount-n.settled_amount,2) THEN RAISE EXCEPTION 'Settlement amount exceeds the note balance'; END IF;
  SELECT * INTO v_account FROM public.ledger_accounts WHERE id=p_settlement_ledger_id AND branch_id=n.branch_id AND is_active AND ledger_type IN ('income','expenditure'); IF NOT FOUND THEN RAISE EXCEPTION 'Settlement account must be an active income or expenditure account from the branch'; END IF;
  SELECT ledger_account_id INTO v_party FROM public.ltms_billing_parties WHERE id=n.party_id;
  v_payment := gen_random_uuid();
  INSERT INTO public.journal_entries(entry_date,branch_id,description,reference,source_module,status,approved_at) VALUES(coalesce(p_settlement_date,current_date),n.branch_id,initcap(n.note_type)||' Note settlement '||n.note_number,'ltms_accounting_note_settlement:'||v_payment::TEXT,'ltms','approved',now()) RETURNING id INTO v_journal;
  IF n.note_type='debit' THEN
    INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit)
    VALUES(v_journal,1,n.branch_id,v_account.id,v_account.account_kind,'Debit Note paid',v_amount,0),(v_journal,2,n.branch_id,v_party,'ledger','Debit Note party settlement',0,v_amount);
  ELSE
    INSERT INTO public.journal_lines(journal_entry_id,line_no,branch_id,ledger_account_id,account_kind,line_description,debit,credit)
    VALUES(v_journal,1,n.branch_id,v_party,'ledger','Credit Note party settlement',v_amount,0),(v_journal,2,n.branch_id,v_account.id,v_account.account_kind,'Credit Note received',0,v_amount);
  END IF;
  PERFORM public.validate_journal_entry(v_journal);
  UPDATE public.ltms_accounting_notes SET settled_amount=settled_amount+v_amount,status=CASE WHEN settled_amount+v_amount >= amount THEN 'settled' ELSE 'open' END,settlement_journal_entry_id=v_journal,updated_at=now() WHERE id=p_note_id;
  RETURN v_journal;
END; $$;
GRANT EXECUTE ON FUNCTION public.settle_ltms_accounting_note(UUID,UUID,NUMERIC,DATE,UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_ltms_accounting_note(p_note_id UUID) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n public.ltms_accounting_notes%ROWTYPE;
BEGIN
  SELECT * INTO n FROM public.ltms_accounting_notes WHERE id=p_note_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Note not found'; END IF;
  IF n.settlement_journal_entry_id IS NOT NULL THEN DELETE FROM public.journal_entries WHERE id=n.settlement_journal_entry_id; END IF;
  IF n.journal_entry_id IS NOT NULL THEN DELETE FROM public.journal_entries WHERE id=n.journal_entry_id; END IF;
  DELETE FROM public.ltms_accounting_notes WHERE id=p_note_id;
  RETURN TRUE;
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_ltms_accounting_note(UUID) TO anon, authenticated;

COMMIT;
