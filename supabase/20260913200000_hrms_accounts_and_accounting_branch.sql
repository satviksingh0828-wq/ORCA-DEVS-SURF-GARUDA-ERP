-- HRMS Accounts mappings per branch and employee Accounting Branch.
-- Run this migration in Supabase SQL Editor.
begin;

alter table public.employees
  add column if not exists accounting_branch_id uuid references public.branches(id) on delete set null;

create index if not exists employees_accounting_branch_idx
  on public.employees(accounting_branch_id);

create table if not exists public.hrms_account_ledger_mappings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  salary_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  salary_payable_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  employee_advance_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  employee_loan_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  incentive_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  incentive_payable_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  salary_deduction_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  unpaid_leave_deduction_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  paid_leave_payout_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  extra_work_day_payout_ledger_id uuid references public.ledger_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id)
);

create index if not exists hrms_account_ledger_mappings_branch_idx
  on public.hrms_account_ledger_mappings(branch_id);

create or replace function public.hrms_account_ledger_mappings_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists hrms_account_ledger_mappings_updated_at on public.hrms_account_ledger_mappings;
create trigger hrms_account_ledger_mappings_updated_at
before update on public.hrms_account_ledger_mappings
for each row execute function public.hrms_account_ledger_mappings_updated_at();

insert into public.hrms_account_ledger_mappings(branch_id)
select id from public.branches
on conflict (branch_id) do nothing;

create or replace function public.provision_hrms_account_ledger_mapping()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.hrms_account_ledger_mappings(branch_id)
  values (new.id)
  on conflict (branch_id) do nothing;
  return new;
end $$;

drop trigger if exists branches_hrms_account_ledger_mapping on public.branches;
create trigger branches_hrms_account_ledger_mapping
after insert on public.branches
for each row execute function public.provision_hrms_account_ledger_mapping();

-- Prefer the employee's explicitly selected Accounting Branch; retain the
-- department branch as a backward-compatible fallback for existing employees.
create or replace function public.hrms_branch_for_employee(p_employee_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(e.accounting_branch_id, d.branch_id)
  from public.employees e
  left join public.departments d on d.id = e.department_id
  where e.id = p_employee_id
  limit 1
$$;

alter table public.hrms_account_ledger_mappings enable row level security;
drop policy if exists "hrms account ledger mappings app access" on public.hrms_account_ledger_mappings;
create policy "hrms account ledger mappings app access"
on public.hrms_account_ledger_mappings for all to anon, authenticated
using (true) with check (true);

grant select, insert, update, delete on public.hrms_account_ledger_mappings to anon, authenticated;
grant select, update on public.employees to anon, authenticated;

commit;
