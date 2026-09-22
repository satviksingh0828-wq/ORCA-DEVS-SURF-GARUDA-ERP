create table if not exists public.branch_eway_credentials (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  api_username text not null,
  encrypted_api_password text not null,
  credential_status text not null default 'configured' check (credential_status in ('configured','disabled','invalid')),
  last_auth_at timestamptz,
  last_auth_error_code text,
  last_auth_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists branch_eway_credentials_status_idx
  on public.branch_eway_credentials (credential_status);

alter table public.branch_eway_credentials enable row level security;
revoke all on public.branch_eway_credentials from anon, authenticated;
grant all on public.branch_eway_credentials to service_role;

create or replace function public.touch_branch_eway_credentials_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_branch_eway_credentials_updated on public.branch_eway_credentials;
create trigger trg_branch_eway_credentials_updated
before update on public.branch_eway_credentials
for each row execute function public.touch_branch_eway_credentials_updated_at();
