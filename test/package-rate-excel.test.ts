import assert from "node:assert/strict";
import test from "node:test";
import {
  PACKAGE_RATE_EXCEL_COLUMNS, parsePackageRateWorkbook,
  planPackageRateImport, rangeOverlap,
} from "../src/lib/package-rate-excel.ts";

const row = (fields: Partial<{
  type: string; kind: string; from: string; to: string;
  amount: string; status: string; basis: string; mode: string;
}> = {}) => [
  fields.type ?? "Box", fields.basis ?? "quantity", fields.mode ?? "rate",
  fields.kind ?? "loading", fields.from ?? "0", fields.to ?? "",
  fields.amount ?? "10", fields.status ?? "Active",
];
const read = (...rows: unknown[][]) => parsePackageRateWorkbook([
  [...PACKAGE_RATE_EXCEL_COLUMNS], ...rows,
]);

test("Excel template has no Branch column; blank To is infinity (NULL)", () => {
  assert.equal(PACKAGE_RATE_EXCEL_COLUMNS.length, 8);
  assert.equal(PACKAGE_RATE_EXCEL_COLUMNS.includes("Branch" as never), false);
  const parsed = read(row());
  assert.equal(parsed[0].to, null);
  assert.equal(parsed[0].from, 0);
});
test("loading and unloading are independent ranges; different types are independent", () => {
  const rows = read(
    row({ kind: "loading", from: "0", to: "100" }),
    row({ kind: "loading", from: "101", to: "" }),
    row({ kind: "unloading", from: "0", to: "" }),
    row({ type: "Bag", kind: "loading", from: "0", to: "" }),
  );
  const plan = planPackageRateImport(rows, [], []);
  assert.equal(plan.errors, 0);
  assert.equal(plan.newTypes, 2);
});
test("overlap at inclusive endpoints is rejected, including infinity", () => {
  assert.equal(rangeOverlap(0, 100, 100, null), true);
  const plan = planPackageRateImport(read(
    row({ from: "0", to: "100" }),
    row({ from: "100", to: "" }),
  ), [], []);
  assert.equal(plan.errors, 1);
});
test("same slab range updates existing amount; other existing overlaps rejected", () => {
  const type = [{ id: "t", package_type: "Box", basis: "quantity" as const,
    charge_mode: "rate" as const, is_active: true }];
  const slab = [{ id: "s", package_rate_type_id: "t",
    rate_kind: "loading" as const, from_value: 0, to_value: 100, amount: 5 }];
  const updated = planPackageRateImport(read(row({ amount: "12", to: "100" })), type, slab);
  assert.equal(updated.rows[0].action, "update");
  assert.equal(updated.rows[0].existingSlabId, "s");
  assert.equal(updated.errors, 0);
  const overlap = planPackageRateImport(read(row({ from: "50", to: "200" })), type, slab);
  assert.equal(overlap.errors, 1);
});
test("type-only rows preserve empty slab sets and status; bad data rejected", () => {
  const typeOnly = read(["Pallet", "weight", "fixed", "", "", "", "", "Inactive"]);
  assert.equal(typeOnly[0].rateKind, null);
  assert.equal(typeOnly[0].active, false);
  assert.equal(planPackageRateImport(typeOnly, [], []).newTypes, 1);
  assert.throws(() => read(row({ from: "9", to: "4" })), /To must/);
  assert.throws(() => read(row({ status: "Perhaps" })), /Status/);
});
