import assert from "node:assert/strict";
import test from "node:test";
import { formatConsignmentGst } from "../src/lib/consignment-pdf-format.ts";

test("prints the reference placeholder when GST is zero", () => {
  assert.equal(formatConsignmentGst(0), "---");
  assert.equal(formatConsignmentGst(Number.NaN), "---");
});

test("keeps non-zero GST rates as percentages", () => {
  assert.equal(formatConsignmentGst(18), "18.00%");
  assert.equal(formatConsignmentGst(5.5), "5.50%");
});
