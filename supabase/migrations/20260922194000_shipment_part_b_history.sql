create table if not exists public.shipment_part_b_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  lr_id uuid references public.lorry_receipts(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  eway_bill_number text not null,
  from_place text not null,
  from_state integer not null,
  vehicle_no text not null,
  vehicle_type text not null default 'R',
  trans_mode text not null,
  trans_doc_no text,
  trans_doc_date date,
  reason_code text,
  reason_rem text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id) on delete set null,
  response_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shipment_part_b_history_shipment_idx
  on public.shipment_part_b_history(shipment_id, updated_at desc);

alter table public.shipment_part_b_history enable row level security;
drop policy if exists shipment_part_b_history_app on public.shipment_part_b_history;
create policy shipment_part_b_history_app
  on public.shipment_part_b_history for all to anon, authenticated
  using (true) with check (true);

grant select, insert on public.shipment_part_b_history to anon, authenticated;
grant all on public.shipment_part_b_history to service_role;
