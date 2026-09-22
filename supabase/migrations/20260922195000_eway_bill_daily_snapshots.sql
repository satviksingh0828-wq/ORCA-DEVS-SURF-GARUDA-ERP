alter table public.branches
  add column if not exists eway_auto_fetch_enabled boolean not null default false;

create table if not exists public.eway_bill_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  snapshot_date date not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  fetched_at timestamptz,
  ewb_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  unique (branch_id, snapshot_date)
);

create table if not exists public.eway_bill_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  snapshot_date date not null,
  ewb_number text not null,
  invoice_number text,
  generated_by text,
  destination text,
  valid_until text,
  status text,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (branch_id, snapshot_date, ewb_number)
);

create index if not exists eway_bill_daily_snapshots_date_idx
  on public.eway_bill_daily_snapshots(branch_id, snapshot_date desc);

alter table public.eway_bill_fetch_runs enable row level security;
alter table public.eway_bill_daily_snapshots enable row level security;
drop policy if exists eway_bill_fetch_runs_app on public.eway_bill_fetch_runs;
drop policy if exists eway_bill_daily_snapshots_app on public.eway_bill_daily_snapshots;
create policy eway_bill_fetch_runs_app on public.eway_bill_fetch_runs for all to anon, authenticated using (true) with check (true);
create policy eway_bill_daily_snapshots_app on public.eway_bill_daily_snapshots for all to anon, authenticated using (true) with check (true);

grant select, insert, update on public.eway_bill_fetch_runs to anon, authenticated;
grant select, insert, update on public.eway_bill_daily_snapshots to anon, authenticated;
grant all on public.eway_bill_fetch_runs to service_role;
grant all on public.eway_bill_daily_snapshots to service_role;
