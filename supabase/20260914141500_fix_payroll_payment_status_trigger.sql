-- Fix payroll accounting trigger enum handling.
-- The previous trigger used coalesce(new.payment_status, ''), which makes
-- PostgreSQL cast '' to payroll_payment_status and fails before the trigger
-- can ignore a non-paid payroll.
create or replace function public.hrms_payroll_accounting_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_amount numeric;
begin
  if new.payment_status is null
     or new.payment_status not in ('paid'::public.payroll_payment_status, 'partial_paid'::public.payroll_payment_status) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.payment_status is not distinct from old.payment_status
     and new.payment_date is not distinct from old.payment_date
     and new.payment_amount is not distinct from old.payment_amount then
    return new;
  end if;

  v_branch := public.hrms_branch_for_employee(new.employee_id);
  v_amount := coalesce(nullif(new.payment_amount, 0), new.net);
  perform public.hrms_queue_event(
    'payroll_paid',
    new.id,
    v_branch,
    coalesce(new.payment_date, new.period_end),
    v_amount,
    'Salary paid - ' || coalesce(new.period_start, new.period_end)
  );
  return new;
end;
$$;

-- Recreate the trigger in case an older migration did not install it.
do $$
begin
  if to_regclass('public.payrolls') is not null then
    drop trigger if exists payrolls_hrms_accounting on public.payrolls;
    create trigger payrolls_hrms_accounting
      after insert or update of payment_status, payment_date, payment_amount
      on public.payrolls
      for each row execute function public.hrms_payroll_accounting_trigger();
  end if;
end;
$$;
