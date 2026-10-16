-- LTMS Workbook manual-sheet storage.
-- Run this script in the Supabase SQL editor as a database owner.
-- Workbook API calls use the application's server-side service-role client after
-- validating the signed application session and current active admin role.

begin;

create table if not exists public.ltms_workbook_sheets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  owner_id uuid not null references public.app_users(id) on delete cascade,
  is_shared boolean not null default false,
  sheet_data jsonb not null default '{}'::jsonb,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ltms_workbook_sheet_data_object check (jsonb_typeof(sheet_data) = 'object'),
  constraint ltms_workbook_sheet_name_trimmed check (name = btrim(name))
);

create index if not exists ltms_workbook_sheets_owner_updated_idx
  on public.ltms_workbook_sheets (owner_id, updated_at desc);

create index if not exists ltms_workbook_sheets_shared_updated_idx
  on public.ltms_workbook_sheets (updated_at desc)
  where is_shared = true;

alter table public.ltms_workbook_sheets enable row level security;

-- This application authenticates through its own signed user_sessions tokens,
-- not Supabase Auth JWTs. Never expose these records to direct browser queries.
revoke all on table public.ltms_workbook_sheets from public, anon, authenticated;
grant select, insert, update, delete on table public.ltms_workbook_sheets to service_role;

drop policy if exists ltms_workbook_sheets_no_direct_client_access
  on public.ltms_workbook_sheets;
create policy ltms_workbook_sheets_no_direct_client_access
  on public.ltms_workbook_sheets
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
