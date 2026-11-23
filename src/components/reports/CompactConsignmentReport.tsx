import { useEffect, useMemo, useState } from "react";
import { Download, FileText, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/lib/session";
import { fetchCompactConsignmentReport, type CompactConsignmentResponse } from "@/lib/consignment-report";
import {
  CONSIGNMENT_REPORT_COLUMNS, columnsForConsignmentRole, reportSummary,
  type ConsignmentColumn, type ConsignmentReportRecord,
} from "@/lib/consignment-report-model";

const compactHeaders: ConsignmentColumn[] = [
  "SNO", "Cnmt No.", "Cnmt Date", "Branch", "Source", "Consignee",
  "Destination", "Vehicle No.", "Pkgs", "A. Weight", "C. Weight",
  "Transporter Name", "Invoice No.", "Ref. No.",
];
const numberColumns = new Set<string>([
  "SNO", "Pkgs", "A. Weight", "C. Weight", "Rate", "Freight", "Others Charges",
]);
const fmt = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return String(value);
};
const safeCell = (value: string | number | undefined) =>
  typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? "'" + value : (value ?? "");
const filename = (from: string, to: string) => "consignment-report-" + from + "-to-" + to;

export function CompactConsignmentReport() {
  const { user } = useSession();
  const [fromDate, setFromDate] = useState(() => {
    const today = new Date();
    return today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-01";
  });
  const [toDate, setToDate] = useState(() => {
    const today = new Date();
    return today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") +
      "-" + String(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()).padStart(2, "0");
  });
  const [branchId, setBranchId] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [fullColumns, setFullColumns] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<CompactConsignmentResponse | null>(null);
  const activeColumns = useMemo(() => {
    const permitted = new Set(result?.columns ?? []);
    return fullColumns
      ? columnsForConsignmentRole(result?.role).filter((c) => permitted.has(c))
      : compactHeaders.filter((column) => permitted.has(column));
  }, [fullColumns, result]);

  const totals = useMemo(() => reportSummary(result?.rows ?? []), [result]);
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / 50));

  const params = (targetPage = 0, exportAll = false) => ({
    sessionToken: user?.sessionToken ?? "", fromDate, toDate, branchId, sourceId, search,
    page: targetPage, exportAll,
  });

  async function load(targetPage = 0) {
    if (!user?.sessionToken) return toast.error("Please sign in again to load this report.");
    if (fromDate > toDate) return toast.error("From Date cannot be after To Date.");
    setLoading(true);
    try {
      const data = await fetchCompactConsignmentReport({ data: params(targetPage) });
      setResult(data);
      setPage(data.page);
    } catch (error) {
      setResult(null);
      toast.error(error instanceof Error ? error.message : "Consignment report could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.sessionToken) void load(0);
    // Load once when the authenticated session changes; filters apply on Search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sessionToken]);

  async function fetchExport() {
    if (!user?.sessionToken) throw new Error("Your session has expired.");
    const data = await fetchCompactConsignmentReport({ data: params(0, true) });
    if (data.capped) toast.warning("Export limited to 5,000 rows. Narrow the date range for remaining rows.");
    return data;
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const data = await fetchExport();
      const columns = data.columns;
      const matrix = [
        columns,
        ...data.rows.map((row) => columns.map((column) => safeCell(row[column as ConsignmentColumn]))),
      ];
      const sheet = XLSX.utils.aoa_to_sheet(matrix);
      sheet["!cols"] = columns.map((col) => ({
        wch: ["Consignee", "Transporter Name", "Invoice No."].includes(col) ? 27 :
          ["Branch", "Source", "Destination", "Rate Calculate On"].includes(col) ? 20 : 14,
      }));
      sheet["!autofilter"] = { ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(0, matrix.length - 1), c: columns.length - 1 },
      }) };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Consignments");
      XLSX.writeFile(workbook, filename(fromDate, toDate) + ".xlsx");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel export failed");
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    setExporting(true);
    try {
      const data = await fetchExport();
      const columns = data.columns as ConsignmentColumn[];
      const doc = new jsPDF({ unit: "pt", orientation: "landscape", format: "a3" });
      // Split across two table sections to keep fonts readable, while retaining
      // every original column and the same row order in one PDF.
      const first = columns.slice(0, 14);
      const second = [...columns.slice(0, 1), columns[3], ...columns.slice(14)]
        .filter((value, index, values) => values.indexOf(value) === index);
      for (const [sectionIndex, fields] of [first, second].entries()) {
        if (sectionIndex > 0) doc.addPage();
        autoTable(doc, {
          startY: 76,
          margin: { left: 25, right: 25, top: 76, bottom: 36 },
          head: [fields],
          body: data.rows.map((row) => fields.map((field) => fmt(row[field]))),
          theme: "grid",
          styles: {
            font: "helvetica", fontSize: 7, textColor: [25, 25, 25],
            lineColor: [135, 135, 135], lineWidth: 0.35, cellPadding: 4,
            overflow: "linebreak", valign: "middle",
          },
          headStyles: { fillColor: [228, 228, 228], textColor: [15, 15, 15], fontStyle: "bold" },
          didDrawPage: () => {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            doc.text("GARUDA LOGISTICS - CONSIGNMENT REPORT", 26, 26);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text(fromDate + " to " + toDate + " | " +
              (data.role === "basic" || data.role === "viewer" ? "Operational View" : "Full Report") +
              " | Section " + (sectionIndex + 1) + " of 2", 26, 43);
            doc.text("Columns follow uploaded Jaipur/Freight report format", 26, 56);
          },
        });
      }
      for (let i = 1; i <= doc.getNumberOfPages(); i += 1) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.text(i + " / " + doc.getNumberOfPages(),
          doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 18,
          { align: "right" });
      }
      doc.save(filename(fromDate, toDate) + ".pdf");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[140px_140px_1fr_1fr_1fr_auto]">
          <label className="space-y-1.5 text-xs font-medium">
            From Date
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            To Date
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Branch
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="Branch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assigned branches</SelectItem>
                {(result?.branches ?? []).map((b) =>
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Source
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {(result?.sources ?? []).map((s) =>
                  <SelectItem key={s.id} value={s.id}>{s.name || s.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Consignment No.
            <Input placeholder="Search number" value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void load(0); }} />
          </label>
          <Button className="self-end" disabled={loading} onClick={() => void load(0)}>
            <Search className="mr-1 size-4" /> Search
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {result?.role === "basic" || result?.role === "viewer"
              ? "Assigned-branch records only. Rates, freight and charges are excluded from the data and exports."
              : "Full 26-column view. Rates use matching source contracts; missing rates remain blank."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant={fullColumns ? "outline" : "secondary"} size="sm"
              onClick={() => setFullColumns(false)}>Compact</Button>
            <Button variant={fullColumns ? "secondary" : "outline"} size="sm"
              onClick={() => setFullColumns(true)}>All permitted columns</Button>
            <Button size="sm" variant="outline" disabled={exporting || loading}
              onClick={() => void exportExcel()}><Download className="mr-1 size-4" /> Excel</Button>
            <Button size="sm" variant="outline" disabled={exporting || loading}
              onClick={() => void exportPdf()}><FileText className="mr-1 size-4" /> PDF</Button>
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(page)}
              aria-label="Refresh report"><RefreshCw className="size-4" /></Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[
          ["Consignments", (result?.total ?? 0).toLocaleString("en-IN")],
          ["Packages (this page)", fmt(totals.packages)],
          ["Actual Weight (KG)", fmt(totals.actualWeight)],
          ["Charged Weight (KG)", fmt(totals.chargedWeight)],
        ].map(([label, value]) =>
          <div key={label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
          </div>)}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border p-3">
          <h2 className="text-sm font-semibold">Consignment Report</h2>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} / {pageCount} · {activeColumns.length} visible columns
          </span>
        </div>
        <div className="max-w-full overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-muted/50">
                {activeColumns.map((column) =>
                  <th key={column} className={"whitespace-nowrap border-b border-r border-border px-3 py-2.5 font-semibold " +
                    (numberColumns.has(column) ? "text-right" : "text-left")}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {(result?.rows ?? []).map((row, index) =>
                <tr key={String(row["Cnmt No."]) + "-" + index} className="hover:bg-muted/30">
                  {activeColumns.map((column) =>
                    <td key={column} className={"max-w-[260px] border-b border-r border-border px-3 py-2 align-top " +
                      (numberColumns.has(column) ? "text-right tabular-nums" : "text-left")}>
                      {fmt(row[column])}
                    </td>)}
                </tr>)}
              {loading && <tr><td colSpan={Math.max(1, activeColumns.length)} className="p-7 text-center">
                Loading authorised consignments…
              </td></tr>}
              {!loading && !result?.rows.length && <tr>
                <td colSpan={Math.max(1, activeColumns.length)}
                  className="p-7 text-center text-muted-foreground">
                  No permitted consignments found for these filters.
                </td>
              </tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border p-3">
          <p className="text-xs text-muted-foreground">50 records per page. Exports use all matching records (up to 5,000).</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={loading || page <= 0}
              onClick={() => void load(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={loading || page + 1 >= pageCount}
              onClick={() => void load(page + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
