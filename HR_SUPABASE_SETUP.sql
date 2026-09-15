-- HR module setup for the Sparrow/Garuda dashboard
-- Run this once in the SAME Supabase project used by the target dashboard.
-- WhatsApp and backup tables are intentionally not included.
--
-- The dashboard uses its own app_users session system, so these policies allow
-- the browser's anon Supabase key to operate on HR tables. The application
-- enforces the Admin/Viewer role at the route and navigation layers.

create extension if not exists pgcrypto;

do $$ begin
  create type public.employee_status as enum ('active', 'inactive');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.gender_type as enum ('male', 'female', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.attendance_status as enum ('present', 'absent', 'half_day');
exception when duplicate_object then null;
end $$;
alter type public.attendance_status add value if not exists 'extra_work';
alter type public.attendance_status add value if not exists 'half_extra_work';

do $$ begin
  create type public.payroll_period_type as enum ('month', 'half_month');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.interest_method as enum ('simple', 'compound', 'none');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.loan_status as enum ('active', 'paid');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.loss_ded_status as enum ('pending', 'deducted', 'paid');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.installment_status as enum (
    'pending', 'paid_manual', 'paid_payroll', 'paid_partial_manual',
    'skipped', 'partial_skipped', 'payroll_partial_skipped'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payroll_payment_status as enum ('generated', 'paid', 'partial_paid');
exception when duplicate_object then null;
end $$;

-- HR master data
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text,
  first_name text not null,
  middle_name text,
  last_name text not null,
  mobile text not null default '',
  address text not null default '',
  dob date not null,
  gender public.gender_type not null default 'other',
  joining_date date not null,
  work_start_time time not null default '09:00',
  work_end_time time not null default '18:00',
  basic_salary numeric(14,2) not null default 0,
  hra numeric(14,2) not null default 0,
  travel_allowance numeric(14,2) not null default 0,
  special_allowance numeric(14,2) not null default 0,
  other_allowance numeric(14,2) not null default 0,
  pf_deduction numeric(14,2) not null default 0,
  tax_deduction numeric(14,2) not null default 0,
  paid_holidays_per_month numeric(8,2) not null default 0,
  unpaid_leave_deduction_rate numeric(14,2) not null default 0,
  paid_leave_payout_rate numeric(14,2) not null default 0,
  pay_per_extra_work_day numeric(14,2) not null default 0,
  emergency_contact text,
  status public.employee_status not null default 'active',
  inactive_reason text,
  date_of_leaving date,
  department_id uuid,
  position_id uuid,
  location text,
  bank_account_number text,
  bank_branch_name text,
  bank_branch_address text,
  bank_ifsc_code text,
  aadhaar_number text,
  pan_number text,
  qualifications jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  working_days_of_week jsonb not null default '["Mon","Tue","Wed","Thu","Fri"]'::jsonb,
  reports_to_department_id uuid references public.departments(id) on delete set null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  device_id text,
  device_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  is_head boolean not null default false,
  reports_to_position_id uuid references public.positions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.employees
    add constraint employees_department_id_fkey
    foreign key (department_id) references public.departments(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.employees
    add constraint employees_position_id_fkey
    foreign key (position_id) references public.positions(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- Attendance
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  status public.attendance_status not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, date)
);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  name text not null,
  description text,
  exempt_department_ids jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checkin_logs (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null,
  employee_name text not null,
  department text not null default '',
  kind text not null check (kind in ('check_in', 'check_out')),
  logged_at timestamptz not null,
  date date not null,
  created_at timestamptz not null default now()
);

-- Payroll and employee obligations
create table if not exists public.payrolls (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  period_type public.payroll_period_type not null default 'month',
  basic_salary numeric(14,2) not null default 0,
  hra numeric(14,2) not null default 0,
  travel_allowance numeric(14,2) not null default 0,
  special_allowance numeric(14,2) not null default 0,
  other_allowance numeric(14,2) not null default 0,
  gross numeric(14,2) not null default 0,
  pf_deduction numeric(14,2) not null default 0,
  tax_deduction numeric(14,2) not null default 0,
  loan_deduction numeric(14,2) not null default 0,
  advance_deduction numeric(14,2) not null default 0,
  loss_deduction numeric(14,2) not null default 0,
  unpaid_leave_deduction numeric(14,2) not null default 0,
  paid_leave_payout_amount numeric(14,2) not null default 0,
  paid_leave_final_settlement_amount numeric(14,2) not null default 0,
  net numeric(14,2) not null default 0,
  working_days numeric(8,2) not null default 0,
  present_days numeric(8,2) not null default 0,
  paid_leaves_used numeric(8,2) not null default 0,
  paid_leaves_left numeric(8,2) not null default 0,
  unpaid_leaves numeric(8,2) not null default 0,
  unpaid_leave_deduction_rate numeric(14,2) not null default 0,
  paid_leave_payout_rate numeric(14,2) not null default 0,
  extra_work_days numeric(8,2) not null default 0,
  extra_work_pay numeric(14,2) not null default 0,
  payment_status public.payroll_payment_status default 'generated',
  payment_date date,
  payment_amount numeric(14,2),
  payment_history jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  principal numeric(14,2) not null default 0,
  interest_rate numeric(8,3) not null default 0,
  interest_method public.interest_method not null default 'none',
  months integer not null default 1,
  emi numeric(14,2) not null default 0,
  total_payable numeric(14,2) not null default 0,
  start_date date not null,
  paid_months integer not null default 0,
  status public.loan_status not null default 'active',
  paid_off_date date,
  discount_amount numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  principal numeric(14,2) not null default 0,
  interest_rate numeric(8,3) not null default 0,
  interest_method public.interest_method not null default 'none',
  months integer not null default 1,
  emi numeric(14,2) not null default 0,
  total_payable numeric(14,2) not null default 0,
  start_date date not null,
  paid_months integer not null default 0,
  status public.loan_status not null default 'active',
  paid_off_date date,
  discount_amount numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loan_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  emi_number integer not null,
  due_year integer not null,
  due_month integer not null,
  due_date date not null,
  status public.installment_status not null default 'pending',
  payroll_id uuid references public.payrolls(id) on delete set null,
  amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  skip_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.advance_installments (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.advances(id) on delete cascade,
  emi_number integer not null,
  due_year integer not null,
  due_month integer not null,
  due_date date not null,
  status public.installment_status not null default 'pending',
  payroll_id uuid references public.payrolls(id) on delete set null,
  amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  skip_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loss_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric(14,2) not null default 0,
  reason text not null,
  status public.loss_ded_status not null default 'pending',
  payroll_id uuid references public.payrolls(id) on delete set null,
  deducted_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Employee document metadata. File bytes live in the storage bucket below.
create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  original_name text not null,
  mime_type text not null default 'application/octet-stream',
  size bigint not null default 0,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add HR settings to the dashboard's existing app_settings row.
alter table public.app_settings
  add column if not exists company_name text,
  add column if not exists company_address text,
  add column if not exists attendance_module_enabled boolean not null default false,
  add column if not exists attendance_module_url text,
  add column if not exists attendance_module_key text;

-- Useful indexes
create index if not exists idx_hr_employees_department on public.employees(department_id);
create index if not exists idx_hr_employees_status on public.employees(status);
create index if not exists idx_hr_positions_department on public.positions(department_id);
create index if not exists idx_hr_attendance_date on public.attendance(date);
create index if not exists idx_hr_attendance_employee_date on public.attendance(employee_id, date);
create index if not exists idx_hr_payroll_period on public.payrolls(period_start, period_end);
create index if not exists idx_hr_payroll_employee on public.payrolls(employee_id);
create index if not exists idx_hr_documents_employee on public.employee_documents(employee_id);
create index if not exists idx_hr_loan_installments_due on public.loan_installments(due_date);
create index if not exists idx_hr_advance_installments_due on public.advance_installments(due_date);

-- Keep timestamps current without depending on the target app's trigger name.
create or replace function public.hr_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create trigger hr_employees_updated_at before update on public.employees
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_departments_updated_at before update on public.departments
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_positions_updated_at before update on public.positions
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_attendance_updated_at before update on public.attendance
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_holidays_updated_at before update on public.holidays
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_payrolls_updated_at before update on public.payrolls
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_loans_updated_at before update on public.loans
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_advances_updated_at before update on public.advances
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_loan_installments_updated_at before update on public.loan_installments
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_advance_installments_updated_at before update on public.advance_installments
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_loss_deductions_updated_at before update on public.loss_deductions
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;
do $$ begin
  create trigger hr_employee_documents_updated_at before update on public.employee_documents
  for each row execute function public.hr_set_updated_at();
exception when duplicate_object then null;
end $$;

-- Custom app_users authentication does not create auth.uid() JWTs for browser
-- queries, so HR CRUD policies follow the target app's existing convention.
do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'departments', 'positions', 'attendance', 'holidays',
    'checkin_logs', 'payrolls', 'loans', 'advances', 'loan_installments',
    'advance_installments', 'loss_deductions', 'employee_documents'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "hr anon and authenticated access" on public.%I', t);
    execute format(
      'create policy "hr anon and authenticated access" on public.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- Supabase Storage bucket for employee documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-documents',
  'employee-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "hr employee documents read" on storage.objects;
create policy "hr employee documents read"
on storage.objects for select to anon, authenticated
using (bucket_id = 'employee-documents');

drop policy if exists "hr employee documents upload" on storage.objects;
create policy "hr employee documents upload"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'employee-documents');

drop policy if exists "hr employee documents update" on storage.objects;
create policy "hr employee documents update"
on storage.objects for update to anon, authenticated
using (bucket_id = 'employee-documents')
with check (bucket_id = 'employee-documents');

drop policy if exists "hr employee documents delete" on storage.objects;
create policy "hr employee documents delete"
on storage.objects for delete to anon, authenticated
using (bucket_id = 'employee-documents');

-- Optional: keep the canonical existing settings row usable by HR screens.
insert into public.app_settings (company_name, company_address)
select coalesce((select company_name from public.company limit 1), ''), ''
where not exists (select 1 from public.app_settings);
