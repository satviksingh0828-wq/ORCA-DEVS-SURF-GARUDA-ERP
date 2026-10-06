BEGIN;

ALTER TABLE public.stock_inward_receipts
  ADD COLUMN IF NOT EXISTS unloading_received_payment_ledger_id UUID
    REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unloading_received_journal_entry_id UUID
    REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS unloading_received_by UUID
    REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unloading_received_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS stock_inward_unloading_received_journal_unique
  ON public.stock_inward_receipts(unloading_received_journal_entry_id)
  WHERE unloading_received_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_inward_unloading_received_pending_idx
  ON public.stock_inward_receipts(branch_id, unloading_date DESC)
  WHERE unloading_amount_received > 0 AND unloading_received_journal_entry_id IS NULL;

CREATE OR REPLACE FUNCTION public.prevent_posted_stock_inward_unloading_receipt_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.unloading_received_journal_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'A Stock Inward receipt with a posted unloading receipt cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.unloading_received_journal_entry_id IS NOT NULL
     AND (
       NEW.unloading_amount_received IS DISTINCT FROM OLD.unloading_amount_received
       OR NEW.unloading_received_payment_ledger_id IS DISTINCT FROM OLD.unloading_received_payment_ledger_id
       OR NEW.unloading_received_journal_entry_id IS DISTINCT FROM OLD.unloading_received_journal_entry_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     ) THEN
    RAISE EXCEPTION 'A posted unloading receipt is locked; reverse it through accounting before changing it';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_posted_stock_inward_unloading_receipt_mutation
  ON public.stock_inward_receipts;
CREATE TRIGGER prevent_posted_stock_inward_unloading_receipt_mutation
  BEFORE UPDATE OR DELETE ON public.stock_inward_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_posted_stock_inward_unloading_receipt_mutation();

