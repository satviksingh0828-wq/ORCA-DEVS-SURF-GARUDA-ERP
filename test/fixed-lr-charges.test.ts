import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  fixedLRChargeForConsignment,
  transporterExpenditureAmount,
} from "../src/lib/transporter-charges.ts";

test("one transporter fixed LR charge is added once per third-party consignment", () => {
  assert.equal(fixedLRChargeForConsignment("third_party", "transporter-1", "85.50"), 85.5);
  assert.equal(transporterExpenditureAmount(200, 50, 85.5), 335.5);
  assert.equal(fixedLRChargeForConsignment("THIRD_PARTY", "transporter-1", 85.5), 85.5);
});

test("owned, rental or unassigned consignments never attract the transporter fixed charge", () => {
  assert.equal(fixedLRChargeForConsignment("own", "transporter-1", 100), 0);
  assert.equal(fixedLRChargeForConsignment("rental", "transporter-1", 100), 0);
  assert.equal(fixedLRChargeForConsignment("third_party", null, 100), 0);
  assert.equal(fixedLRChargeForConsignment(null, "transporter-1", 100), 0);
});

test("invalid master amounts are zero, and route rates are not required", () => {
  assert.equal(fixedLRChargeForConsignment("third_party", "a", null), 0);
  assert.equal(fixedLRChargeForConsignment("third_party", "a", NaN), 0);
  assert.equal(fixedLRChargeForConsignment("third_party", "a", -50), 0);
  assert.equal(transporterExpenditureAmount(0, 0, fixedLRChargeForConsignment("third_party", "a", 70)), 70);
});

test("both reports share the fixed-charge calculation; dashboard keeps unposted LR charges separate", () => {
  const transporter = readFileSync("src/components/reports/TransporterExpenditureReport.tsx", "utf8");
  const net = readFileSync("src/components/reports/ConsignmentNetReport.tsx", "utf8");
  const dashboard = readFileSync("src/components/ltms/LtmsDashboard.tsx", "utf8");
  assert.match(transporter, /fixedLRChargeForConsignment\(/);
  assert.match(transporter, /"Fixed LR Charges"/);
  assert.match(net, /fixedLRChargeForConsignment\(/);
  assert.match(net, /fixed_lr_charges: fixedLRCharges/);
  assert.match(dashboard, /transporterFixedLR: sum\.transporterFixedLR \+ row\.fixed_lr_charges/);
  assert.match(dashboard, /const isTransporterPosted =/);
  assert.match(dashboard, /total\.transporterFixedLR \+= isTransporterPosted \? row\.fixed_lr_charges : 0/);
});

test("LTMS mapping exists but is not yet wired into journal postings", () => {
  const mapping = readFileSync("src/components/settings/TMSAccountsSettings.tsx", "utf8");
  const sql = readFileSync("supabase/migrations/20261124201500_fixed_lr_charges_account_mapping.sql", "utf8");
  assert.match(mapping, /fixed_lr_charges_ledger_id\?: string \| null/);
  assert.match(mapping, /\["fixed_lr_charges_ledger_id", "Fixed LR Charges", "expenditure"\]/);
  assert.match(sql, /ALTER TABLE public\.tms_account_ledger_mappings/);
  assert.match(sql, /AFTER INSERT ON public\.tms_account_ledger_mappings/);
  assert.match(sql, /account_name, account_type, description, ledger_type/);
  assert.match(sql, /fixed_lr_charges_ledger_id IS NULL/);
  assert.doesNotMatch(sql, /journal_entries|journal_lines/);
});
