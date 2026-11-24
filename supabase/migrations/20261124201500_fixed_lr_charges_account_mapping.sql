-- Fixed LR Charges account mapping.
-- Run in Supabase SQL Editor before using Settings > LTMS Accounts Map.
-- New LTMS branch mapping rows automatically receive an expenditure ledger.
-- Existing mappings are backfilled only if their field is not already set.
-- No journal entries, invoices or payments are created by this migration.
BEGIN;

ALTER TABLE public.tms_account_ledger_mappings
  ADD COLUMN IF NOT EXISTS fixed_lr_charges_ledger_id UUID
  REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.ensure_ltms_fixed_lr_charges_mapping(p_branch_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger_id UUID;
  v_ledger_type TEXT;
  v_is_active BOOLEAN;
BEGIN
  IF p_branch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Cannot create Fixed LR Charges ledger for an unknown branch';
  END IF;

  -- Reuse a correctly typed existing account rather than duplicate the name.
  SELECT id, ledger_type, is_active
    INTO v_ledger_id, v_ledger_type, v_is_active
  FROM public.ledger_accounts
  WHERE branch_id = p_branch_id AND account_name = 'Fixed LR Charges'
  LIMIT 1;

  IF v_ledger_id IS NULL THEN
    INSERT INTO public.ledger_accounts (
      branch_id, account_name, account_type, description, ledger_type,
      account_kind, opening_balance, is_system, is_active
    ) VALUES (
      p_branch_id, 'Fixed LR Charges', 'expenditure',
      'Auto-created LTMS expenditure ledger for fixed LR charges',
      'expenditure', 'ledger', 0, true, true
    )
    ON CONFLICT (branch_id, account_name) DO NOTHING
    RETURNING id, ledger_type, is_active
      INTO v_ledger_id, v_ledger_type, v_is_active;

    IF v_ledger_id IS NULL THEN
      SELECT id, ledger_type, is_active
        INTO v_ledger_id, v_ledger_type, v_is_active
      FROM public.ledger_accounts
      WHERE branch_id = p_branch_id AND account_name = 'Fixed LR Charges'
      LIMIT 1;
    END IF;
  END IF;

  IF v_ledger_id IS NULL OR v_ledger_type <> 'expenditure'
     OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Fixed LR Charges must be an active expenditure ledger in branch %', p_branch_id;
  END IF;

  UPDATE public.tms_account_ledger_mappings
  SET fixed_lr_charges_ledger_id = v_ledger_id,
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND fixed_lr_charges_ledger_id IS NULL;

  RETURN v_ledger_id;
END;
$$;

-- Extend the existing branch auto-create flow WITHOUT replacing the long
-- provision_branch_mapping_accounts() function or its other account mappings.
CREATE OR REPLACE FUNCTION public.auto_map_ltms_fixed_lr_charges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_ltms_fixed_lr_charges_mapping(NEW.branch_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_map_ltms_fixed_lr_charges
  ON public.tms_account_ledger_mappings;

CREATE TRIGGER trg_auto_map_ltms_fixed_lr_charges
  AFTER INSERT ON public.tms_account_ledger_mappings
  FOR EACH ROW EXECUTE FUNCTION public.auto_map_ltms_fixed_lr_charges();

-- Existing branch mappings receive one expenditure ledger each.
-- Mappings that are already configured are never overwritten.
DO $$
DECLARE
  v_branch_id UUID;
BEGIN
  FOR v_branch_id IN
    SELECT branch_id
    FROM public.tms_account_ledger_mappings
    WHERE fixed_lr_charges_ledger_id IS NULL
  LOOP
    PERFORM public.ensure_ltms_fixed_lr_charges_mapping(v_branch_id);
  END LOOP;
END;
$$;

COMMIT;

-- Verify:
-- SELECT b.branch_name, l.account_name, l.ledger_type
-- FROM public.tms_account_ledger_mappings m
-- JOIN public.branches b ON b.id = m.branch_id
-- LEFT JOIN public.ledger_accounts l ON l.id = m.fixed_lr_charges_ledger_id
-- ORDER BY b.branch_name;
