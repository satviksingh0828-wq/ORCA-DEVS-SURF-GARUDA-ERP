import assert from "node:assert/strict";
import test from "node:test";
import { tableViewCss } from "../src/lib/table-view-mode-style.ts";

test("compact style hides secondary columns, not key identifiers", () => {
  const css = tableViewCss("test", [1, 2, 4, 7], 8);
  assert.ok(css.includes("td:nth-child(3)"));
  assert.ok(css.includes("th:nth-child(8)"));
  assert.ok(!css.includes("th:nth-child(7)"));
  assert.ok(!css.includes("th:nth-child(1)"));
  assert.ok(css.includes("tr:not(:has(> td[colspan]))"));
  assert.ok(css.includes("table:not(table table)"));
  assert.ok(css.includes('data-view-mode="compact"'));
  assert.ok(!css.includes('data-view-mode="complete"'));
});
