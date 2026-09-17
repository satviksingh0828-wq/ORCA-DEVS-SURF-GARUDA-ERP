-- Reverse direct loan and advance disbursement journals before deleting the record.
-- Matches the existing incentive and loss-deduction reversal behavior.
BEGIN;

CREATE OR REPLACE FUNCTION public.hrms_delete_with_reversal(
  p_record_kind text,
  p_record_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_id uuid;
  v_original_entry uuid;
  v_inst record;
  v_event text;
  v_reference text;
BEGIN
  IF p_record_kind NOT IN ('loan', 'advance', 'incentive', 'loss_deduction') THEN
    RAISE EXCEPTION 'Unsupported HRMS record kind';
  END IF;

  IF p_record_kind IN ('loan', 'advance') THEN
    IF p_record_kind = 'loan' THEN
      v_event := 'loan_given';
      FOR v_inst IN SELECT id, direct_payment_journal_entry_id FROM public.loan_installments WHERE loan_id = p_record_id LOOP
        IF v_inst.direct_payment_journal_entry_id IS NOT NULL THEN
          PERFORM public.hrms_reverse_journal_entry(
            v_inst.direct_payment_journal_entry_id,
            'hrms:reversal:loan-emi:' || v_inst.id::text || ':' || v_inst.direct_payment_journal_entry_id::text,
            'Reversal of loan EMI receipt before loan deletion'
          );
        END IF;
      END LOOP;
      v_reference := 'hrms:loan:' || p_record_id::text;
    ELSE
      v_event := 'advance_given';
      FOR v_inst IN SELECT id, direct_payment_journal_entry_id FROM public.advance_installments WHERE advance_id = p_record_id LOOP
        IF v_inst.direct_payment_journal_entry_id IS NOT NULL THEN
          PERFORM public.hrms_reverse_journal_entry(
            v_inst.direct_payment_journal_entry_id,
            'hrms:reversal:advance-emi:' || v_inst.id::text || ':' || v_inst.direct_payment_journal_entry_id::text,
            'Reversal of advance EMI receipt before advance deletion'
          );
        END IF;
      END LOOP;
      v_reference := 'hrms:advance:' || p_record_id::text;
    END IF;

    -- Reverse the direct disbursement journal created by the loan/advance trigger.
    SELECT id INTO v_original_entry
    FROM public.journal_entries
    WHERE reference = v_reference AND source_module = 'auto';
    IF v_original_entry IS NOT NULL THEN
      PERFORM public.hrms_reverse_journal_entry(
        v_original_entry,
        'hrms:reversal:' || v_reference,
        'Reversal of ' || CASE WHEN p_record_kind = 'loan' THEN 'loan' ELSE 'advance' END || ' before deletion'
      );
    END IF;

    -- Preserve compatibility with records created by the older queue-based implementation.
    SELECT id INTO v_queue_id
    FROM public.hrms_accounting_queue
    WHERE event_type = v_event AND source_id = p_record_id;
    IF v_queue_id IS NOT NULL THEN
      SELECT journal_entry_id INTO v_original_entry
      FROM public.hrms_accounting_queue
      WHERE id = v_queue_id;
      IF v_original_entry IS NOT NULL THEN
        PERFORM public.hrms_reverse_journal_entry(
          v_original_entry,
          'hrms:reversal:' || v_event || ':' || p_record_id::text,
          'Reversal of ' || replace(v_event, '_', ' ') || ' before deletion'
        );
      END IF;
    END IF;

    IF p_record_kind = 'loan' THEN
      DELETE FROM public.loan_installments WHERE loan_id = p_record_id;
      DELETE FROM public.loans WHERE id = p_record_id;
    ELSE
      DELETE FROM public.advance_installments WHERE advance_id = p_record_id;
      DELETE FROM public.advances WHERE id = p_record_id;
    END IF;
    RETURN;
  END IF;

  IF p_record_kind = 'incentive' THEN
    v_reference := 'hrms:incentive:' || p_record_id::text;
    SELECT id INTO v_original_entry
    FROM public.journal_entries
    WHERE reference = v_reference AND source_module = 'auto';
    IF v_original_entry IS NOT NULL THEN
      PERFORM public.hrms_reverse_journal_entry(
        v_original_entry,
        'hrms:reversal:incentive:' || p_record_id::text,
        'Reversal of incentive before deletion'
      );
    END IF;
    DELETE FROM public.incentive_amounts WHERE id = p_record_id;
  ELSE
    v_reference := 'hrms:loss-deduction:' || p_record_id::text;
    SELECT id INTO v_original_entry
    FROM public.journal_entries
    WHERE reference = v_reference AND source_module = 'auto';
    IF v_original_entry IS NOT NULL THEN
      PERFORM public.hrms_reverse_journal_entry(
        v_original_entry,
        'hrms:reversal:loss-deduction:' || p_record_id::text,
        'Reversal of loss deduction before deletion'
      );
    END IF;
    DELETE FROM public.loss_deductions WHERE id = p_record_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hrms_delete_with_reversal(text, uuid) TO anon, authenticated;

COMMIT;
