import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAll } from "@/lib/fetch-all";
import { downloadCsv, toCsv } from "@/lib/csv";

type BranchOption = { id: string; branch_name: string };
type ConsignmentRow = {
  id: string;
  consignment_number: string;
  branch_id: string | null;
  consignment_date: string | null;
  source_id: string | null;
  transporter_source_id: string | null;
  branch?: { branch_name?: string | null } | null;
  source?: { contract_name?: string | null } | null;
  transporter_source?: { source_name?: string | null } | null;
};
type PackageRow = {
  consignment_id: string;
  package_type: string | null;
  package_rate_type_id: string;
};
type ReportRow = ConsignmentRow & { package_types: string };

function monthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export function SourcesReport() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(monthEnd);
  const [branchId, setBranchId] = useState("all");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadBranches() {
    const { data, error } = await supabase
      .from("branches")
      .select("id,branch_name")
      .order("branch_name");
    if (error) return toast.error(`Could not load branches: ${error.message}`);
    setBranches((data ?? []) as BranchOption[]);
  }

  async function loadData() {
    if (!fromDate || !toDate) return toast.error("Select both From Date and To Date");
    if (fromDate > toDate) return toast.error("From Date cannot be after To Date");
    setLoading(true);
    try {
      let query = supabase
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,consignment_date,source_id,transporter_source_id,branch:branches(branch_name),source:contracts(contract_name),transporter_source:ltms_transporter_sources(source_name)",
        )
        .gte("consignment_date", fromDate)
        .lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (branchId !== "all") query = query.eq("branch_id", branchId);
      const consignments = await fetchAll<ConsignmentRow>(() => query);
      const ids = consignments.map((row) => row.id);
      const packages = ids.length
        ? await fetchAll<PackageRow>(() =>
            supabase
              .from("consignment_package_information")
              .select("consignment_id,package_type,package_rate_type_id")
              .in("consignment_id", ids),
          )
        : [];
      const packageTypes = new Map<string, Set<string>>();
      for (const item of packages) {
        const type = String(item.package_type ?? "").trim();
        if (!type) continue;
        const values = packageTypes.get(item.consignment_id) ?? new Set<string>();
        values.add(type);
        packageTypes.set(item.consignment_id, values);
      }
      setRows(
        consignments.map((row) => ({
          ...row,
          package_types: [...(packageTypes.get(row.id) ?? new Set<string>())].join(", "),
        })),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Sources report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBranches();
  }, []);
  useEffect(() => {
    void loadData();
  }, [fromDate, toDate, branchId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [
        row.consignment_number,
        row.source?.contract_name,
        row.transporter_source?.source_name,
        row.package_types,
        row.branch?.branch_name,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(term),
      ),
    );
  }, [rows, search]);

  function exportCsv() {
    const data = filtered.map((row) => ({
      "Consignment Number": row.consignment_number,
      Date: row.consignment_date ?? "",
      Branch: row.branch?.branch_name ?? "",
      Source: row.source?.contract_name ?? "",
      "Transporter Source": row.transporter_source?.source_name ?? "",
      "Package Types": row.package_types,
    }));
    downloadCsv(`sources-${fromDate}-to-${toDate}.csv`, toCsv(data));
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-5">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">From Date</label>
          <Input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">To Date</label>
          <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Branch</label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative self-end md:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search consignment, source or package type"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{filtered.length} consignment(s)</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="size-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Consignment Number</th>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Branch</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Transporter Source</th>
              <th className="px-3 py-3">Package Types Used</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  No consignments found for the selected filters.
                </td>
              </tr>
            ) : (
              filtered.map((row, index) => (
                <tr key={row.id} className="border-t border-border/60">
                  <td className="px-3 py-3 text-muted-foreground">{index + 1}</td>
                  <td className="px-3 py-3 font-medium">{row.consignment_number}</td>
                  <td className="px-3 py-3">{row.consignment_date ?? "—"}</td>
                  <td className="px-3 py-3">{row.branch?.branch_name ?? "—"}</td>
                  <td className="px-3 py-3">{row.source?.contract_name ?? "—"}</td>
                  <td className="px-3 py-3">{row.transporter_source?.source_name ?? "—"}</td>
                  <td className="px-3 py-3">{row.package_types || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
