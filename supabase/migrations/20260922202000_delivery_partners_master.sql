create table if not exists public.delivery_partners (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id) on delete set null,
  delivery_partner_name text not null,
  legal_business_name text default '',
  delivery_partner_type text default '',
  gstin text default '',
  pan text default '',
  msme_udyam text default '',
  tan text default '',
  address_line1 text default '',
  address_line2 text default '',
  city text default '',
  state text default '',
  country text default '',
  pin_code text default '',
  primary_contact_name text default '',
  primary_contact_designation text default '',
  mobile_number text default '',
  alternate_mobile text default '',
  email text default '',
  telephone text default '',
  website text default '',
  bank_name text default '',
  bank_branch text default '',
  bank_account_holder text default '',
  bank_account_number text default '',
  bank_ifsc text default '',
  upi_id text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.delivery_partners to anon, authenticated;
grant all on public.delivery_partners to service_role;
alter table public.delivery_partners enable row level security;
drop policy if exists "app can manage delivery partners" on public.delivery_partners;
create policy "app can manage delivery partners" on public.delivery_partners for all to anon, authenticated using (true) with check (true);
drop trigger if exists trg_delivery_partners_updated on public.delivery_partners;
create trigger trg_delivery_partners_updated before update on public.delivery_partners for each row execute function public.set_updated_at();
