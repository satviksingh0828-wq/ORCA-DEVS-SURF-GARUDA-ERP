import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type ExcelField = {
  key: string;
  label: string;
  required?: boolean;
};

function printable(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}
/** Keep GSTIN, account numbers and PIN codes as text, including leading zeroes. */
function sheet(columns: ExcelField[], rows: Record<string, unknown>[], sheetName: string) {
  const matrix = [
    columns.map((column) => column.label + (column.required ? " *" : "")),
    ...rows.map((row) => columns.map((field) => printable(row[field.key]))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  ws["!cols"] = columns.map((column) => ({
    wch: /address|legal name|transporter name|trade name/i.test(column.label) ? 34 :
      /branch|contact|account holder/i.test(column.label) ? 26 : 21,
  }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: Math.max(0, matrix.length - 1), c: columns.length - 1 },
  }) };
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  for (let c = 0; c < columns.length; c += 1) {
    for (let r = 1; r < matrix.length; r += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      if (ws[address]) ws[address].t = "s";
    }
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName.slice(0, 31));
  return book;
}
export function mapExcelMasterRows(
  headers: string[],
  rows: string[][],
  fields: ExcelField[],
): Record<string, string>[] {
  const indexes = fields.map((field) =>
    headers.findIndex((header) => header.trim().toLowerCase() === field.label.toLowerCase() ||
      header.trim().toLowerCase() === (field.label + (field.required ? " *" : "")).toLowerCase() ||
      header.trim().toLowerCase() === field.key.toLowerCase()));
  const missing = fields.filter((field, i) => field.required && indexes[i] < 0);
  if (missing.length) throw new Error("Missing required Excel columns: " +
    missing.map((field) => field.label).join(", "));
  return rows
    .filter((row) => row.some((value) => String(value ?? "").trim()))
    .map((row) => Object.fromEntries(
      fields.map((field, i) => [field.key, indexes[i] < 0 ? "" : String(row[indexes[i]] ?? "").trim()]),
    ));
}

export function MasterExcelIO({
  entityName, fields, rows, exportRows, onImport, readOnly = false,
}: {
  entityName: string;
  fields: ExcelField[];
  rows: Record<string, unknown>[];
  exportRows?: () => Promise<Record<string, unknown>[]>;
  onImport: (rows: Record<string, string>[]) => Promise<{ inserted: number; failed: number }>;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"template" | "export" | "import" | null>(null);
  const filename = safeName(entityName);

  async function download(template: boolean) {
    setBusy(template ? "template" : "export");
    try {
      const values = template ? [] : exportRows ? await exportRows() : rows;
      const workbook = sheet(fields, values, entityName);
      XLSX.writeFile(workbook, filename +
        (template ? "-import-template" : "-export-" + new Date().toISOString().slice(0, 10)) +
        ".xlsx");
      if (!template && !values.length) toast.info("Exported an empty master with column headings.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel export failed");
    } finally {
      setBusy(null);
    }
  }
  async function upload(file: File) {
    setBusy("import");
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        throw new Error("Select an Excel .xlsx or .xls file.");
      }
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const first = workbook.Sheets[workbook.SheetNames[0]];
      if (!first) throw new Error("The workbook has no worksheet.");
      const values = XLSX.utils.sheet_to_json<string[]>(first, {
        header: 1, raw: false, defval: "", blankrows: false,
      });
      if (!values.length) throw new Error("The worksheet is empty.");
      const parsed = mapExcelMasterRows(values[0].map(String),
        values.slice(1).map((row) => row.map(String)), fields);
      if (!parsed.length) throw new Error("Add records below the Excel headings before importing.");
      const { inserted, failed } = await onImport(parsed);
      if (failed) toast.warning("Imported " + inserted + "; " + failed +
        " row(s) failed. Check required fields, duplicates and branch names.");
      else toast.success("Imported " + inserted + " " + entityName.toLowerCase());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel import failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={ref} type="file" accept=".xlsx,.xls" className="sr-only"
        aria-label={"Import " + entityName + " Excel file"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }} />
      <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)}
        onClick={() => void download(true)}>
        <FileSpreadsheet className="size-4" /> Excel Template
      </Button>
      {!readOnly && <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)}
        onClick={() => ref.current?.click()}>
        {busy === "import" ? <Loader2 className="size-4 animate-spin" /> :
          <Upload className="size-4" />} Import Excel
      </Button>}
      <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)}
        onClick={() => void download(false)}>
        {busy === "export" ? <Loader2 className="size-4 animate-spin" /> :
          <Download className="size-4" />} Export Excel
      </Button>
    </div>
  );
}
