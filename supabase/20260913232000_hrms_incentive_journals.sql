-- HRMS incentive journal entries.
-- Run after 20260913200000_hrms_accounts_and_accounting_branch.sql.
-- journal_date is accounting-only and does not affect payroll consumption.
begin;

alter table public.incentive_amounts
  add column if not exists journal_date date not null default current_date;

create index if not exists incentive_amounts_journal_date_idx
  on public.incentive_amounts(journal_date);

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
      and ledger_type in ('income', 'expenditure') and is_active
  ) then
    raise exception 'HRMS incentive journal mappings must be active income or expenditure ledgers from the employee branch';
  end if;

  v_description := 'Incentive' || case when nullif(trim(new.reason), '') is null then '' else ' - ' || trim(new.reason) end;
  select id into v_existing
    from public.journal_entries
   where reference = 'hrms:incentive:' || new.id::text
     and source_module = 'auto';
  if v_existing is not null then return new; end if;

  insert into public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) values (
    new.journal_date, v_branch_id, v_description,
    'hrms:incentive:' || new.id::text, 'auto', 'approved', now()
  ) returning id into v_entry;

  insert into public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) values
    (v_entry, 1, v_branch_id, v_debit, 'ledger', v_description, round(new.amount, 2), 0),
    (v_entry, 2, v_branch_id, v_credit, 'ledger', v_description, 0, round(new.amount, 2));

  perform public.validate_journal_entry(v_entry);
  return new;
end $$;

drop trigger if exists incentive_amounts_hrms_journal on public.incentive_amounts;
create trigger incentive_amounts_hrms_journal
after insert on public.incentive_amounts
for each row execute function public.hrms_incentive_journal_trigger();

commit;

-- Verification:
-- select entry_date, description, reference, status
-- from public.journal_entries
-- where reference like 'hrms:incentive:%'
-- order by created_at desc;
