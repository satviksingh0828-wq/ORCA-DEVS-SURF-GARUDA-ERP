-- Fix stale ledger_accounts ledger_type constraint.
-- Required for creating HRMS Salary Payable and Incentive Payable liability ledgers.
begin;

-- Remove any older ledger_type checks, regardless of their generated names.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.ledger_accounts'::regclass
      and contype = 'c'
      and (
        conname = 'ledger_accounts_ledger_type_check'
        or pg_get_constraintdef(oid) ilike '%ledger_type in%'
      )
  loop
    execute format('alter table public.ledger_accounts drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.ledger_accounts
  add constraint ledger_accounts_ledger_type_check
  check (ledger_type in ('asset', 'liability', 'income', 'expenditure', 'bank', 'cash', 'capital'));

commit;

-- Verification:
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.ledger_accounts'::regclass
--   and conname = 'ledger_accounts_ledger_type_check';
