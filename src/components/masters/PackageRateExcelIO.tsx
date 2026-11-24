import { useRef, useState } from "react";
import { Check, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import {
  PACKAGE_RATE_EXCEL_COLUMNS, parsePackageRateWorkbook, planPackageRateImport,
  type ExcelPackageType, type ExcelPackageSlab, type PackageRateImportRow,
  type PackageRatePlan,
} from "@/lib/package-rate-excel";

type RateData = {
  types: ExcelPackageType[];
  slabs: ExcelPackageSlab[];
};
type ImportPreview = {
  branchId: string;
  filename: string;
  input: PackageRateImportRow[];
  plan: PackageRatePlan;
};

const db = supabase as any;
const normal = (s: string) => s.trim().toLowerCase();
const branchFilename = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
function renderExcel(rows: unknown[][], sheetName = "Package Rates") {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [25, 16, 18, 17, 14, 14, 18, 16].map((wch) => ({ wch }));
  worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: 7 },
  }) };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
}
async function loadBranchPackageRates(branchId: string): Promise<RateData> {
  if (!branchId) throw new Error("Select a branch first.");
  const [types, slabs] = await Promise.all([
    fetchAll<ExcelPackageType>(() => db.from("package_rate_types")
      .select("id,package_type,basis,charge_mode,is_active")
      .eq("branch_id", branchId).order("package_type")),
    fetchAll<ExcelPackageSlab>(() => db.from("package_rate_entries")
      .select("id,package_rate_type_id,rate_kind,from_value,to_value,amount")
      .eq("branch_id", branchId).not("package_rate_type_id", "is", null)
      .order("from_value")),
  ]);
  return { types, slabs };
}
function exportRows(data: RateData) {
  const rows: unknown[][] = [[...PACKAGE_RATE_EXCEL_COLUMNS]];
  const sorted = [...data.types].sort((a, b) => a.package_type.localeCompare(b.package_type));
  for (const type of sorted) {
    const matching = data.slabs.filter((slab) => slab.package_rate_type_id === type.id)
      .sort((a, b) => a.rate_kind.localeCompare(b.rate_kind) || a.from_value - b.from_value);
    const status = type.is_active ? "Active" : "Inactive";
    if (!matching.length) {
      rows.push([type.package_type, type.basis, type.charge_mode, "", "", "", "", status]);
    } else {
      for (const slab of matching)
        rows.push([type.package_type, type.basis, type.charge_mode, slab.rate_kind,
          slab.from_value, slab.to_value ?? "", slab.amount, status]);
    }
  }
  return rows;
}
function writeWorkbook(workbook: XLSX.WorkBook, name: string) {
  XLSX.writeFile(workbook, name + ".xlsx");
}
const previewSignature = (plan: PackageRatePlan) => JSON.stringify(plan.rows.map((row) => ({
  line: row.row.line, action: row.action, error: row.error,
  typeId: row.existingTypeId, slabId: row.existingSlabId,
})));

