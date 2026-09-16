-- HRMS direct EMI receipts and reversal-first deletion accounting.
-- Payroll EMI accounting is intentionally unchanged in this migration.
begin;

alter table public.loan_installments
  add column if not exists direct_payment_journal_entry_id uuid references public.journal_entries(id) on delete set null;
alter table public.loan_installments
  add column if not exists direct_payment_ledger_id uuid references public.ledger_accounts(id) on delete set null;
alter table public.advance_installments
  add column if not exists direct_payment_journal_entry_id uuid references public.journal_entries(id) on delete set null;
alter table public.advance_installments
  add column if not exists direct_payment_ledger_id uuid references public.ledger_accounts(id) on delete set null;

create index if not exists loan_installments_direct_journal_idx
  on public.loan_installments(direct_payment_journal_entry_id);
create index if not exists advance_installments_direct_journal_idx
  on public.advance_installments(direct_payment_journal_entry_id);

create or replace function public.hrms_reverse_journal_entry(
  p_original_entry_id uuid,
  p_reference text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.journal_entries%rowtype;
  v_existing uuid;
  v_reversal uuid;
  v_line record;
begin
  if p_original_entry_id is null then return null; end if;
  select * into v_original from public.journal_entries where id = p_original_entry_id;
  if v_original.id is null then return null; end if;

  select id into v_existing from public.journal_entries
   where reference = p_reference and source_module = 'auto';
  if v_existing is not null then return v_existing; end if;

  insert into public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at
  ) values (
    current_date,
    v_original.branch_id,
    coalesce(nullif(trim(p_description), ''), 'Reversal of ' || coalesce(v_original.description, v_original.reference)),
    p_reference,
    'auto',
    'approved',
    now()
  ) returning id into v_reversal;

  for v_line in
    select line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit
    from public.journal_lines
    where journal_entry_id = p_original_entry_id
    order by line_no
  loop
    insert into public.journal_lines(
      journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
      line_description, debit, credit
    ) values (
      v_reversal, v_line.line_no, v_line.branch_id, v_line.ledger_account_id,
      v_line.account_kind, coalesce(v_line.line_description, 'Reversal'),
      round(coalesce(v_line.credit, 0), 2), round(coalesce(v_line.debit, 0), 2)
    );
  end loop;

  perform public.validate_journal_entry(v_reversal);
  return v_reversal;
end;
$$;

grant execute on function public.hrms_reverse_journal_entry(uuid, text, text)
to anon, authenticated;

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
       set status = p_status, paid_amount = case when p_status = 'paid_manual' then 0 else v_amount end,
           payroll_id = null, direct_payment_journal_entry_id = v_entry,
           direct_payment_ledger_id = p_payment_ledger_id
     where id = p_installment_id;
  else
    update public.advance_installments
       set status = p_status, paid_amount = case when p_status = 'paid_manual' then 0 else v_amount end,
           payroll_id = null, direct_payment_journal_entry_id = v_entry,
           direct_payment_ledger_id = p_payment_ledger_id
     where id = p_installment_id;
  end if;
  return v_entry;
end;
$$;

grant execute on function public.hrms_record_direct_emi_payment(text, uuid, uuid, numeric, text)
to anon, authenticated;

create or replace function public.hrms_delete_with_reversal(
  p_record_kind text,
  p_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id uuid;
  v_original_entry uuid;
  v_inst record;
  v_entry uuid;
  v_event text;
  v_reference text;
begin
  if p_record_kind not in ('loan', 'advance', 'incentive', 'loss_deduction') then
    raise exception 'Unsupported HRMS record kind';
  end if;

  if p_record_kind in ('loan', 'advance') then
    -- Direct receipts must be reversed before the original disbursement.
    if p_record_kind = 'loan' then
      v_event := 'loan_given';
      for v_inst in select id, direct_payment_journal_entry_id from public.loan_installments where loan_id = p_record_id loop
        if v_inst.direct_payment_journal_entry_id is not null then
          perform public.hrms_reverse_journal_entry(
            v_inst.direct_payment_journal_entry_id,
            'hrms:reversal:loan-emi:' || v_inst.id::text || ':' || v_inst.direct_payment_journal_entry_id::text,
            'Reversal of loan EMI receipt before loan deletion'
          );
        end if;
      end loop;
    else
      v_event := 'advance_given';
      for v_inst in select id, direct_payment_journal_entry_id from public.advance_installments where advance_id = p_record_id loop
        if v_inst.direct_payment_journal_entry_id is not null then
          perform public.hrms_reverse_journal_entry(
            v_inst.direct_payment_journal_entry_id,
            'hrms:reversal:advance-emi:' || v_inst.id::text || ':' || v_inst.direct_payment_journal_entry_id::text,
            'Reversal of advance EMI receipt before advance deletion'
          );
        end if;
      end loop;
    end if;

    select id into v_queue_id from public.hrms_accounting_queue
     where event_type = v_event and source_id = p_record_id;
    if v_queue_id is not null then
      select journal_entry_id into v_original_entry from public.hrms_accounting_queue where id = v_queue_id;
      if v_original_entry is not null then
        perform public.hrms_reverse_journal_entry(
          v_original_entry,
          'hrms:reversal:' || v_event || ':' || p_record_id::text,
          'Reversal of ' || replace(v_event, '_', ' ') || ' before deletion'
        );
      end if;
    end if;

    if p_record_kind = 'loan' then
      delete from public.loan_installments where loan_id = p_record_id;
      delete from public.loans where id = p_record_id;
    else
      delete from public.advance_installments where advance_id = p_record_id;
      delete from public.advances where id = p_record_id;
    end if;
    return;
  end if;

  if p_record_kind = 'incentive' then
    v_reference := 'hrms:incentive:' || p_record_id::text;
    select id into v_original_entry from public.journal_entries where reference = v_reference and source_module = 'auto';
    if v_original_entry is not null then
      perform public.hrms_reverse_journal_entry(v_original_entry, 'hrms:reversal:incentive:' || p_record_id::text, 'Reversal of incentive before deletion');
    end if;
    delete from public.incentive_amounts where id = p_record_id;
  else
    v_reference := 'hrms:loss-deduction:' || p_record_id::text;
    select id into v_original_entry from public.journal_entries where reference = v_reference and source_module = 'auto';
    if v_original_entry is not null then
      perform public.hrms_reverse_journal_entry(v_original_entry, 'hrms:reversal:loss-deduction:' || p_record_id::text, 'Reversal of loss deduction before deletion');
    end if;
    delete from public.loss_deductions where id = p_record_id;
  end if;
end;
$$;

grant execute on function public.hrms_delete_with_reversal(text, uuid)
to anon, authenticated;

commit;
