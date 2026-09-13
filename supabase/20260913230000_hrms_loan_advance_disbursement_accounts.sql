-- HRMS loan and advance disbursement accounts.
-- Run after 20260913200000_hrms_accounts_and_accounting_branch.sql.
-- Loans and advances debit the mapped branch asset ledger and credit the
-- bank/cash ledger selected from the employee's Accounting Branch.
begin;

alter table public.loans
  add column if not exists disbursement_ledger_id uuid references public.ledger_accounts(id) on delete set null;
alter table public.advances
  add column if not exists disbursement_ledger_id uuid references public.ledger_accounts(id) on delete set null;

create index if not exists loans_disbursement_ledger_idx
  on public.loans(disbursement_ledger_id);
create index if not exists advances_disbursement_ledger_idx
  on public.advances(disbursement_ledger_id);

alter table public.hrms_accounting_queue
  add column if not exists disbursement_ledger_id uuid references public.ledger_accounts(id) on delete set null;

-- Queue an event with an explicit credit account. The existing six-argument
-- function remains available for payroll and legacy callers.
create or replace function public.hrms_queue_event(
  p_event_type text,
  p_source_id uuid,
  p_branch_id uuid,
  p_event_date date,
  p_amount numeric,
  p_description text,
  p_disbursement_ledger_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_enabled boolean;
  v_requires boolean;
  v_debit uuid;
  v_credit uuid;
  v_mapping_column text;
begin
  if p_branch_id is null or coalesce(p_amount, 0) <= 0 then return null; end if;

  select enabled, requires_verification, default_bank_cash_ledger_id
    into v_enabled, v_requires, v_credit
    from public.hrms_accounting_rules
   where branch_id = p_branch_id and rule_key = p_event_type;
  if not coalesce(v_enabled, false) then return null; end if;

  if p_event_type = 'loan_given' then
    v_mapping_column := 'employee_loan_ledger_id';
  elsif p_event_type = 'advance_given' then
    v_mapping_column := 'employee_advance_ledger_id';
  else
    raise exception 'Explicit disbursement accounts are only valid for loans and advances';
  end if;

  execute format(
    'select %I from public.hrms_account_ledger_mappings where branch_id = $1',
    v_mapping_column
  ) into v_debit using p_branch_id;

  if v_debit is null then
    raise exception 'HRMS % mapping requires an Employee % asset ledger', p_event_type,
      case when p_event_type = 'loan_given' then 'Loan' else 'Advance' end;
  end if;
  if not exists (
    select 1 from public.ledger_accounts
    where id = v_debit and branch_id = p_branch_id
      and ledger_type = 'asset' and is_active
  ) then
    raise exception 'Employee % mapping must be an active asset ledger from the employee branch',
      case when p_event_type = 'loan_given' then 'Loan' else 'Advance' end;
  end if;

  v_credit := coalesce(p_disbursement_ledger_id, v_credit);
  if not exists (
    select 1 from public.ledger_accounts
    where id = v_credit and branch_id = p_branch_id
      and ledger_type in ('bank', 'cash') and is_active
  ) then
    raise exception 'Loan or advance disbursement account must be an active bank or cash ledger from the employee Accounting Branch';
  end if;

  insert into public.hrms_accounting_queue(
    event_type, source_id, branch_id, event_date, amount, description,
    disbursement_ledger_id
  ) values (
    p_event_type, p_source_id, p_branch_id, coalesce(p_event_date, current_date),
    round(p_amount, 2), p_description, v_credit
  )
  on conflict (event_type, source_id) do update set
    branch_id = excluded.branch_id,
    event_date = excluded.event_date,
    amount = excluded.amount,
    description = excluded.description,
    disbursement_ledger_id = excluded.disbursement_ledger_id,
    status = case when hrms_accounting_queue.status = 'posted' then 'posted' else 'pending' end
  returning id into v_id;

  -- Loans and advances are disbursed immediately, so create the journal now.
  perform public.post_hrms_accounting_queue_item(v_id);
  return v_id;
end $$;

create or replace function public.post_hrms_accounting_queue_item(p_queue_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.hrms_accounting_queue%rowtype;
  r public.hrms_accounting_rules%rowtype;
  v_entry uuid;
  v_existing uuid;
  v_credit uuid;
begin
  select * into q from public.hrms_accounting_queue where id = p_queue_id for update;
  if q.id is null then raise exception 'HRMS accounting queue item was not found'; end if;
  if q.status = 'posted' then return q.journal_entry_id; end if;

  select * into r from public.hrms_accounting_rules
  where branch_id = q.branch_id and rule_key = q.event_type;
  if not r.enabled or (
    q.event_type not in ('loan_given', 'advance_given')
    and r.debit_ledger_id is null
  ) then
    raise exception 'HRMS accounting rule is incomplete or disabled';
  end if;

  v_credit := coalesce(q.disbursement_ledger_id, r.default_bank_cash_ledger_id);
  if not exists (
    select 1 from public.ledger_accounts
    where id = v_credit and branch_id = q.branch_id
      and ledger_type in ('bank', 'cash') and is_active
  ) then
    raise exception 'HRMS accounting rule requires an active bank or cash ledger from the entry branch';
  end if;

  select id into v_existing from public.journal_entries
  where reference = 'hrms:queue:' || q.id::text and source_module = 'auto';
  if v_existing is not null then
    update public.hrms_accounting_queue
    set status = 'posted', journal_entry_id = v_existing, posted_at = coalesce(posted_at, now())
    where id = q.id;
    return v_existing;
  end if;

  insert into public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  values (q.event_date, q.branch_id, q.description, 'hrms:queue:' || q.id::text, 'auto', 'approved', now())
  returning id into v_entry;

  insert into public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) values
    (v_entry, 1, q.branch_id,
     case when q.event_type in ('loan_given', 'advance_given')
          then case when q.event_type = 'loan_given'
                    then (select employee_loan_ledger_id from public.hrms_account_ledger_mappings where branch_id = q.branch_id)
                    else (select employee_advance_ledger_id from public.hrms_account_ledger_mappings where branch_id = q.branch_id)
               end
          else r.debit_ledger_id end,
     'ledger', q.description, q.amount, 0),
    (v_entry, 2, q.branch_id, v_credit,
     (select account_kind from public.ledger_accounts where id = v_credit),
     q.description, 0, q.amount);

  perform public.validate_journal_entry(v_entry);
  update public.hrms_accounting_queue
  set status = 'posted', journal_entry_id = v_entry, posted_at = now()
  where id = q.id;
  return v_entry;
end $$;

create or replace function public.hrms_loan_accounting_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.hrms_queue_event(
    'loan_given', new.id, public.hrms_branch_for_employee(new.employee_id),
    new.start_date, new.principal, 'Loan given', new.disbursement_ledger_id
  );
  return new;
end $$;

create or replace function public.hrms_advance_accounting_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.hrms_queue_event(
    'advance_given', new.id, public.hrms_branch_for_employee(new.employee_id),
    new.start_date, new.principal, 'Advance given', new.disbursement_ledger_id
  );
  return new;
end $$;

grant execute on function public.hrms_queue_event(text, uuid, uuid, date, numeric, text, uuid)
to anon, authenticated;

grant select, insert, update on public.loans to anon, authenticated;
grant select, insert, update on public.advances to anon, authenticated;

grant select, update on public.hrms_accounting_queue to anon, authenticated;

commit;

-- Verification queries:
-- select employee_loan_ledger_id, employee_advance_ledger_id, branch_id
-- from public.hrms_account_ledger_mappings;
-- select event_type, disbursement_ledger_id, journal_entry_id, status
-- from public.hrms_accounting_queue
-- where event_type in ('loan_given', 'advance_given')
-- order by created_at desc;
