-- HRMS payable ledger type correction.
-- Salary Payable and Incentive Payable are liability accounts.
-- Run after the HRMS incentive and loss-deduction journal migrations.
begin;

create or replace function public.hrms_incentive_journal_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid;
  v_debit uuid;
  v_credit uuid;
  v_entry uuid;
  v_existing uuid;
  v_description text;
begin
  v_branch_id := public.hrms_branch_for_employee(new.employee_id);
  select incentive_ledger_id, incentive_payable_ledger_id
    into v_debit, v_credit
    from public.hrms_account_ledger_mappings
   where branch_id = v_branch_id;
  if v_debit is null or v_credit is null then
    raise exception 'HRMS incentive journal requires Incentive and Incentive Payable ledger mappings';
  end if;
  if not exists (
    select 1 from public.ledger_accounts
    where id = v_debit and branch_id = v_branch_id
      and ledger_type in ('income', 'expenditure') and is_active
  ) or not exists (
    select 1 from public.ledger_accounts
    where id = v_credit and branch_id = v_branch_id
      and ledger_type = 'liability' and is_active
  ) then
    raise exception 'Incentive must be income/expenditure and Incentive Payable must be an active liability ledger from the employee branch';
  end if;
  v_description := 'Incentive' || case when nullif(trim(new.reason), '') is null then '' else ' - ' || trim(new.reason) end;
  select id into v_existing from public.journal_entries
   where reference = 'hrms:incentive:' || new.id::text and source_module = 'auto';
  if v_existing is not null then return new; end if;
  insert into public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  values (new.journal_date, v_branch_id, v_description, 'hrms:incentive:' || new.id::text, 'auto', 'approved', now())
  returning id into v_entry;
  insert into public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  values
    (v_entry, 1, v_branch_id, v_debit, 'ledger', v_description, round(new.amount, 2), 0),
    (v_entry, 2, v_branch_id, v_credit, 'ledger', v_description, 0, round(new.amount, 2));
  perform public.validate_journal_entry(v_entry);
  return new;
end $$;

create or replace function public.hrms_loss_deduction_journal_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid;
  v_debit uuid;
  v_credit uuid;
  v_entry uuid;
  v_existing uuid;
  v_description text;
begin
  v_branch_id := public.hrms_branch_for_employee(new.employee_id);
  select salary_payable_ledger_id, salary_deduction_ledger_id
    into v_debit, v_credit
    from public.hrms_account_ledger_mappings
   where branch_id = v_branch_id;
  if v_debit is null or v_credit is null then
    raise exception 'HRMS loss deduction journal requires Salary Payable and Salary Deduction ledger mappings';
  end if;
  if not exists (
    select 1 from public.ledger_accounts
    where id = v_debit and branch_id = v_branch_id
      and ledger_type = 'liability' and is_active
  ) or not exists (
    select 1 from public.ledger_accounts
    where id = v_credit and branch_id = v_branch_id
      and ledger_type in ('income', 'expenditure') and is_active
  ) then
    raise exception 'Salary Payable must be an active liability ledger and Salary Deduction must be an active income/expenditure ledger from the employee branch';
  end if;
  v_description := 'Loss deduction' || case when nullif(trim(new.reason), '') is null then '' else ' - ' || trim(new.reason) end;
  select id into v_existing from public.journal_entries
   where reference = 'hrms:loss-deduction:' || new.id::text and source_module = 'auto';
  if v_existing is not null then return new; end if;
  insert into public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  values (new.journal_date, v_branch_id, v_description, 'hrms:loss-deduction:' || new.id::text, 'auto', 'approved', now())
  returning id into v_entry;
  insert into public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  values
    (v_entry, 1, v_branch_id, v_debit, 'ledger', v_description, round(new.amount, 2), 0),
    (v_entry, 2, v_branch_id, v_credit, 'ledger', v_description, 0, round(new.amount, 2));
  perform public.validate_journal_entry(v_entry);
  return new;
end $$;

commit;
