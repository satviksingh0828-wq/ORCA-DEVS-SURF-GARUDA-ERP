-- ORCA Agent durable orchestration state.
-- The ERP uses a custom HMAC session, so access is enforced by the server route
-- and RLS remains closed to browser clients.
create table if not exists public.orca_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  browserbase_session_id text not null unique,
  live_view_url text,
  status text not null default 'active' check (status in ('active', 'released', 'error')),
  context jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists orca_agent_sessions_user_idx
  on public.orca_agent_sessions (user_id, status, last_seen_at desc);

create table if not exists public.orca_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.orca_agent_sessions(id) on delete set null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  instruction text not null,
  status text not null default 'queued' check (status in ('queued', 'pending_approval', 'running', 'completed', 'failed', 'cancelled')),
  result jsonb,
  error text,
  requires_approval boolean not null default false,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists orca_agent_tasks_user_idx
  on public.orca_agent_tasks (user_id, created_at desc);

create table if not exists public.orca_agent_events (
  id bigint generated always as identity primary key,
  task_id uuid references public.orca_agent_tasks(id) on delete cascade,
  session_id uuid references public.orca_agent_sessions(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orca_agent_events_task_idx
  on public.orca_agent_events (task_id, created_at);

alter table public.orca_agent_sessions enable row level security;
alter table public.orca_agent_tasks enable row level security;
alter table public.orca_agent_events enable row level security;

revoke all on public.orca_agent_sessions from anon, authenticated;
revoke all on public.orca_agent_tasks from anon, authenticated;
revoke all on public.orca_agent_events from anon, authenticated;
