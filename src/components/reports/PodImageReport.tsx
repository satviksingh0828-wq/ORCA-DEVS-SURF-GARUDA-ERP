import { useEffect, useMemo, useState } from "react";
import { Download, Eye, FileImage, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/lib/session";
import {
  fetchPodImageReport, getPodImageReportLinks,
  type PodReportResponse, type PodReportRow,
} from "@/lib/pod-image-report.server";

const HEADERS = [
  "Consignment No.", "Receiving Date", "Source", "Destination",
  "Consignor", "Consignee", "Weight", "Pkgs",
  "Front Copy", "Back Copy", "Signature Copy", "Upload Document", "Img Download",
] as const;
const todayMonth = () => {
  const d = new Date();
  return [
    d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"),
  ].join("-");
};
const todayDate = () => {
  const d = new Date();
  return todayMonth() + "-" + String(d.getDate()).padStart(2, "0");
};
const getField = (row: PodReportRow): Array<string | number> => [
  row.consignmentNumber, row.receivingDate, row.source, row.destination,
  row.consignor, row.consignee, row.weight, row.packages,
  row.front ? "Y" : "N", row.back ? "Y" : "N",
  row.signature ? "Y" : "N",
  row.uploadDocument === null ? "—" : row.uploadDocument ? "Y" : "N",
  row.front || row.back || row.signature ? "Available in ERP" : "N",
];
const safeExcelCell = (val: string | number) => typeof val === "string" && /^[=+\-@\t\r]/.test(val)
  ? "'" + val : val;

type PreviewLinks = {
  front: string | null; back: string | null; signature: string | null;
};
const KINDS = ["front", "back", "signature"] as const;
const displayKind = (kind: (typeof KINDS)[number]) =>
  kind === "front" ? "Front Copy" : kind === "back" ? "Back Copy" : "Signature Copy";

export function PodImageReport() {
  const { user } = useSession();
  const [fromDate, setFromDate] = useState(todayMonth() + "-01");
  const [toDate, setToDate] = useState(todayDate());
  const [branchId, setBranchId] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PodReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewRow, setPreviewRow] = useState<PodReportRow | null>(null);
  const [previewLinks, setPreviewLinks] = useState<PreviewLinks | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeKind, setActiveKind] = useState<(typeof KINDS)[number]>("front");

  const params = (targetPage = 0, exportAll = false) => ({
    sessionToken: user?.sessionToken ?? "", fromDate, toDate,
    branchId, sourceId, search, page: targetPage, exportAll,
  });
  async function load(target = 0) {
    if (!user?.sessionToken) return toast.error("Sign in to view the POD report.");
    setLoading(true);
    try {
      const response = await fetchPodImageReport({ data: params(target) });
      setResult(response);
      setPage(response.page);
    } catch (error) {
      setResult(null);
      toast.error(error instanceof Error ? error.message : "Could not load POD report.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (user?.sessionToken) void load(0);
    // Filters are explicitly applied through the Search control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sessionToken]);

  const filtered = useMemo(() => (result?.rows ?? []).filter((row) =>
    status === "all" || (status === "front" && row.front) ||
    (status === "back" && row.back) ||
    (status === "signature" && row.signature) ||
    (status === "missing" && !row.front && !row.back && !row.signature),
  ), [result, status]);
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / 50));
  const availableCopies = filtered.reduce((sum, row) =>
    sum + Number(row.front) + Number(row.back) + Number(row.signature), 0);

  async function exportExcel() {
    if (!user?.sessionToken) return;
    setExporting(true);
    try {
      const all = await fetchPodImageReport({ data: params(0, true) });
      const selected = all.rows.filter((row) =>
        status === "all" || (status === "front" && row.front) ||
        (status === "back" && row.back) ||
        (status === "signature" && row.signature) ||
        (status === "missing" && !row.front && !row.back && !row.signature));
      const matrix = [
        [...HEADERS],
        ...selected.map((row) => getField(row).map(safeExcelCell)),
      ];
      const sheet = XLSX.utils.aoa_to_sheet(matrix);
      sheet["!cols"] = HEADERS.map((header) => ({
        wch: ["Consignor", "Consignee"].includes(header) ? 32 :
          ["Consignment No.", "Source", "Destination"].includes(header) ? 23 : 17,
      }));
      sheet["!autofilter"] = { ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(0, matrix.length - 1), c: HEADERS.length - 1 },
      }) };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "POD Images");
      XLSX.writeFile(workbook, "pod-image-report-" + fromDate + "-to-" + toDate + ".xlsx");
      if (all.capped) toast.warning("Export limited to 5,000 records; narrow the date range for older records.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function openPreview(row: PodReportRow) {
    if (!user?.sessionToken) return toast.error("Sign in again to view POD images.");
    setPreviewRow(row);
    setPreviewLinks(null);
    setPreviewLoading(true);
    try {
      const links = await getPodImageReportLinks({
        data: { sessionToken: user.sessionToken, podId: row.podId },
      });
      setPreviewLinks(links);
      const first = KINDS.find((kind) => Boolean(links[kind]));
      if (first) setActiveKind(first);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load POD images.");
    } finally {
      setPreviewLoading(false);
    }
  }

  const activeLink = previewLinks?.[activeKind] || null;
  const previewIsPdf = activeLink && /\.pdf(?:\?|$)/i.test(activeLink.split("?")[0]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[140px_140px_1fr_1fr_1fr_150px_auto]">
          <label className="space-y-1.5 text-xs font-medium">
            Receiving Date From
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Receiving Date To
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Branch
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All authorised branches</SelectItem>
                {(result?.branches ?? []).map((branch) =>
                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Source
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {(result?.sources ?? []).map((source) =>
                  <SelectItem key={source.id} value={source.id}>{source.name || source.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            Consignment No.
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search consignment"
              onKeyDown={(e) => { if (e.key === "Enter") void load(0); }} />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            View
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="front">Front copy</SelectItem>
                <SelectItem value="back">Back copy</SelectItem>
                <SelectItem value="signature">Signature</SelectItem>
                <SelectItem value="missing">No image</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button disabled={loading} className="self-end" onClick={() => void load(0)}>
            <Search className="mr-1 size-4" /> Search
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Images are fetched securely from Outward POD only when you click View.
            Exports contain availability flags, not expiring private image links.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(page)}>
              <RefreshCw className="mr-1 size-4" /> Refresh
            </Button>
            <Button size="sm" variant="outline" disabled={exporting || loading}
              onClick={() => void exportExcel()}>
              <Download className="mr-1 size-4" /> Export Excel
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">POD records</p>
          <p className="text-xl font-semibold">{(result?.total ?? 0).toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Visible in current page</p>
          <p className="text-xl font-semibold">{filtered.length.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Available copies on page</p>
          <p className="text-xl font-semibold">{availableCopies.toLocaleString("en-IN")}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-3">
          <h2 className="text-sm font-semibold">Download POD Image</h2>
          <p className="text-xs text-muted-foreground">Page {page + 1} of {pageCount}</p>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead className="bg-muted/50">
              <tr>
                {HEADERS.map((header) =>
                  <th key={header} className="border-b border-r border-border px-3 py-2 text-left font-semibold whitespace-nowrap">
                    {header}
                  </th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.podId} className="hover:bg-muted/30">
                  {getField(row).map((value, idx) =>
                    <td key={idx} className="max-w-[250px] border-b border-r border-border px-3 py-2 align-top">
                      {idx === 12
                        ? <Button size="sm" variant="outline" className="h-7 gap-1"
                            onClick={() => void openPreview(row)}>
                            <Eye className="size-3.5" /> View / Download
                          </Button>
                        : idx >= 8 && idx <= 10
                          ? <span className={value === "Y" ? "font-semibold text-foreground" : "text-muted-foreground"}>
                              {String(value)}
                            </span>
                          : value === "" || value === null ? "—" : String(value)}
                    </td>)}
                </tr>
              ))}
              {!loading && !filtered.length &&
                <tr><td colSpan={HEADERS.length} className="p-7 text-center text-muted-foreground">
                  No POD records match these filters.
                </td></tr>}
              {loading && <tr><td colSpan={HEADERS.length} className="p-7 text-center">
                Loading authorised POD records…
              </td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center border-t border-border p-3 text-xs">
          <span className="text-muted-foreground">Up to 50 POD records per page.</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={loading || page <= 0}
              onClick={() => void load(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={loading || page + 1 >= pageCount}
              onClick={() => void load(page + 1)}>Next</Button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(previewRow)} onOpenChange={(open) => {
        if (!open) { setPreviewRow(null); setPreviewLinks(null); }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>POD Images — {previewRow?.consignmentNumber}</DialogTitle>
            <DialogDescription>
              Images come directly from the linked Outward POD. Signed links expire automatically.
            </DialogDescription>
          </DialogHeader>
          {previewLoading && <p className="text-sm">Preparing secure previews…</p>}
          {previewLinks && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {KINDS.map((kind) =>
                  <Button key={kind} size="sm" variant={activeKind === kind ? "default" : "outline"}
                    disabled={!previewLinks[kind]} onClick={() => setActiveKind(kind)}>
                    {displayKind(kind)} {previewLinks[kind] ? "" : "(N)"}
                  </Button>)}
              </div>
              {activeLink ? (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <a href={activeLink} download
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
                      <Download className="size-4" /> Open / Download {displayKind(activeKind)}
                    </a>
                  </div>
                  <div className="flex min-h-[250px] items-center justify-center overflow-hidden rounded-lg border bg-muted/20">
                    {previewIsPdf
                      ? <iframe title={displayKind(activeKind)} src={activeLink} className="h-[65vh] w-full" />
                      : <img alt={displayKind(activeKind)} src={activeLink}
                          className="max-h-[65vh] w-auto max-w-full object-contain" />}
                  </div>
                </div>
              ) : <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileImage className="size-4" /> This copy has not been uploaded.
              </div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
