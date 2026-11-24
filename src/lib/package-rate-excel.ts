/** Branch-scoped Package Rate Excel format. The branch comes from the ERP selector. */
export const PACKAGE_RATE_EXCEL_COLUMNS = [
  "Package Type", "Basis", "Charge Mode", "Rate Kind",
  "From", "To", "Amount (INR)", "Status",
] as const;

export type PackageRateBasis = "quantity" | "weight";
export type PackageChargeMode = "rate" | "fixed";
export type PackageRateKind = "loading" | "unloading";
export type ExcelPackageType = {
  id: string;
  package_type: string;
  basis: PackageRateBasis;
  charge_mode: PackageChargeMode;
  is_active: boolean;
};
export type ExcelPackageSlab = {
  id: string;
  package_rate_type_id: string;
  rate_kind: PackageRateKind;
  from_value: number;
  to_value: number | null;
  amount: number;
};
export type PackageRateImportRow = {
  line: number;
  packageType: string;
  basis: PackageRateBasis;
  chargeMode: PackageChargeMode;
  rateKind: PackageRateKind | null;
  from: number | null;
  to: number | null;
  amount: number | null;
  active: boolean;
};
export type PackageRateAction = "create" | "update" | "unchanged";
export type PackageRatePreviewRow = {
  row: PackageRateImportRow;
  action: PackageRateAction;
  message: string;
  error: string | null;
  existingTypeId: string | null;
  existingSlabId: string | null;
};
export type PackageRatePlan = {
  rows: PackageRatePreviewRow[];
  errors: number;
  creates: number;
  updates: number;
  unchanged: number;
  newTypes: number;
};

