create or replace function public.prevent_linked_lr_mutation()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.trip_lorry_receipts where lr_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'LR cannot be deleted while linked to a Trip';
    end if;
    if (to_jsonb(new) - 'part_b_updated_at') is distinct from (to_jsonb(old) - 'part_b_updated_at') then
      raise exception 'LR cannot be edited while linked to a Trip';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_linked_lr_mutation on public.lorry_receipts;
create trigger trg_prevent_linked_lr_mutation
before update or delete on public.lorry_receipts
for each row execute function public.prevent_linked_lr_mutation();
