import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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


test("all report Total rows have one native table cell per logical column", () => {
  const reports: Array<[string, number[]]> = [
    ["ConsignmentIncomeReport.tsx", [11]],
    ["TransporterExpenditureReport.tsx", [14]],
    ["LoadingChargesReport.tsx", [12, 10]],
    ["TripExpenditureReport.tsx", [11]],
  ];
  for (const [report, expected] of reports) {
    const source = readFileSync("src/components/reports/" + report, "utf8");
    const totals = [...source.matchAll(/<tfoot>[\s\S]*?<\/tfoot>/g)].map((match) => match[0]);
    assert.equal(totals.length, expected.length, report + " footer count");
    totals.forEach((footer, i) => {
      assert.equal([...footer.matchAll(/<td\b/g)].length, expected[i],
        report + " footer " + (i + 1) + " must have correct cell count");
      assert.doesNotMatch(footer, /colSpan=/,
        report + " Total labels must not span hidden columns");
    });
  }
});

test("Journal description is abbreviated in Compact and actions stay a native table cell", () => {
  const journal = readFileSync("src/components/accounts/AccountsJournalPage.tsx", "utf8");
  assert.match(journal, /entry\.description\.slice\(0, 32\)\.trimEnd\(\) \+ "\.\.\."/);
  assert.match(journal, /data-table-view-compact-only="true"/);
  assert.match(journal, /data-table-view-complete-only="true"/);
  assert.doesNotMatch(journal, /<td className="flex gap-2 px-4 py-3">/);
  const style = tableViewCss("journal", [1, 2, 3, 4, 6], 6);
  assert.match(style, /data-view-mode="complete".*data-table-view-compact-only/);
  assert.match(style, /text-overflow: ellipsis/);
});
