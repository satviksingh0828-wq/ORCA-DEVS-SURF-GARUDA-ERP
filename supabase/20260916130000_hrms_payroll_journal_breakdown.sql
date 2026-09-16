-- Exact HRMS payroll journal breakdown.
-- Generated payroll: earnings/deductions are posted to mapped ledgers.
-- Payroll payment: Salary Payable is debited and selected bank/cash is credited.
-- Payroll deletion: generated and payment journals are reversed first.
begin;

alter table public.hrms_account_ledger_mappings
  add column if not exists pf_ledger_id uuid references public.ledger_accounts(id) on delete set null;
alter table public.hrms_account_ledger_mappings
  add column if not exists tax_ledger_id uuid references public.ledger_accounts(id) on delete set null;

create or replace function public.hrms_require_payroll_ledger(
  p_ledger_id uuid,
  p_branch_id uuid,
  p_label text,
  p_allowed_types text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if p_ledger_id is null then
    raise exception 'Map % for the employee Accounting Branch before generating payroll', p_label;
  end if;
  select ledger_type into v_type from public.ledger_accounts
   where id = p_ledger_id and branch_id = p_branch_id and is_active;
  if v_type is null or not (v_type = any(p_allowed_types)) then
    raise exception '% must be an active ledger in the employee Accounting Branch', p_label;
  end if;
end;
$$;

create or replace function public.hrms_create_payroll_generated_journal(p_payroll public.payrolls)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_entry uuid;
  v_existing uuid;
  v_map public.hrms_account_ledger_mappings%rowtype;
  v_salary numeric := round(coalesce(p_payroll.basic_salary, 0) + coalesce(p_payroll.hra, 0) + coalesce(p_payroll.travel_allowance, 0) + coalesce(p_payroll.special_allowance, 0) + coalesce(p_payroll.other_allowance, 0), 2);
  v_extra numeric := round(coalesce(p_payroll.extra_work_pay, 0), 2);
  v_leave numeric := round(coalesce(p_payroll.paid_leave_payout_amount, 0) + coalesce(p_payroll.paid_leave_final_settlement_amount, 0), 2);
  v_incentive numeric := round(coalesce(p_payroll.incentive_amount, 0), 2);
  v_unpaid numeric := round(coalesce(p_payroll.unpaid_leave_deduction, 0), 2);
  v_loan numeric := round(coalesce(p_payroll.loan_deduction, 0), 2);
  v_advance numeric := round(coalesce(p_payroll.advance_deduction, 0), 2);
  v_pf numeric := round(coalesce(p_payroll.pf_deduction, 0), 2);
  v_tax numeric := round(coalesce(p_payroll.tax_deduction, 0), 2);
  v_salary_payable numeric;
  v_description text := 'Payroll generated - ' || p_payroll.period_start || ' to ' || p_payroll.period_end;
begin
  v_branch := public.hrms_branch_for_employee(p_payroll.employee_id);
  if v_branch is null then raise exception 'Employee has no Accounting Branch or department branch'; end if;
  select * into v_map from public.hrms_account_ledger_mappings where branch_id = v_branch;
  if v_map.id is null then raise exception 'HRMS account mappings are missing for the employee Accounting Branch'; end if;

  perform public.hrms_require_payroll_ledger(v_map.salary_ledger_id, v_branch, 'Salary', array['income','expenditure','revenue']);
  if v_extra > 0 then perform public.hrms_require_payroll_ledger(v_map.extra_work_day_payout_ledger_id, v_branch, 'Extra Work Day Payout', array['income','expenditure','revenue']); end if;
  if v_leave > 0 then perform public.hrms_require_payroll_ledger(v_map.paid_leave_payout_ledger_id, v_branch, 'Paid Leave Payout', array['income','expenditure','revenue']); end if;
  if v_incentive > 0 then perform public.hrms_require_payroll_ledger(v_map.incentive_payable_ledger_id, v_branch, 'Incentive Payable', array['liability']); end if;
  if v_unpaid > 0 then perform public.hrms_require_payroll_ledger(v_map.unpaid_leave_deduction_ledger_id, v_branch, 'Unpaid Leave Deduction', array['income','expenditure','revenue']); end if;
  if v_loan > 0 then perform public.hrms_require_payroll_ledger(v_map.employee_loan_ledger_id, v_branch, 'Employee Loan', array['asset','capital']); end if;
  if v_advance > 0 then perform public.hrms_require_payroll_ledger(v_map.employee_advance_ledger_id, v_branch, 'Employee Advance', array['asset','capital']); end if;
  if v_pf > 0 then perform public.hrms_require_payroll_ledger(v_map.pf_ledger_id, v_branch, 'PF', array['income','expenditure','revenue']); end if;
  if v_tax > 0 then perform public.hrms_require_payroll_ledger(v_map.tax_ledger_id, v_branch, 'Tax', array['income','expenditure','revenue']); end if;

  -- Loss deduction is intentionally excluded: its separate HRMS journal already debits Salary Payable.
  v_salary_payable := round(v_salary + v_extra + v_leave + v_incentive - v_unpaid - v_loan - v_advance - v_pf - v_tax, 2);
  if v_salary_payable <= 0 then raise exception 'Payroll journal has no positive Salary Payable balance'; end if;
  perform public.hrms_require_payroll_ledger(v_map.salary_payable_ledger_id, v_branch, 'Salary Payable', array['liability']);

  select id into v_existing from public.journal_entries
   where reference = 'hrms:payroll-generated:' || p_payroll.id::text and source_module = 'auto';
  if v_existing is not null then return v_existing; end if;

  insert into public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  values (p_payroll.period_end, v_branch, v_description, 'hrms:payroll-generated:' || p_payroll.id::text, 'auto', 'approved', now())
  returning id into v_entry;

  insert into public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  select v_entry, row_number() over (order by line_no)::integer, v_branch, ledger_id,
         (select account_kind from public.ledger_accounts where id = ledger_id), line_description, debit, credit
  from (values
    (1, v_map.salary_ledger_id, 'Salary: Basic + HRA + Travel + Special + Other', v_salary, 0::numeric),
    (2, v_map.extra_work_day_payout_ledger_id, 'Extra Work Day Payout', v_extra, 0::numeric),
    (3, v_map.paid_leave_payout_ledger_id, 'Paid Leave Payout', v_leave, 0::numeric),
    (4, v_map.incentive_payable_ledger_id, 'One-time incentive', v_incentive, 0::numeric),
    (5, v_map.unpaid_leave_deduction_ledger_id, 'Unpaid Leave Deduction', 0::numeric, v_unpaid),
    (6, v_map.employee_loan_ledger_id, 'Employee Loan EMI', 0::numeric, v_loan),
    (7, v_map.employee_advance_ledger_id, 'Employee Advance EMI', 0::numeric, v_advance),
    (8, v_map.pf_ledger_id, 'PF', 0::numeric, v_pf),
    (9, v_map.tax_ledger_id, 'Tax', 0::numeric, v_tax),
    (10, v_map.salary_payable_ledger_id, 'Remaining Salary Payable', 0::numeric, v_salary_payable)
  ) as lines(line_no, ledger_id, line_description, debit, credit)
  where (debit > 0 or credit > 0);

  perform public.validate_journal_entry(v_entry);
  return v_entry;
end;
$$;

create or replace function public.hrms_create_payroll_paid_journal(p_payroll public.payrolls)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_map public.hrms_account_ledger_mappings%rowtype;
  v_cash uuid;
  v_amount numeric := round(coalesce(nullif(p_payroll.payment_amount, 0), p_payroll.net), 2);
  v_entry uuid;
  v_ref text := 'hrms:payroll-paid:' || p_payroll.id::text || ':' || coalesce(p_payroll.payment_date, p_payroll.period_end)::text || ':' || round(coalesce(nullif(p_payroll.payment_amount, 0), p_payroll.net), 2)::text;
  v_description text := 'Salary paid - ' || p_payroll.period_start || ' to ' || p_payroll.period_end;
begin
  if v_amount <= 0 then return null; end if;
  v_branch := public.hrms_branch_for_employee(p_payroll.employee_id);
  select * into v_map from public.hrms_account_ledger_mappings where branch_id = v_branch;
  select default_bank_cash_ledger_id into v_cash from public.hrms_accounting_rules where branch_id = v_branch and rule_key = 'payroll_paid';
  perform public.hrms_require_payroll_ledger(v_map.salary_payable_ledger_id, v_branch, 'Salary Payable', array['liability']);
  perform public.hrms_require_payroll_ledger(v_cash, v_branch, 'Payroll bank/cash account', array['bank','cash']);
  select id into v_entry from public.journal_entries where reference = v_ref and source_module = 'auto';
  if v_entry is not null then return v_entry; end if;
  insert into public.journal_entries(entry_date, branch_id, description, reference, source_module, status, approved_at)
  values (coalesce(p_payroll.payment_date, p_payroll.period_end), v_branch, v_description, v_ref, 'auto', 'approved', now()) returning id into v_entry;
  insert into public.journal_lines(journal_entry_id, line_no, branch_id, ledger_account_id, account_kind, line_description, debit, credit)
  values
    (v_entry, 1, v_branch, v_map.salary_payable_ledger_id, 'ledger', v_description, v_amount, 0),
    (v_entry, 2, v_branch, v_cash, (select account_kind from public.ledger_accounts where id = v_cash), v_description, 0, v_amount);
  perform public.validate_journal_entry(v_entry);
  return v_entry;
end;
$$;

create or replace function public.hrms_payroll_accounting_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.hrms_create_payroll_generated_journal(new);
  end if;
  if coalesce(new.payment_status, '') in ('paid', 'partial_paid') then
    if tg_op = 'INSERT' or new.payment_status is distinct from old.payment_status or new.payment_date is distinct from old.payment_date or new.payment_amount is distinct from old.payment_amount then
      perform public.hrms_create_payroll_paid_journal(new);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payrolls_hrms_accounting on public.payrolls;
create trigger payrolls_hrms_accounting
after insert or update of payment_status, payment_date, payment_amount on public.payrolls
for each row execute function public.hrms_payroll_accounting_trigger();

create or replace function public.hrms_reverse_payroll_journals_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_queue record;
begin
  for v_entry in
    select id, reference from public.journal_entries
     where source_module = 'auto'
       and (reference = 'hrms:payroll-generated:' || old.id::text
         or reference like 'hrms:payroll-paid:' || old.id::text || ':%')
  loop
    perform public.hrms_reverse_journal_entry(
      v_entry.id,
      'hrms:reversal:payroll:' || old.id::text || ':' || v_entry.id::text,
      'Reversal of payroll journal before payroll deletion'
    );
  end loop;
  for v_queue in select id from public.hrms_accounting_queue where event_type = 'payroll_paid' and source_id = old.id loop
    update public.hrms_accounting_queue set status = 'cancelled' where id = v_queue.id;
  end loop;
  return old;
end;
$$;

drop trigger if exists payrolls_hrms_reverse_before_delete on public.payrolls;
create trigger payrolls_hrms_reverse_before_delete
before delete on public.payrolls
for each row execute function public.hrms_reverse_payroll_journals_before_delete();

grant execute on function public.hrms_create_payroll_generated_journal(public.payrolls) to anon, authenticated;
grant execute on function public.hrms_create_payroll_paid_journal(public.payrolls) to anon, authenticated;
grant execute on function public.hrms_payroll_accounting_trigger() to anon, authenticated;
grant execute on function public.hrms_reverse_payroll_journals_before_delete() to anon, authenticated;

commit;
