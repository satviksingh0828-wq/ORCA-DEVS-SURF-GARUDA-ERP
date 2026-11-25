import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261125093000_billed_charge_locks_and_fixed_lr_posting.sql", "utf8",
);
const billing = readFileSync("src/components/reports/TransporterBilling.tsx", "utf8");
const expense = readFileSync("src/components/reports/TransporterExpenditureReport.tsx", "utf8");
const net = readFileSync("src/components/reports/ConsignmentNetReport.tsx", "utf8");
const loading = readFileSync("src/components/reports/LoadingChargesReport.tsx", "utf8");

test("Fixed LR Charges are snapshotted on a consignment and cannot follow master changes", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS fixed_lr_charges NUMERIC\(14,2\)/);
  assert.match(migration, /UPDATE public\.consignments c[\s\S]*?WHEN c\.transporter_bill_id IS NOT NULL THEN 0/);
  assert.match(migration, /snapshot_and_lock_consignment_charges/);
  assert.match(migration, /OLD\.fixed_lr_charges IS NOT NULL[\s\S]*?NEW\.fixed_lr_charges IS DISTINCT FROM OLD\.fixed_lr_charges/);
  assert.match(migration, /SELECT round\(coalesce\(per_consignment_charges, 0\), 2\)/);
  assert.match(migration, /v_consign\.fixed_lr_charges/);
  assert.match(expense, /row\.consignment_type, row\.transporter_id, row\.fixed_lr_charges/);
  assert.match(net, /row\.consignment_type, row\.transporter_id, row\.fixed_lr_charges/);
});

test("Transporter bills store the fixed snapshot and post a balanced third expenditure debit", () => {
  assert.match(migration, /total_fixed_lr NUMERIC\(14,2\) NOT NULL DEFAULT 0/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS fixed_lr_charges NUMERIC\(14,2\) NOT NULL DEFAULT 0/);
  assert.match(migration, /sum\(coalesce\(c\.fixed_lr_charges, 0\)\)/);
  assert.match(migration, /v_source\.liability_ledger_id[\s\S]*?round\(v_freight \+ v_loading \+ v_fixed, 2\)/);
  assert.match(migration, /'Fixed LR Charges expenditure - transporter bill', round\(v_fixed, 2\), 0/);
  assert.match(migration, /PERFORM public\.validate_journal_entry\(v_journal\)/);
  assert.match(migration, /Map an active Fixed LR Charges expenditure ledger/);
});

test("Bill-side adjustments are saved before the bill locks a consignment", () => {
  const adjust = migration.indexOf("UPDATE public.consignments\n    SET freight_deduction");
  const billed = migration.indexOf("UPDATE public.consignments SET transporter_bill_id = v_bill_id");
  assert.ok(adjust > 0 && billed > adjust, "Adjustment save must happen before bill link");
  assert.match(migration, /Submitted final Freight or Loading does not match the adjustments/);
  assert.match(migration, /This consignment has already been billed; financial adjustments are locked/);
});

test("Billed package edits and workmen adjustments are blocked in the database", () => {
  for (const marker of [
    "prevent_billed_consignment_package_changes",
    "lock_workmen_inward_adjustments",
    "lock_workmen_outward_adjustments",
    "prevent_workmen_billed_inward_package_changes",
    "prevent_workmen_billed_outward_package_changes",
    "prevent_workmen_bill_charge_edit",
    "prevent_posted_workmen_bill_adjustments",
    "prevent_ltms_transporter_bill_item_changes",
  ]) assert.ok(migration.includes(marker), "Missing lock: " + marker);
  assert.match(migration, /charge_adjustments_locked_at TIMESTAMPTZ/);
  assert.match(migration, /workmen_adjustments_locked_at TIMESTAMPTZ/);
});

test("Payment amount and full-paid status include Fixed LR Charges", () => {
  assert.match(migration, /paid_amount <= total_freight \+ total_loading \+ total_fixed_lr/);
  assert.match(migration, /coalesce\(NEW\.total_fixed_lr, 0\)/);
  assert.match(migration, /coalesce\(v_bill\.total_fixed_lr, 0\)/);
  assert.match(billing, /const billTotal = /);
  assert.match(billing, /num\(bill\.total_fixed_lr\)/);
  assert.match(billing, /amount: previewTotals\.freight \+ previewTotals\.loading \+ previewTotals\.fixed/);
  assert.match(billing, /fixed_lr_charges: num\(row\.fixed_lr_charges\)/);
});

test("Report and billing adjustment controls visibly lock billed rows", () => {
  assert.match(expense, /Billed — adjustments are locked/);
  assert.match(expense, /editing\.charge_adjustments_locked_at/);
  assert.match(loading, /Billed consignment loading charges are locked/);
  assert.match(loading, /Workmen-billed unloading charges are locked/);
  assert.match(billing, /disabled=\{Boolean\(line\.charge_adjustments_locked_at\)\}/);
  assert.match(billing, /Saved on consignment — cannot be edited/);
});
