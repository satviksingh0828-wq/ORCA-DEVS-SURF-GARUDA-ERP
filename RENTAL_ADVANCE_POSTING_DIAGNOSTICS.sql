-- Run in the Supabase SQL editor after applying
-- supabase/migrations/20261001111500_rental_advance_payment_journals.sql.
-- This is read-only; it does not repair or modify financial records.

-- Per-trip posting state, outstanding rental balance, rental liability account,
-- linked trip journal, and latest balance-payment journal.
SELECT
  t.trip_code,
  t.id AS trip_id,
  r.rental_name,
  t.closed,
  t.posted_at,
  t.posted_journal_entry_id AS trip_journal_entry_id,
  trip_je.status AS trip_journal_status,
  a.advance AS paid_amount,
  a.balance AS remaining_balance,
  r.liability_ledger_id,
  liability.account_name AS rental_liability_ledger,
  a.settlement_journal_entry_id AS latest_balance_payment_entry_id,
  payment_je.status AS latest_balance_payment_status
FROM public.trips t
LEFT JOIN public.approval_charge_advances a ON a.trip_id = t.id
LEFT JOIN public.rentals r ON r.id = coalesce(t.rental_id, a.rental_id)
LEFT JOIN public.ledger_accounts liability ON liability.id = r.liability_ledger_id
LEFT JOIN public.journal_entries trip_je ON trip_je.id = t.posted_journal_entry_id
LEFT JOIN public.journal_entries payment_je ON payment_je.id = a.settlement_journal_entry_id
WHERE t.rental_id IS NOT NULL OR a.id IS NOT NULL
ORDER BY t.end_date DESC NULLS LAST, t.trip_code;

-- Inspect the actual journal lines for both the original trip billing journal
-- and rental balance payment journals. A settlement must show Debit on the
-- rental liability ledger and Credit on an active cash/bank ledger.
SELECT
  t.trip_code,
  je.id AS journal_entry_id,
  je.description,
  je.reference,
  je.status,
  jl.line_no,
  jl.line_description,
  la.account_name AS ledger_account,
  la.ledger_type,
  jl.debit,
  jl.credit
FROM public.trips t
LEFT JOIN public.approval_charge_advances a ON a.trip_id = t.id
JOIN public.journal_entries je
  ON je.id = t.posted_journal_entry_id
  OR je.id = a.settlement_journal_entry_id
  OR je.reference LIKE 'ltms:rental-balance:' || a.id::text || ':%'
JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
JOIN public.ledger_accounts la ON la.id = jl.ledger_account_id
WHERE t.rental_id IS NOT NULL OR a.id IS NOT NULL
ORDER BY t.trip_code, je.entry_date, je.id, jl.line_no;

-- Reconcile the posted trip's original liability credit less all balance-payment
-- debits to the current operational balance. A non-zero variance is a signal
-- that the balance was changed without a corresponding rental-liability journal.
WITH trip_liability AS (
  SELECT
    t.id AS trip_id,
    coalesce(
      sum(jl.credit) FILTER (WHERE jl.ledger_account_id = r.liability_ledger_id),
      0
    ) AS trip_liability_credit
  FROM public.trips t
  LEFT JOIN public.rentals r ON r.id = t.rental_id
  LEFT JOIN public.journal_lines jl ON jl.journal_entry_id = t.posted_journal_entry_id
  GROUP BY t.id
), settlement_liability AS (
  SELECT
    a.id AS advance_id,
    coalesce(
      sum(jl.debit) FILTER (WHERE jl.ledger_account_id = r.liability_ledger_id),
      0
    ) AS settlement_liability_debits
  FROM public.approval_charge_advances a
  JOIN public.trips t ON t.id = a.trip_id
  LEFT JOIN public.rentals r ON r.id = coalesce(t.rental_id, a.rental_id)
  LEFT JOIN public.journal_entries je
    ON je.reference LIKE 'ltms:rental-balance:' || a.id::text || ':%'
  LEFT JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
  GROUP BY a.id
)
SELECT
  t.trip_code,
  t.id AS trip_id,
  t.posted_journal_entry_id AS trip_journal_entry_id,
  a.id AS advance_id,
  a.advance,
  a.balance AS operational_balance,
  coalesce(tl.trip_liability_credit, 0) AS trip_liability_credit,
  coalesce(sl.settlement_liability_debits, 0) AS settlement_liability_debits,
  coalesce(tl.trip_liability_credit, 0)
    - coalesce(sl.settlement_liability_debits, 0) AS ledger_balance,
  coalesce(tl.trip_liability_credit, 0)
    - coalesce(sl.settlement_liability_debits, 0)
    - coalesce(a.balance, 0) AS variance,
  CASE
    WHEN t.closed IS TRUE AND t.posted_journal_entry_id IS NULL
      THEN 'CLOSED BUT NOT POSTED'
    WHEN t.posted_journal_entry_id IS NULL
      THEN 'TRIP NOT POSTED YET'
    WHEN r.liability_ledger_id IS NULL
      THEN 'RENTAL LIABILITY LEDGER NOT CONFIGURED'
    WHEN liability.id IS NULL OR liability.is_active IS NOT TRUE OR liability.ledger_type <> 'liability'
      THEN 'RENTAL LIABILITY LEDGER INVALID'
    WHEN abs(
      coalesce(tl.trip_liability_credit, 0)
      - coalesce(sl.settlement_liability_debits, 0)
      - coalesce(a.balance, 0)
    ) > 0.01
      THEN 'LIABILITY LEDGER DOES NOT MATCH ADVANCE BALANCE'
    ELSE 'OK'
  END AS diagnostic
FROM public.trips t
JOIN public.approval_charge_advances a ON a.trip_id = t.id
LEFT JOIN public.rentals r ON r.id = coalesce(t.rental_id, a.rental_id)
LEFT JOIN public.ledger_accounts liability ON liability.id = r.liability_ledger_id
LEFT JOIN trip_liability tl ON tl.trip_id = t.id
LEFT JOIN settlement_liability sl ON sl.advance_id = a.id
ORDER BY t.end_date DESC NULLS LAST, t.trip_code;
