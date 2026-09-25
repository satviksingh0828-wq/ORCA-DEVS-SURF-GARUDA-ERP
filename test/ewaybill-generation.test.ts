import assert from "node:assert/strict";
import test from "node:test";

import { isManualEwayBill } from "../src/lib/ewaybill-generation.ts";

test("recognizes the app's manual generation label", () => {
  assert.equal(isManualEwayBill({ generation_mode: "Manual" }), true);
});

test("recognizes the E-Way Bill manual generation code", () => {
  assert.equal(isManualEwayBill({ generation_mode_code: "1" }), true);
});

test("keeps API-generated bills on the API transfer path", () => {
  assert.equal(isManualEwayBill({ generation_mode: "API", generation_mode_code: "2" }), false);
});

test("does not classify missing generation metadata as manual", () => {
  assert.equal(isManualEwayBill({}), false);
});
