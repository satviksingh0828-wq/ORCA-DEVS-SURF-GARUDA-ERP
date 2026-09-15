-- HRMS loss deduction journal entries.
-- Run after 20260913200000_hrms_accounts_and_accounting_branch.sql.
-- journal_date is accounting-only and does not affect payroll deduction timing.
begin;

alter table public.loss_deductions
  add column if not exists journal_date date not null default current_date;

alter table public.hrms_account_ledger_mappings
  add column if not exists loss_deduction_ledger_id uuid
  references public.ledger_accounts(id) on delete set null;

update public.hrms_account_ledger_mappings
   set loss_deduction_ledger_id = salary_deduction_ledger_id
 where loss_deduction_ledger_id is null
   and salary_deduction_ledger_id is not null;

create index if not exists loss_deductions_journal_date_idx
  on public.loss_deductions(journal_date);

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
  select salary_payable_ledger_id, loss_deduction_ledger_id
    into v_debit, v_credit
    from public.hrms_account_ledger_mappings
   where branch_id = v_branch_id;

  if v_debit is null or v_credit is null then
    raise exception 'HRMS loss deduction journal requires Salary Payable and Loss Deduction ledger mappings';
  end if;
  if not exists (
    select 1 from public.ledger_accounts
    where id = v_debit and branch_id = v_branch_id
      and ledger_type = 'liability' and is_active
  ) then
    raise exception 'Salary Payable must be an active liability ledger from the employee branch';
  end if;
  if not exists (
    select 1 from public.ledger_accounts
    where id = v_credit and branch_id = v_branch_id
      and ledger_type in ('income', 'expenditure') and is_active
  ) then
    raise exception 'Loss Deduction must be an active income or expenditure ledger from the employee branch';
  end if;

  v_description := 'Loss deduction' || case when nullif(trim(new.reason), '') is null then '' else ' - ' || trim(new.reason) end;
  select id into v_existing
    from public.journal_entries
   where reference = 'hrms:loss-deduction:' || new.id::text
     and source_module = 'auto';
  if v_existing is not null then return new; end if;

  insert into public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) values (
    new.journal_date, v_branch_id, v_description,
    'hrms:loss-deduction:' || new.id::text, 'auto', 'approved', now()
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

drop trigger if exists loss_deductions_hrms_journal on public.loss_deductions;
create trigger loss_deductions_hrms_journal
after insert on public.loss_deductions
for each row execute function public.hrms_loss_deduction_journal_trigger();

commit;

-- Verification:
-- select entry_date, description, reference, status
-- from public.journal_entries
-- where reference like 'hrms:loss-deduction:%'
-- order by created_at desc;
