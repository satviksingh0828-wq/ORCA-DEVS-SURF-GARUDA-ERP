-- Fix HRMS loan/advance journal source_module.
-- journal_entries.source_module permits: manual, auto, inter_branch, tms, cash_reports.
-- Run after 20260913230000_hrms_loan_advance_disbursement_accounts.sql.
begin;

create or replace function public.post_hrms_accounting_queue_item(p_queue_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.hrms_accounting_queue%rowtype;
  r public.hrms_accounting_rules%rowtype;
  v_entry uuid;
  v_existing uuid;
  v_credit uuid;
  v_debit uuid;
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

  if q.event_type = 'loan_given' then
    select employee_loan_ledger_id into v_debit
    from public.hrms_account_ledger_mappings where branch_id = q.branch_id;
  elsif q.event_type = 'advance_given' then
    select employee_advance_ledger_id into v_debit
    from public.hrms_account_ledger_mappings where branch_id = q.branch_id;
  else
    v_debit := r.debit_ledger_id;
  end if;

  if not exists (
    select 1 from public.ledger_accounts
    where id = v_debit and branch_id = q.branch_id
      and is_active
      and (q.event_type not in ('loan_given', 'advance_given') or ledger_type = 'asset')
  ) then
    raise exception 'HRMS debit ledger is missing, inactive, or has the wrong account type';
  end if;

  -- The existing journal schema calls system-generated entries "auto".
  select id into v_existing from public.journal_entries
  where reference = 'hrms:queue:' || q.id::text and source_module = 'auto';
  if v_existing is not null then
    update public.hrms_accounting_queue
    set status = 'posted', journal_entry_id = v_existing, posted_at = coalesce(posted_at, now())
    where id = q.id;
    return v_existing;
  end if;

  insert into public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) values (
    q.event_date, q.branch_id, q.description, 'hrms:queue:' || q.id::text,
    'auto', 'approved', now()
  ) returning id into v_entry;

  insert into public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) values
    (v_entry, 1, q.branch_id, v_debit, 'ledger', q.description, q.amount, 0),
    (v_entry, 2, q.branch_id, v_credit,
     (select account_kind from public.ledger_accounts where id = v_credit),
     q.description, 0, q.amount);

  perform public.validate_journal_entry(v_entry);
  update public.hrms_accounting_queue
  set status = 'posted', journal_entry_id = v_entry, posted_at = now()
  where id = q.id;
  return v_entry;
end $$;

-- If a failed attempt left a pending queue row, retry it after this fix.
-- select public.post_hrms_accounting_queue_item(id)
-- from public.hrms_accounting_queue
-- where event_type in ('loan_given', 'advance_given') and status = 'pending';

grant execute on function public.post_hrms_accounting_queue_item(uuid)
to anon, authenticated;

commit;
