import assert from "node:assert/strict";
import test from "node:test";
import { formatConsignmentGst } from "../src/lib/consignment-pdf-format.ts";

test("prints the reference placeholder for every GST rate", () => {
  assert.equal(formatConsignmentGst(0), "---");
  assert.equal(formatConsignmentGst(Number.NaN), "---");
  assert.equal(formatConsignmentGst(18), "---");
  assert.equal(formatConsignmentGst(5.5), "---");
});
