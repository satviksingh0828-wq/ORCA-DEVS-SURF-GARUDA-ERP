import assert from "node:assert/strict";
import test from "node:test";
import { formatConsignmentGst } from "../src/lib/consignment-pdf-format.ts";

test("shows real tax rates, but never invents a missing GST rate", () => {
  assert.equal(formatConsignmentGst(0), "---");
  assert.equal(formatConsignmentGst(Number.NaN), "---");
  assert.equal(formatConsignmentGst(), "---");
  assert.equal(formatConsignmentGst(18), "18.00%");
  assert.equal(formatConsignmentGst(5.5), "5.50%");
});
