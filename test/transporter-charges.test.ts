import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parsePerConsignmentCharges } from "../src/lib/transporter-charges.ts";

test("transporter charges default to zero and allow positive rupee amounts", () => {
  assert.equal(parsePerConsignmentCharges(""), 0);
  assert.equal(parsePerConsignmentCharges(null), 0);
  assert.equal(parsePerConsignmentCharges("0"), 0);
  assert.equal(parsePerConsignmentCharges("125.50"), 125.5);
  assert.equal(parsePerConsignmentCharges("9999999999.99"), 9999999999.99);
});

test("bad or negative charges are rejected before saving/import", () => {
  for (const invalid of ["-1", "-0.50", "12.345", "abc", "1e3", "1,000", "10000000000"]) {
    assert.throws(() => parsePerConsignmentCharges(invalid), undefined, invalid);
  }
});

test("both transporter masters use the field but Rentals do not inherit it", () => {
  const config = readFileSync("src/components/masters/configs.ts", "utf8");
  assert.match(config, /key: "per_consignment_charges"/);
  assert.match(config, /label: "Per Consignment Charges \(₹\)"/);
  assert.match(config, /LTMS_TRANSPORTER_CONFIG: MasterConfig = \{\s*\.\.\.TRANSPORTER_CONFIG/);
  assert.match(config, /\.filter\(\(section\) => section\.title !== "Commercial charges"\)/);
});

test("SQL adds the numeric field to both transporter tables only", () => {
  const sql = readFileSync("supabase/migrations/20261124192200_transporter_per_consignment_charges.sql", "utf8");
  assert.match(sql, /ALTER TABLE public\.transporters[\s\S]*?per_consignment_charges NUMERIC\(12,2\)/);
  assert.match(sql, /ALTER TABLE public\.ltms_transporters[\s\S]*?per_consignment_charges NUMERIC\(12,2\)/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.rentals/);
  assert.equal((sql.match(/CHECK \(per_consignment_charges >= 0\)/g) ?? []).length, 2);
});

test("transporter forms and Excel imports normalize amounts and validate input", () => {
  const list = readFileSync("src/components/masters/MasterList.tsx", "utf8");
  assert.match(list, /parsePerConsignmentCharges\(editing\.per_consignment_charges\)/);
  assert.match(list, /parsePerConsignmentCharges\(row\.per_consignment_charges\)/);
  assert.match(list, /per_consignment_charges: charge/);
  assert.match(list, /min=\{f\.key === "per_consignment_charges" \? 0 : undefined\}/);
});
