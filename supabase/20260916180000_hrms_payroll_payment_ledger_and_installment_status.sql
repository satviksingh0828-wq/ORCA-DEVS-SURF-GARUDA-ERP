-- Let each payroll payment use a cash or bank account from the employee's Accounting Branch.
-- Cast direct-EMI text parameters to the installment enum before writing them.
BEGIN;

ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS payment_ledger_id uuid
  REFERENCES public.ledger_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.hrms_create_payroll_paid_journal(p_payroll public.payrolls)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_map public.hrms_account_ledger_mappings%rowtype;
  v_cash uuid;
  v_amount numeric := round(coalesce(nullif(p_payroll.payment_amount, 0), p_payroll.net), 2);
  v_entry uuid;
  v_ref text := 'hrms:payroll-paid:' || p_payroll.id::text || ':' || coalesce(p_payroll.payment_date, p_payroll.period_end)::text || ':' || round(coalesce(nullif(p_payroll.payment_amount, 0), p_payroll.net), 2)::text;
  v_description text := 'Salary paid - ' || p_payroll.period_start || ' to ' || p_payroll.period_end;
BEGIN
  IF v_amount <= 0 THEN RETURN NULL; END IF;
  v_branch := public.hrms_branch_for_employee(p_payroll.employee_id);
  SELECT * INTO v_map FROM public.hrms_account_ledger_mappings WHERE branch_id = v_branch;
  v_cash := p_payroll.payment_ledger_id;
  IF v_cash IS NULL THEN
    SELECT default_bank_cash_ledger_id INTO v_cash
    FROM public.hrms_accounting_rules WHERE branch_id = v_branch AND rule_key = 'payroll_paid';
  END IF;
  PERFORM public.hrms_require_payroll_ledger(v_map.salary_payable_ledger_id, v_branch, 'Salary Payable', ARRAY['liability']);
  PERFORM public.hrms_require_payroll_ledger(v_cash, v_branch, 'Payroll bank/cash account', ARRAY['bank','cash']);
  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_accounts
    WHERE id = v_cash AND branch_id = v_branch AND is_active AND ledger_type IN ('bank', 'cash')
  ) THEN
    RAISE EXCEPTION 'Payroll payment account must be an active cash or bank ledger from the employee accounting branch';
  END IF;
  SELECT id INTO v_entry FROM public.journal_entries WHERE reference = v_ref AND source_module = 'auto';
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  INSERT INTO public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  VALUES (coalesce(p_payroll.payment_date, p_payroll.period_end), v_branch, v_description, v_ref, 'auto', 'approved', now()) RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  VALUES
    (v_entry, 1, v_branch, v_map.salary_payable_ledger_id, 'ledger', v_description, v_amount, 0),
    (v_entry, 2, v_branch, v_cash, (SELECT account_kind FROM public.ledger_accounts WHERE id = v_cash), v_description, 0, v_amount);
  PERFORM public.validate_journal_entry(v_entry);
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.hrms_payroll_accounting_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.hrms_create_payroll_generated_journal(NEW);
  END IF;
  IF NEW.payment_status IN ('paid'::public.payroll_payment_status, 'partial_paid'::public.payroll_payment_status) THEN
    IF TG_OP = 'INSERT'
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
       OR NEW.payment_ledger_id IS DISTINCT FROM OLD.payment_ledger_id THEN
      PERFORM public.hrms_create_payroll_paid_journal(NEW);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payrolls_hrms_accounting ON public.payrolls;
CREATE TRIGGER payrolls_hrms_accounting
AFTER INSERT OR UPDATE OF payment_status, payment_date, payment_amount, payment_ledger_id ON public.payrolls
FOR EACH ROW EXECUTE FUNCTION public.hrms_payroll_accounting_trigger();

