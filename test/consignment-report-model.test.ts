import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSIGNMENT_REPORT_COLUMNS,
  CONSIGNMENT_FINANCIAL_COLUMNS,
  columnsForConsignmentRole,
  restrictConsignmentReportRecord,
  reportSummary,
} from "../src/lib/consignment-report-model.ts";

test("uploaded spreadsheet has all 26 columns in the original order", () => {
  assert.equal(CONSIGNMENT_REPORT_COLUMNS.length, 26);
  assert.equal(new Set(CONSIGNMENT_REPORT_COLUMNS).size, 26);
  assert.deepEqual(CONSIGNMENT_REPORT_COLUMNS.slice(-4),
    ["Rate", "Rate Calculate On", "Freight", "Others Charges"]);
});
test("Basic and viewer roles never receive financial fields, even when values exist", () => {
  for (const role of ["basic", "viewer", "unknown", ""]) {
    const values = restrictConsignmentReportRecord(
      { "Cnmt No.": "JP26CN1551", "Rate": 100, "Freight": 4500, "Others Charges": 50,
        "Rate Calculate On": "WEIGHT", "Transporter Name": "Carrier",
        "Invoice No.": "AJAI261178", "Ref. No.": "1234" }, role);
    assert.equal(columnsForConsignmentRole(role).length, 22);
    for (const header of CONSIGNMENT_FINANCIAL_COLUMNS)
      assert.equal(Object.prototype.hasOwnProperty.call(values, header), false);
    assert.equal(values["Invoice No."], "AJAI261178");
    assert.equal(values["Transporter Name"], "Carrier");
    assert.equal(values["Ref. No."], "1234");
  }
});
test("admins see all 26 columns; blank source values are not manufactured", () => {
  for (const role of ["admin", "semi_admin"]) {
    const values = restrictConsignmentReportRecord(
      { "Cnmt No.": "JP26CN1551", "Freight": 4500 }, role);
    assert.equal(Object.keys(values).length, 26);
    assert.equal(values["Freight"], 4500);
    assert.equal(values["Mark No."], "");
  }
});
test("summary counts only returned records and never invents hidden money", () => {
  assert.deepEqual(reportSummary([
    { "Pkgs": 4, "A. Weight": 32, "C. Weight": 40, "Freight": 200 },
    { "Pkgs": 6, "A. Weight": 83, "C. Weight": 90, "Freight": 300 },
  ]), { packages: 10, actualWeight: 115, chargedWeight: 130,
    freight: 500, otherCharges: 0 });
});