const normal = (v: unknown) => String(v ?? "").trim().toLowerCase();
const number = (value: unknown, field: string, blankAllowed: boolean): number | null => {
  const raw = String(value ?? "").trim().replace(/,/g, "").replace(/[₹\s]/g, "");
  if (!raw && blankAllowed) return null;
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(field + " must be a non-negative number");
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) throw new Error(field + " must be a non-negative number");
  return num;
};
function name(v: unknown) {
  const str = String(v ?? "").trim();
  if (!str) throw new Error("Package Type is required");
  return str;
}
function choice<T extends string>(value: unknown, values: readonly T[], field: string): T {
  const item = normal(value);
  const found = values.find((v) => v === item);
  if (!found) throw new Error(field + " must be " + values.join(" or "));
  return found;
}
function active(value: unknown) {
  const str = normal(value);
  if (["active", "yes", "true", "1"].includes(str)) return true;
  if (["inactive", "no", "false", "0"].includes(str)) return false;
  throw new Error("Status must be Active or Inactive");
}
export function rangeOverlap(
  aFrom: number, aTo: number | null, bFrom: number, bTo: number | null,
) {
  return aFrom <= (bTo ?? Infinity) && bFrom <= (aTo ?? Infinity);
}
export function rangeKey(from: number, to: number | null) {
  return String(from) + ":" + (to === null ? "INF" : String(to));
}
export function parsePackageRateWorkbook(matrix: unknown[][]): PackageRateImportRow[] {
  if (matrix.length < 2) throw new Error("Excel sheet is empty; add rows below the headings.");
  const heading = matrix[0].map(normal);
  const index = PACKAGE_RATE_EXCEL_COLUMNS.map((col) => {
    const aliases = col === "Amount (INR)" ? ["amount", "amount (₹)", "amount (inr)", "rate/amount"] :
      col === "Status" ? ["active", "status"] : [col.toLowerCase()];
    return heading.findIndex((h) => aliases.includes(h.replace(/ \*$/, "")));
  });
  const missing = PACKAGE_RATE_EXCEL_COLUMNS.filter((column, i) => index[i] < 0);
  if (missing.length) throw new Error("Missing columns: " + missing.join(", "));
  const rows: PackageRateImportRow[] = [];
  const problems: string[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    if (!cells.some((cell) => String(cell ?? "").trim())) continue;
    const read = (j: number) => cells[index[j]] ?? "";
    try {
      const packageType = name(read(0));
      const basis = choice(read(1), ["quantity", "weight"] as const, "Basis");
      const chargeMode = choice(read(2), ["fixed", "rate"] as const, "Charge Mode");
      const rateKindRaw = normal(read(3));
      const rateKind = rateKindRaw
        ? choice(rateKindRaw, ["loading", "unloading"] as const, "Rate Kind")
        : null;
      const from = number(read(4), "From", !rateKind);
      const to = number(read(5), "To", true);
      const amount = number(read(6), "Amount", !rateKind);
      if (rateKind && (from === null || amount === null)) {
        throw new Error("From and Amount are required when Rate Kind is set");
      }
      if (!rateKind && (from !== null || to !== null || amount !== null)) {
        throw new Error("Rate Kind is required when slab values are supplied");
      }
      if (from !== null && to !== null && to < from)
        throw new Error("To must be greater than or equal to From");
      const status = active(read(7));
      rows.push({ line: i + 1, packageType, basis, chargeMode, rateKind,
        from, to, amount, active: status });
    } catch (e) {
      problems.push("Row " + (i + 1) + ": " + (e instanceof Error ? e.message : "Invalid data"));
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 10).join("; ") +
    (problems.length > 10 ? " (+" + (problems.length - 10) + " more)" : ""));
  if (!rows.length) throw new Error("No package rate records found in the workbook.");
  return rows;
}
/** Generates a preview without writes, including existing and in-file overlap checks. */
export function planPackageRateImport(
  rows: PackageRateImportRow[],
  types: ExcelPackageType[],
  slabs: ExcelPackageSlab[],
): PackageRatePlan {
  const existing = new Map(types.map((type) => [normal(type.package_type), type]));
  const seenType = new Map<string, PackageRateImportRow>();
  const seenRanges = new Map<string, Array<{ from: number; to: number | null }>>();
  const result: PackageRatePreviewRow[] = [];

  for (const row of rows) {
    const key = normal(row.packageType);
    const oldType = existing.get(key);
    let error: string | null = null;
    let action: PackageRateAction = "create";
    let existingSlabId: string | null = null;
    const previous = seenType.get(key);
    if (previous && (previous.basis !== row.basis ||
      previous.chargeMode !== row.chargeMode || previous.active !== row.active)) {
      error = "Conflicting Basis, Charge Mode or Status for this package type in Excel";
    }
    if (!previous) seenType.set(key, row);
    if (oldType && (oldType.basis !== row.basis || oldType.charge_mode !== row.chargeMode)) {
      error = "Existing package type has a different Basis / Charge Mode";
    }
    if (row.rateKind && row.from !== null && row.amount !== null) {
      const group = key + "|" + row.rateKind;
      const candidates = seenRanges.get(group) ?? [];
      if (candidates.some((item) => rangeOverlap(item.from, item.to, row.from!, row.to))) {
        error = error || "This slab overlaps another row in the Excel file";
      }
      candidates.push({ from: row.from, to: row.to });
      seenRanges.set(group, candidates);
      const oldSlabs = oldType ? slabs.filter((s) => s.package_rate_type_id === oldType.id &&
        s.rate_kind === row.rateKind) : [];
      const exact = oldSlabs.find((s) => rangeKey(s.from_value, s.to_value) ===
        rangeKey(row.from!, row.to));
      const conflict = oldSlabs.find((s) =>
        s.id !== exact?.id && rangeOverlap(s.from_value, s.to_value, row.from!, row.to));
      if (conflict) error = error ||
        "Overlaps an existing slab (" + conflict.from_value + "–" +
        (conflict.to_value === null ? "∞" : conflict.to_value) + ")";
      if (exact) {
        existingSlabId = exact.id;
        action = Number(exact.amount) === row.amount ? "unchanged" : "update";
      }
    } else if (oldType) {
      action = "unchanged";
    }
    if (oldType && oldType.is_active !== row.active && action === "unchanged") {
      action = "update";
    }
    result.push({
      row, action,
      message: error ? error :
        action === "create" ? (oldType ? "Create slab" : "Create type / slab") :
        action === "update" ? (existingSlabId ? "Update matching slab" : "Update type status") :
        "Already matches",
      error,
      existingTypeId: oldType?.id ?? null,
      existingSlabId,
    });
  }

  const newTypes = new Set(result.filter((item) => !item.error && !item.existingTypeId)
    .map((item) => normal(item.row.packageType))).size;
  return {
    rows: result, errors: result.filter((item) => item.error).length,
    creates: result.filter((item) => !item.error && item.action === "create").length,
    updates: result.filter((item) => !item.error && item.action === "update").length,
    unchanged: result.filter((item) => !item.error && item.action === "unchanged").length,
    newTypes,
  };
}