export function PackageRateExcelIO({
  branchId,
  branchName,
  canImport,
  onImported,
}: {
  branchId: string;
  branchName: string;
  canImport: boolean;
  onImported: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"template" | "export" | "preview" | "apply" | null>(null);
  const filePrefix = branchFilename(branchName || "branch") + "-package-rates";

  async function download(template: boolean) {
    setBusy(template ? "template" : "export");
    try {
      const rows = template
        ? [[...PACKAGE_RATE_EXCEL_COLUMNS]]
        : exportRows(await loadBranchPackageRates(branchId));
      const workbook = renderExcel(rows);
      if (template) {
        const notes = XLSX.utils.aoa_to_sheet([
          ["PACKAGE RATE IMPORT INSTRUCTIONS"],
          ["Branch", "Select the branch in LTMS → Masters → Package Rate before importing. No Branch column is needed."],
          ["Package Type", "Create or reuse a type from the selected branch."],
          ["Basis", "quantity or weight (KG)"],
          ["Charge Mode", "fixed or rate"],
          ["Rate Kind", "loading or unloading"],
          ["From", "Inclusive numeric lower bound, 0 or above"],
          ["To", "Inclusive upper bound; leave BLANK for infinity (no limit)."],
          ["Amount (INR)", "Non-negative amount in rupees"],
          ["Status", "Active or Inactive; must be consistent for the same package type."],
          ["Existing slabs", "Exact matching range updates the amount; overlapping ranges are rejected."],
          ["Import", "First sheet only is imported. Preview and confirm before saving."],
        ]);
        notes["!cols"] = [{ wch: 23 }, { wch: 100 }];
        XLSX.utils.book_append_sheet(workbook, notes, "Instructions");
        const examples = renderExcel([
          [...PACKAGE_RATE_EXCEL_COLUMNS],
          ["Box", "quantity", "rate", "loading", 0, 100, 10, "Active"],
          ["Box", "quantity", "rate", "loading", 101, "", 8, "Active"],
          ["Box", "quantity", "rate", "unloading", 0, "", 7, "Active"],
        ], "Examples");
        XLSX.utils.book_append_sheet(workbook, examples.Sheets.Examples, "Examples");
      }
      writeWorkbook(workbook, filePrefix + (template ? "-template" :
        "-export-" + new Date().toISOString().slice(0, 10)));
      if (!template && rows.length === 1) toast.info("This branch has no package rates to export.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to export Package Rates.");
    } finally {
      setBusy(null);
    }
  }

  async function previewFile(file: File) {
    setBusy("preview");
    setPreview(null);
    try {
      if (!canImport) throw new Error("Only administrators can import package rates.");
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Choose an Excel .xlsx or .xls file.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("Excel workbook has no first sheet.");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet,
        { header: 1, raw: false, defval: "", blankrows: false });
      const inputRows = parsePackageRateWorkbook(matrix);
      const data = await loadBranchPackageRates(branchId);
      const plan = planPackageRateImport(inputRows, data.types, data.slabs);
      setPreview({ branchId, filename: file.name, input: inputRows, plan });
      if (plan.errors) toast.warning(
        plan.errors + " invalid/overlapping row(s). Correct the Excel file before importing.");
      else toast.success("Preview ready. Confirm to save " + inputRows.length + " row(s) to " + branchName + ".");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read Package Rates Excel.");
    } finally {
      setBusy(null);
    }
  }

  async function applyImport() {
    if (!preview || busy || preview.plan.errors) return;
    if (!canImport || !branchId || preview.branchId !== branchId) {
      toast.error("Branch changed or import permission unavailable. Preview the Excel file again.");
      setPreview(null);
      return;
    }
    setBusy("apply");
    let saved = 0;
    try {
      // Revalidate immediately before writing; prevents overwriting a rate
      // that was modified by another user after the preview was generated.
      const latest = await loadBranchPackageRates(branchId);
      const rechecked = planPackageRateImport(preview.input, latest.types, latest.slabs);
      if (rechecked.errors || previewSignature(rechecked) !== previewSignature(preview.plan)) {
        setPreview({ ...preview, plan: rechecked });
        throw new Error("Package rates changed since preview. Review the updated preview first.");
      }
      const typesByName = new Map(latest.types.map((t) => [normal(t.package_type), t]));
      const handledTypes = new Set<string>();
      for (const item of rechecked.rows) {
        const record = item.row;
        const key = normal(record.packageType);
        let type = typesByName.get(key);
        if (!type) {
          const { data, error } = await db.from("package_rate_types").insert({
            branch_id: branchId,
            package_type: record.packageType,
            basis: record.basis,
            charge_mode: record.chargeMode,
            is_active: record.active,
            inactive_at: record.active ? null : new Date().toISOString(),
          }).select("id,package_type,basis,charge_mode,is_active").single();
          if (error || !data) throw new Error("Row " + record.line + " (package type): " +
            (error?.message ?? "Unable to create type"));
          type = data as ExcelPackageType;
          typesByName.set(key, type);
          saved += 1;
        }
        if (!handledTypes.has(key)) {
          handledTypes.add(key);
          if (type.is_active !== record.active) {
            const { error } = await db.from("package_rate_types")
              .update({
                is_active: record.active,
                inactive_at: record.active ? null : new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", type.id).eq("branch_id", branchId);
            if (error) throw new Error("Row " + record.line + " (status): " + error.message);
            type.is_active = record.active;
            saved += 1;
          }
        }
        if (!record.rateKind || record.from === null || record.amount === null) continue;
        if (item.action === "unchanged") continue;
        const payload = {
          branch_id: branchId, package_rate_type_id: type.id,
          package_type: type.package_type, basis: type.basis,
          charge_mode: type.charge_mode, rate_kind: record.rateKind,
          from_value: record.from, to_value: record.to,
          amount: record.amount, updated_at: new Date().toISOString(),
        };
        const query = item.existingSlabId
          ? db.from("package_rate_entries").update(payload)
            .eq("id", item.existingSlabId).eq("branch_id", branchId)
          : db.from("package_rate_entries").insert(payload);
        const { error } = await query;
        if (error) throw new Error("Row " + record.line + " (" + record.packageType + "): " +
          error.message);
        saved += 1;
      }
      toast.success("Package Rate import completed for " + branchName + ": " + saved +
        " database change(s), " + rechecked.unchanged + " unchanged row(s).");
      setPreview(null);
    } catch (error) {
      toast.error((error instanceof Error ? error.message : "Package Rate import failed") +
        (saved ? " (" + saved + " earlier change(s) may have been saved.)" : ""));
    } finally {
      setBusy(null);
      // Always refresh actual DB state, including in partial-failure cases.
      await onImported();
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Excel — {branchName}</p>
          <p className="text-xs text-muted-foreground">
            Import and export apply only to this branch. No Branch column in Excel.
            Blank To = infinity (∞).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" className="sr-only" accept=".xlsx,.xls"
            aria-label="Import Package Rate Excel"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void previewFile(file);
            }} />
          <Button size="sm" variant="outline" type="button" disabled={Boolean(busy)}
            onClick={() => void download(true)}>
            <FileSpreadsheet className="size-4" /> Excel Template
          </Button>
          {canImport && <Button size="sm" variant="outline" type="button" disabled={Boolean(busy)}
            onClick={() => input.current?.click()}>
            <Upload className="size-4" /> Import Excel
          </Button>}
          <Button size="sm" variant="outline" type="button" disabled={Boolean(busy)}
            onClick={() => void download(false)}>
            <Download className="size-4" /> Export Excel
          </Button>
        </div>
      </div>
      {busy && <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {busy === "apply" ?
          "Saving package rates…" : "Processing Excel…"}
      </p>}
      {preview && (
        <section className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Import preview · {preview.filename}</p>
              <p className="text-xs text-muted-foreground">
                Branch: {branchName} · {preview.plan.newTypes} new type(s) ·
                {" "}{preview.plan.creates} create · {preview.plan.updates} update ·
                {" "}{preview.plan.unchanged} unchanged · {preview.plan.errors} errors
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" type="button" disabled={Boolean(busy)}
                onClick={() => setPreview(null)}><X className="size-4" /> Cancel</Button>
              <Button size="sm" type="button"
                disabled={Boolean(busy) || Boolean(preview.plan.errors)}
                onClick={() => void applyImport()}>
                <Check className="size-4" /> Confirm Import
              </Button>
            </div>
          </div>
          {preview.plan.errors > 0 && (
            <p className="text-xs font-medium text-destructive">
              Resolve all invalid or overlapping rows before saving. Nothing is saved during preview.
            </p>
          )}
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[780px] text-left text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {["Excel Row", "Package Type", "Basis / Mode", "Rate Kind", "From", "To",
                    "Amount (₹)", "Status", "Result"].map((label) =>
                    <th key={label} className="whitespace-nowrap px-2 py-2 font-semibold">
                      {label}
                    </th>)}
                </tr>
              </thead>
              <tbody>
                {preview.plan.rows.map(({ row, error, message }) =>
                  <tr key={row.line} className="border-t border-border align-top">
                    <td className="px-2 py-2">{row.line}</td>
                    <td className="px-2 py-2 font-medium">{row.packageType}</td>
                    <td className="px-2 py-2">{row.basis} / {row.chargeMode}</td>
                    <td className="px-2 py-2">{row.rateKind || "Type only"}</td>
                    <td className="px-2 py-2">{row.from ?? "—"}</td>
                    <td className="px-2 py-2">{row.rateKind ? row.to ?? "∞" : "—"}</td>
                    <td className="px-2 py-2">{row.amount ?? "—"}</td>
                    <td className="px-2 py-2">{row.active ? "Active" : "Inactive"}</td>
                    <td className={"px-2 py-2 " + (error ? "text-destructive" : "text-muted-foreground")}>
                      {message}
                    </td>
                  </tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Exact matching slab ranges update their amount; overlapping ranges are blocked.
            No package types or slabs are deleted by Excel import.
          </p>
        </section>
      )}
    </div>
  );
}