create or replace function public.hrms_record_direct_emi_payment(
  p_installment_kind text,
  p_installment_id uuid,
  p_payment_ledger_id uuid,
  p_amount numeric,
  p_status text default 'paid_manual'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_employee_id uuid;
  v_asset_ledger_id uuid;
  v_old_entry uuid;
  v_entry uuid;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_description text;
  v_prefix text;
  v_loan_id uuid;
  v_advance_id uuid;
begin
  if p_installment_kind not in ('loan', 'advance') then
    raise exception 'Installment kind must be loan or advance';
  end if;
  if p_status not in ('paid_manual', 'paid_partial_manual', 'partial_skipped') then
    raise exception 'Only direct EMI payment statuses can create a receipt journal';
  end if;
  if v_amount <= 0 then raise exception 'Direct EMI amount must be greater than zero'; end if;

  if p_installment_kind = 'loan' then
    select l.employee_id, l.id, i.direct_payment_journal_entry_id
      into v_employee_id, v_loan_id, v_old_entry
      from public.loan_installments i
      join public.loans l on l.id = i.loan_id
     where i.id = p_installment_id;
    select employee_loan_ledger_id into v_asset_ledger_id
      from public.hrms_account_ledger_mappings
     where branch_id = public.hrms_branch_for_employee(v_employee_id);
    v_prefix := 'loan-emi';
    v_description := 'Loan EMI received directly';
  else
    select a.employee_id, a.id, i.direct_payment_journal_entry_id
      into v_employee_id, v_advance_id, v_old_entry
      from public.advance_installments i
      join public.advances a on a.id = i.advance_id
     where i.id = p_installment_id;
    select employee_advance_ledger_id into v_asset_ledger_id
      from public.hrms_account_ledger_mappings
     where branch_id = public.hrms_branch_for_employee(v_employee_id);
    v_prefix := 'advance-emi';
    v_description := 'Advance EMI received directly';
  end if;

  v_branch_id := public.hrms_branch_for_employee(v_employee_id);
  if v_branch_id is null then raise exception 'Employee accounting branch was not found'; end if;
  if v_asset_ledger_id is null then raise exception 'Employee % asset ledger mapping is missing', p_installment_kind; end if;
  if not exists (
    select 1 from public.ledger_accounts
     where id = v_asset_ledger_id and branch_id = v_branch_id and ledger_type = 'asset' and is_active
  ) then raise exception 'Employee % asset ledger mapping is invalid', p_installment_kind; end if;
  if not exists (
    select 1 from public.ledger_accounts
     where id = p_payment_ledger_id and branch_id = v_branch_id
       and ledger_type in ('bank', 'cash') and is_active
  ) then raise exception 'Direct EMI receipt account must be an active cash or bank ledger from the employee accounting branch'; end if;

  if p_installment_kind = 'loan' and v_loan_id is null then raise exception 'Loan installment was not found'; end if;
  if p_installment_kind = 'advance' and v_advance_id is null then raise exception 'Advance installment was not found'; end if;

  if v_old_entry is not null then
    perform public.hrms_reverse_journal_entry(
      v_old_entry,
      'hrms:reversal:' || v_prefix || ':' || p_installment_id::text || ':' || v_old_entry::text,
      'Reversal of previous direct EMI receipt'
    );
  end if;

  insert into public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) values (
    current_date, v_branch_id, v_description,
    'hrms:' || v_prefix || ':' || p_installment_id::text || ':' || gen_random_uuid()::text,
    'auto', 'approved', now()
  ) returning id into v_entry;

  insert into public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) values
    (v_entry, 1, v_branch_id, p_payment_ledger_id,
      (select account_kind from public.ledger_accounts where id = p_payment_ledger_id),
      v_description, v_amount, 0),
    (v_entry, 2, v_branch_id, v_asset_ledger_id, 'ledger', v_description, 0, v_amount);

  perform public.validate_journal_entry(v_entry);

  if p_installment_kind = 'loan' then
    update public.loan_installments
       set status = p_status::public.installment_status, paid_amount = case when p_status = 'paid_manual' then 0 else v_amount end,
           payroll_id = null, direct_payment_journal_entry_id = v_entry,
           direct_payment_ledger_id = p_payment_ledger_id
     where id = p_installment_id;
  else
    update public.advance_installments
       set status = p_status::public.installment_status, paid_amount = case when p_status = 'paid_manual' then 0 else v_amount end,
           payroll_id = null, direct_payment_journal_entry_id = v_entry,
           direct_payment_ledger_id = p_payment_ledger_id
     where id = p_installment_id;
  end if;
  return v_entry;
end;
$$;


GRANT EXECUTE ON FUNCTION public.hrms_create_payroll_paid_journal(public.payrolls), public.hrms_payroll_accounting_trigger(), public.hrms_record_direct_emi_payment(text, uuid, uuid, numeric, text) TO anon, authenticated;

COMMIT;
