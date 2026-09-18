import assert from "node:assert/strict";
import test from "node:test";
import { addMonthsMonthEndSafe } from "../src/lib/emi-schedule.ts";

test("keeps a 31 January schedule at month end", () => {
  assert.equal(addMonthsMonthEndSafe("2026-01-31", 0), "2026-01-31");
  assert.equal(addMonthsMonthEndSafe("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsMonthEndSafe("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonthsMonthEndSafe("2026-01-31", 13), "2027-02-28");
});

test("keeps a leap-year month-end schedule at month end", () => {
  assert.equal(addMonthsMonthEndSafe("2028-02-29", 1), "2028-03-31");
  assert.equal(addMonthsMonthEndSafe("2028-02-29", 12), "2029-02-28");
});

test("preserves ordinary dates and clamps only when needed", () => {
  assert.equal(addMonthsMonthEndSafe("2026-01-15", 1), "2026-02-15");
  assert.equal(addMonthsMonthEndSafe("2026-01-30", 1), "2026-02-28");
  assert.equal(addMonthsMonthEndSafe("2026-03-31", -1), "2026-02-28");
});

test("returns an empty string for empty or malformed input", () => {
  assert.equal(addMonthsMonthEndSafe("", 1), "");
  assert.equal(addMonthsMonthEndSafe("not-a-date", 1), "");
});
