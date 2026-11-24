import assert from "node:assert/strict";
import test from "node:test";
import { compactCellLayout, tableViewCss } from "../src/lib/table-view-mode-style.ts";

test("Compact fills available width with readable wrapped cells", () => {
  const css = tableViewCss("demo", [1, 3, 6], 10);
  assert.match(css, /table-layout: fixed !important/);
  assert.match(css, /width: 100% !important/);
  assert.match(css, /white-space: normal !important/);
  assert.match(css, /overflow-wrap: anywhere !important/);
  assert.ok(css.includes('data-table-view-hidden="true"'));
  assert.ok(!css.includes("td:nth-child("));
});

test("11-column income report Total row stays beneath kept totals", () => {
  const keep = [1, 2, 3, 7, 8, 9, 11];
  const footer = compactCellLayout([6, 1, 1, 1, 1, 1], keep);
  assert.deepEqual(footer.map((cell) => cell.visibleSpan), [3, 1, 1, 1, 0, 1]);
  assert.equal(footer[4].hidden, true);
  assert.equal(footer[5].hidden, false);
  const data = compactCellLayout(Array(11).fill(1), keep);
  assert.equal(data.filter((cell) => !cell.hidden).length, 7);
});

test("loading report total label and numeric cells recalculate colspan", () => {
  const keep = [1, 2, 3, 4, 6, 7, 10, 11, 12];
  const footer = compactCellLayout([7, 1, 1, 1, 1, 1], keep);
  assert.deepEqual(footer.map((cell) => cell.visibleSpan), [6, 0, 0, 1, 1, 1]);
});

test("empty states and expanded details span the complete compact table", () => {
  const keep = [1, 3, 5, 7];
  assert.equal(compactCellLayout([12], keep)[0].visibleSpan, 4);
  assert.equal(compactCellLayout([12], keep)[0].hidden, false);
  assert.equal(compactCellLayout([6, 1, 1], keep)[0].visibleSpan, 3);
});

test("complete view restores original spans using remembered values", () => {
  const values = compactCellLayout([6, 1, 1], [1, 2, 7]);
  assert.deepEqual(values.map((cell) => cell.span), [6, 1, 1]);
});
