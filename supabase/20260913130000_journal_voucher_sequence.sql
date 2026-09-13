-- Use a database-backed sequence for journal voucher numbers.
-- Timestamp-only defaults can collide when automatic and user-posted entries
-- are created in the same millisecond. This migration is safe to re-run.
begin;

create sequence if not exists public.journal_voucher_number_seq
  as bigint
  minvalue 1
  start with 1;

do $$
declare
  v_max bigint;
begin
  select max((substring(voucher_number from '^JV-([0-9]+)$'))::bigint)
    into v_max
    from public.journal_entries
   where voucher_number ~ '^JV-[0-9]+$';

  if v_max is null then
    perform setval('public.journal_voucher_number_seq'::regclass, 1, false);
  else
    perform setval('public.journal_voucher_number_seq'::regclass, v_max, true);
  end if;
end;
$$;

create or replace function public.next_journal_voucher_number()
returns text
language sql
volatile
set search_path = public
as $$
  select 'JV-' || nextval('public.journal_voucher_number_seq'::regclass)::text;
$$;

alter table public.journal_entries
  alter column voucher_number set default public.next_journal_voucher_number();

grant usage, select on sequence public.journal_voucher_number_seq to anon, authenticated;
grant execute on function public.next_journal_voucher_number() to anon, authenticated;

commit;
