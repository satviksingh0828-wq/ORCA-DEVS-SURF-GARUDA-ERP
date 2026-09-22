alter table public.lorry_receipts
  add column if not exists part_b_updated_at timestamptz;

create index if not exists lorry_receipts_part_b_updated_at_idx
  on public.lorry_receipts (part_b_updated_at);