CREATE OR REPLACE FUNCTION public.post_stock_inward_unloading_received(
  p_receipt_id UUID,
  p_payment_ledger_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.stock_inward_receipts%ROWTYPE;
  v_payment public.ledger_accounts%ROWTYPE;
  v_journal_id UUID;
  v_total_income NUMERIC(14,2) := 0;
  v_source_count INTEGER := 0;
  v_all_accounts_valid BOOLEAN := false;
  v_remaining NUMERIC(14,2);
  v_allocation NUMERIC(14,2);
  v_index INTEGER := 0;
  v_line_no INTEGER := 1;
  v_source RECORD;
BEGIN
  SELECT * INTO v_receipt
  FROM public.stock_inward_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock Inward receipt not found'; END IF;
  IF coalesce(v_receipt.unloading_amount_received, 0) <= 0 THEN
    RAISE EXCEPTION 'Unloading Amount Received must be greater than zero';
  END IF;
  IF v_receipt.unloading_received_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This unloading receipt has already been posted';
  END IF;

  SELECT * INTO v_payment
  FROM public.ledger_accounts
  WHERE id = p_payment_ledger_id
    AND branch_id = v_receipt.branch_id
    AND is_active
    AND ledger_type IN ('cash', 'bank');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select an active Cash or Bank account from this receipt branch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stock_inward_sources s
    WHERE s.receipt_id = v_receipt.id
  ) THEN
    RAISE EXCEPTION 'This receipt has no linked source';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stock_inward_packages p
    WHERE p.receipt_id = v_receipt.id
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_inward_sources s
        WHERE s.receipt_id = p.receipt_id AND s.source_id = p.source_id
      )
  ) THEN
    RAISE EXCEPTION 'Every package source must be linked to the Stock Inward receipt';
  END IF;

  -- Match Source Billing's unloading slab calculation, grouped per source.
  -- The actual received amount is split across each source's mapped unloading
  -- income ledger in proportion to that source's calculated package-rate income.
  SELECT count(*),
         coalesce(sum(source_income), 0),
         coalesce(bool_and(account_valid), false)
  INTO v_source_count, v_total_income, v_all_accounts_valid
  FROM (
    SELECT p.source_id,
           round(coalesce(sum(
             CASE
               WHEN t.charge_mode = 'rate' THEN coalesce(slab.amount, 0) *
                 CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
               ELSE coalesce(slab.amount, 0)
             END
           ), 0), 2) AS source_income,
           bool_or(l.id IS NOT NULL) AS account_valid
    FROM public.stock_inward_packages p
    JOIN public.package_rate_types t ON t.id = p.package_rate_type_id
    JOIN public.contracts c ON c.id = p.source_id AND c.branch_id = v_receipt.branch_id
    LEFT JOIN LATERAL (
      SELECT e.amount
      FROM public.package_rate_entries e
      WHERE e.package_rate_type_id = p.package_rate_type_id
        AND e.rate_kind = 'unloading'
        AND e.from_value <= CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
        AND (e.to_value IS NULL OR CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END <= e.to_value)
      ORDER BY e.from_value DESC
      LIMIT 1
    ) slab ON true
    LEFT JOIN public.ledger_accounts l
      ON l.id = c.unloading_income_ledger_id
      AND l.branch_id = v_receipt.branch_id
      AND l.is_active
      AND l.ledger_type = 'income'
    WHERE p.receipt_id = v_receipt.id
    GROUP BY p.source_id
    HAVING round(coalesce(sum(
      CASE
        WHEN t.charge_mode = 'rate' THEN coalesce(slab.amount, 0) *
          CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
        ELSE coalesce(slab.amount, 0)
      END
    ), 0), 2) > 0
  ) source_income_rows;

  IF v_source_count = 0 OR v_total_income <= 0 THEN
    RAISE EXCEPTION 'No calculated unloading income was found for this receipt';
  END IF;
  IF NOT v_all_accounts_valid THEN
    RAISE EXCEPTION 'Map an active Unloading Income account for every source on this receipt before posting';
  END IF;

  INSERT INTO public.journal_entries(
    entry_date, branch_id, description, reference, source_module, status, approved_at, created_by
  ) VALUES (
    coalesce(v_receipt.unloading_date, v_receipt.receipt_date),
    v_receipt.branch_id,
    'Unloading amount received - ' || coalesce(v_receipt.receipt_number, v_receipt.id::TEXT),
    'stock_inward_unloading_received:' || v_receipt.id,
    'ltms', 'approved', now(), p_created_by
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines(
    journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
    line_description, debit, credit
  ) VALUES (
    v_journal_id, v_line_no, v_receipt.branch_id, v_payment.id, v_payment.account_kind,
    'Cash/Bank received - ' || coalesce(v_receipt.receipt_number, v_receipt.id::TEXT),
    round(v_receipt.unloading_amount_received, 2), 0
  );

  v_remaining := round(v_receipt.unloading_amount_received, 2);
  FOR v_source IN
    SELECT p.source_id,
           c.contract_name,
           c.unloading_income_ledger_id,
           l.account_kind,
           round(coalesce(sum(
             CASE
               WHEN t.charge_mode = 'rate' THEN coalesce(slab.amount, 0) *
                 CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
               ELSE coalesce(slab.amount, 0)
             END
           ), 0), 2) AS source_income
    FROM public.stock_inward_packages p
    JOIN public.package_rate_types t ON t.id = p.package_rate_type_id
    JOIN public.contracts c ON c.id = p.source_id AND c.branch_id = v_receipt.branch_id
    JOIN public.ledger_accounts l
      ON l.id = c.unloading_income_ledger_id
      AND l.branch_id = v_receipt.branch_id
      AND l.is_active
      AND l.ledger_type = 'income'
    LEFT JOIN LATERAL (
      SELECT e.amount
      FROM public.package_rate_entries e
      WHERE e.package_rate_type_id = p.package_rate_type_id
        AND e.rate_kind = 'unloading'
        AND e.from_value <= CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
        AND (e.to_value IS NULL OR CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END <= e.to_value)
      ORDER BY e.from_value DESC
      LIMIT 1
    ) slab ON true
    WHERE p.receipt_id = v_receipt.id
    GROUP BY p.source_id, c.contract_name, c.unloading_income_ledger_id, l.account_kind
    HAVING round(coalesce(sum(
      CASE
        WHEN t.charge_mode = 'rate' THEN coalesce(slab.amount, 0) *
          CASE WHEN t.basis = 'weight' THEN coalesce(p.weight_kg, 0) ELSE coalesce(p.quantity, 0) END
        ELSE coalesce(slab.amount, 0)
      END
    ), 0), 2) > 0
    ORDER BY p.source_id
  LOOP
    v_index := v_index + 1;
    IF v_index = v_source_count THEN
      v_allocation := v_remaining;
    ELSE
      v_allocation := least(
        v_remaining,
        round(v_receipt.unloading_amount_received * v_source.source_income / v_total_income, 2)
      );
    END IF;

    IF v_allocation > 0 THEN
      v_line_no := v_line_no + 1;
      INSERT INTO public.journal_lines(
        journal_entry_id, line_no, branch_id, ledger_account_id, account_kind,
        line_description, debit, credit
      ) VALUES (
        v_journal_id, v_line_no, v_receipt.branch_id, v_source.unloading_income_ledger_id,
        v_source.account_kind,
        'Unloading income received - ' || coalesce(v_source.contract_name, 'Source') || ' / ' ||
          coalesce(v_receipt.receipt_number, v_receipt.id::TEXT),
        0, v_allocation
      );
      v_remaining := round(v_remaining - v_allocation, 2);
    END IF;
  END LOOP;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Could not allocate the full unloading receipt amount';
  END IF;
  PERFORM public.validate_journal_entry(v_journal_id);

  UPDATE public.stock_inward_receipts
  SET unloading_received_payment_ledger_id = p_payment_ledger_id,
      unloading_received_journal_entry_id = v_journal_id,
      unloading_received_by = p_created_by,
      unloading_received_at = now()
  WHERE id = v_receipt.id;

  RETURN v_journal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_stock_inward_unloading_received(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_inward_unloading_received(UUID, UUID, UUID)
  TO service_role;

COMMIT;
