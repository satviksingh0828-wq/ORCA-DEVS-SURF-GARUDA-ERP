-- Fix incentive journal posting against the employee Accounting Branch.
-- This supersedes older incentive trigger functions that expected both ledgers
-- to be income/expenditure accounts.
begin;

-- Normalize legacy category names so old ledgers remain selectable and valid.
update public.ledger_accounts
set ledger_type = 'income', account_type = 'income'
where ledger_type = 'revenue';

update public.ledger_accounts
set ledger_type = 'expenditure', account_type = 'expenditure'
where ledger_type = 'expense';

-- Employee Accounting Branch is authoritative; department branch is fallback.
create or replace function public.hrms_branch_for_employee(p_employee_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(e.accounting_branch_id, d.branch_id)
  from public.employees e
  left join public.departments d on d.id = e.department_id
  where e.id = p_employee_id
  limit 1
$$;

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
  if v_branch_id is null then
    raise exception 'Employee has no Accounting Branch or department branch';
  end if;

  select incentive_ledger_id, incentive_payable_ledger_id
    into v_debit, v_credit
    from public.hrms_account_ledger_mappings
   where branch_id = v_branch_id;

  if v_debit is null or v_credit is null then
    raise exception 'Map Incentive and Incentive Payable ledgers for the employee Accounting Branch before adding an incentive';
  end if;

  if not exists (
    select 1 from public.ledger_accounts
    where id = v_debit
      and branch_id = v_branch_id
      and ledger_type in ('income', 'expenditure')
      and is_active
  ) then
    raise exception 'Mapped Incentive ledger must be an active income or expenditure ledger in the employee Accounting Branch';
  end if;

  if not exists (
    select 1 from public.ledger_accounts
    where id = v_credit
      and branch_id = v_branch_id
      and ledger_type = 'liability'
      and is_active
  ) then
    raise exception 'Mapped Incentive Payable ledger must be an active liability ledger in the employee Accounting Branch';
  end if;

  v_description := 'Incentive' || case
    when nullif(trim(new.reason), '') is null then ''
    else ' - ' || trim(new.reason)
  end;

  select id into v_existing
    from public.journal_entries
   where reference = 'hrms:incentive:' || new.id::text
     and source_module = 'auto';
  if v_existing is not null then return new; end if;

  insert into public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) values (
    coalesce(new.journal_date, current_date),
    v_branch_id,
    v_description,
    'hrms:incentive:' || new.id::text,
    'auto',
    'approved',
    now()
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

grant execute on function public.hrms_branch_for_employee(uuid) to anon, authenticated;

commit;

-- Diagnostic checks before retrying the incentive:
-- select id, first_name, last_name, accounting_branch_id,
--        public.hrms_branch_for_employee(id) as resolved_accounting_branch
-- from public.employees
-- where id = '<employee-id>';
-- select branch_id, incentive_ledger_id, incentive_payable_ledger_id
-- from public.hrms_account_ledger_mappings
-- where branch_id = '<resolved-accounting-branch-id>';
-- select id, account_name, ledger_type, branch_id, is_active
-- from public.ledger_accounts
-- where id in ('<incentive-ledger-id>', '<incentive-payable-ledger-id>');
