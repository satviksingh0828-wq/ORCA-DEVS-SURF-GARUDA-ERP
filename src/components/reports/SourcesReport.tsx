import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  source_bill_id?: string | null;
  transporter_bill_id?: string | null;
  branch?: { branch_name?: string | null } | null;
  source?: { contract_name?: string | null } | null;
  transporter_source?: { source_name?: string | null } | null;
};
type PackageRow = {
  id: string;
  consignment_id: string;
  package_type: string | null;
  package_rate_type_id: string;
  basis: "quantity" | "weight";
};
type MasterOption = { id: string; name: string; branch_id: string; basis?: "quantity" | "weight" };
type ReportRow = ConsignmentRow & { package_types: string };
type UpdateType = "source" | "transporter_source" | "package_type";

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
  const [packageRows, setPackageRows] = useState<PackageRow[]>([]);
  const [sourceOptions, setSourceOptions] = useState<MasterOption[]>([]);
  const [transporterSourceOptions, setTransporterSourceOptions] = useState<MasterOption[]>([]);
  const [packageTypeOptions, setPackageTypeOptions] = useState<MasterOption[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateType, setUpdateType] = useState<UpdateType>("source");
  const [currentValue, setCurrentValue] = useState("");
  const [replacementValue, setReplacementValue] = useState("");
  const [updating, setUpdating] = useState(false);
  const [selectedConsignmentIds, setSelectedConsignmentIds] = useState<string[]>([]);

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
          "id,consignment_number,branch_id,consignment_date,source_id,transporter_source_id,source_bill_id,transporter_bill_id,branch:branches(branch_name),source:contracts(contract_name),transporter_source:ltms_transporter_sources(source_name)",
        )
        .gte("consignment_date", fromDate)
        .lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (branchId !== "all") query = query.eq("branch_id", branchId);
      const consignments = await fetchAll<ConsignmentRow>(() => query);
      const ids = consignments.map((row) => row.id);
      const [packages, sources, transporterSources, packageTypeMasters] = await Promise.all([
        ids.length
          ? fetchAll<PackageRow>(() =>
              supabase
                .from("consignment_package_information")
                .select("id,consignment_id,package_type,package_rate_type_id,basis")
                .in("consignment_id", ids),
            )
          : Promise.resolve([] as PackageRow[]),
        fetchAll<{ id: string; contract_name: string; branch_id: string }>(() => {
          let sourceQuery = supabase
            .from("contracts")
            .select("id,contract_name,branch_id")
            .eq("status", "active");
          if (branchId !== "all") sourceQuery = sourceQuery.eq("branch_id", branchId);
          return sourceQuery.order("contract_name");
        }),
        fetchAll<{ id: string; source_name: string; branch_id: string }>(() => {
          let sourceQuery = supabase
            .from("ltms_transporter_sources" as never)
            .select("id,source_name,branch_id");
          if (branchId !== "all") sourceQuery = sourceQuery.eq("branch_id", branchId);
          return sourceQuery.order("source_name");
        }),
        fetchAll<{
          id: string;
          package_type: string;
          branch_id: string;
          basis: "quantity" | "weight";
        }>(() => {
          let typeQuery = supabase
            .from("package_rate_types")
            .select("id,package_type,branch_id,basis");
          if (branchId !== "all") typeQuery = typeQuery.eq("branch_id", branchId);
          return typeQuery.order("package_type");
        }),
      ]);
      const packageTypeNames = new Map<string, Set<string>>();
      for (const item of packages) {
        const type = String(item.package_type ?? "").trim();
        if (!type) continue;
        const values = packageTypeNames.get(item.consignment_id) ?? new Set<string>();
        values.add(type);
        packageTypeNames.set(item.consignment_id, values);
      }
      setPackageRows(packages);
      setSourceOptions(
        sources.map((item) => ({
          id: item.id,
          name: item.contract_name,
          branch_id: item.branch_id,
        })),
      );
      setTransporterSourceOptions(
        transporterSources.map((item) => ({
          id: item.id,
          name: item.source_name,
          branch_id: item.branch_id,
        })),
      );
      setPackageTypeOptions(
        packageTypeMasters.map((item) => ({
          id: item.id,
          name: item.package_type,
          branch_id: item.branch_id,
          basis: item.basis,
        })),
      );
      setRows(
        consignments.map((row) => ({
          ...row,
          package_types: [...(packageTypeNames.get(row.id) ?? new Set<string>())].join(", "),
        })),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Sources report");
    } finally {
      setLoading(false);
    }
  }

  const currentOptions = useMemo(() => {
    if (updateType === "source") {
      const ids = new Set(
        rows
          .filter((row) => !row.source_bill_id)
          .map((row) => row.source_id)
          .filter(Boolean),
      );
      return sourceOptions.filter((option) => ids.has(option.id));
    }
    if (updateType === "transporter_source") {
      const ids = new Set(
        rows
          .filter((row) => !row.transporter_bill_id)
          .map((row) => row.transporter_source_id)
          .filter(Boolean),
      );
      return transporterSourceOptions.filter((option) => ids.has(option.id));
    }
    const ids = new Set(
      packageRows
        .filter((item) => rows.some((row) => row.id === item.consignment_id))
        .map((item) => item.package_rate_type_id),
    );
    return packageTypeOptions.filter((option) => ids.has(option.id));
  }, [packageRows, packageTypeOptions, rows, sourceOptions, transporterSourceOptions, updateType]);

  const replacementOptions = useMemo(() => {
    const currentId = currentValue;
    if (updateType === "source") return sourceOptions.filter((option) => option.id !== currentId);
    if (updateType === "transporter_source")
      return transporterSourceOptions.filter((option) => option.id !== currentId);
    return packageTypeOptions.filter((option) => option.id !== currentId);
  }, [currentValue, packageTypeOptions, sourceOptions, transporterSourceOptions, updateType]);

  useEffect(() => {
    if (!currentOptions.some((option) => option.id === currentValue)) {
      setCurrentValue(currentOptions[0]?.id ?? "");
    }
    setReplacementValue("");
  }, [currentOptions, updateType]);

  async function replaceValue() {
    if (branchId === "all") return toast.error("Select a branch before replacing values safely");
    if (!currentValue || !replacementValue)
      return toast.error("Select both the current and replacement values");
    if (currentValue === replacementValue)
      return toast.error("Replacement value must be different");
    if (!selectedConsignmentIds.length)
      return toast.error("Select at least one consignment in the report first");
    const lockedTransporterCount =
      updateType === "transporter_source"
        ? rows.filter((row) => selectedConsignmentIds.includes(row.id) && row.transporter_bill_id)
            .length
        : 0;
    setUpdating(true);
    try {
      if (updateType === "source" || updateType === "transporter_source") {
        const affectedIds = rows
          .filter(
            (row) =>
              selectedConsignmentIds.includes(row.id) &&
              (updateType !== "source" || !row.source_bill_id) &&
              (updateType !== "transporter_source" || !row.transporter_bill_id) &&
              (updateType === "source" ? row.source_id : row.transporter_source_id) ===
                currentValue,
          )
          .map((row) => row.id);
        if (!affectedIds.length && lockedTransporterCount)
          throw new Error("Transporter source cannot be changed after transporter bill generation");
        if (!affectedIds.length)
          throw new Error("The current value is not used in the selected date range");
        const column = updateType === "source" ? "source_id" : "transporter_source_id";
        const { error } = await supabase
          .from("consignments")
          .update({ [column]: replacementValue })
          .in("id", affectedIds);
        if (error) throw error;
      } else {
        const affected = packageRows.filter(
          (item) =>
            item.package_rate_type_id === currentValue &&
            selectedConsignmentIds.includes(item.consignment_id),
        );
        if (!affected.length)
          throw new Error("The current package type is not used in the selected date range");
        const replacement = packageTypeOptions.find((option) => option.id === replacementValue);
        if (!replacement) throw new Error("Replacement package type was not found");
        const { error } = await supabase
          .from("consignment_package_information")
          .update({
            package_rate_type_id: replacement.id,
            package_type: replacement.name,
            basis: replacement.basis,
          })
          .in(
            "id",
            affected.map((item) => item.id),
          );
        if (error) throw error;
      }
      toast.success(
        lockedTransporterCount
          ? `Eligible consignments updated; ${lockedTransporterCount} transporter-billed consignment(s) skipped because their source is locked.`
          : "Selected consignments updated; calculations will use the replacement master",
      );
      setReplacementValue("");
      setUpdateOpen(false);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not replace the selected value");
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
    void loadBranches();
  }, []);
  useEffect(() => {
    void loadData();
  }, [fromDate, toDate, branchId]);
  useEffect(() => {
    setSelectedConsignmentIds((current) =>
      current.filter((id) => rows.some((row) => row.id === id)),
    );
  }, [rows]);

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUpdateOpen(true)}
            disabled={!selectedConsignmentIds.length}
          >
            Update with selection ({selectedConsignmentIds.length})
          </Button>
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
              <th className="px-3 py-3 text-center">
                <input
                  type="checkbox"
                  aria-label="Select all visible consignments"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((row) => selectedConsignmentIds.includes(row.id))
                  }
                  onChange={(event) =>
                    setSelectedConsignmentIds(
                      event.target.checked ? filtered.map((row) => row.id) : [],
                    )
                  }
                />
              </th>
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
              filtered.map((row) => (
                <tr key={row.id} className="border-t border-border/60">
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.consignment_number}`}
                      checked={selectedConsignmentIds.includes(row.id)}
                      onChange={(event) =>
                        setSelectedConsignmentIds((current) =>
                          event.target.checked
                            ? [...current, row.id]
                            : current.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-3 font-medium">{row.consignment_number}</td>
                  <td className="px-3 py-3">{row.consignment_date ?? "—"}</td>
                  <td className="px-3 py-3">{row.branch?.branch_name ?? "—"}</td>
                  <td className="px-3 py-3">
                    {row.source?.contract_name ?? "—"}
                    {row.source_bill_id ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        Source billed · editable
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    {row.transporter_source?.source_name ?? "—"}
                    {row.transporter_bill_id ? (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                        Transporter billed · locked
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{row.package_types || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Sources value</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {branchId === "all" && (
                <p className="text-xs text-amber-600">
                  Select one branch to enable a safe replacement.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Update Type</Label>
              <Select
                value={updateType}
                onValueChange={(value) => setUpdateType(value as UpdateType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="source">Source update</SelectItem>
                  <SelectItem value="transporter_source">Transporter Source update</SelectItem>
                  <SelectItem value="package_type">Package Type update</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              This update works only on the consignments selected in the report. Source values are
              protected after Source Billing, and transporter source is locked after Transporter
              Billing. Package type remains editable.
            </p>
            <div className="space-y-1.5">
              <Label>Current Value</Label>
              <Select value={currentValue} onValueChange={setCurrentValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Select current value" />
                </SelectTrigger>
                <SelectContent>
                  {currentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!currentOptions.length && (
                <p className="text-xs text-muted-foreground">
                  No values of this type are used in the selected period.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Replace With (existing master only)</Label>
              <Select value={replacementValue} onValueChange={setReplacementValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Select replacement value" />
                </SelectTrigger>
                <SelectContent>
                  {replacementOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!replacementOptions.length && (
                <p className="text-xs text-muted-foreground">
                  No other existing value is available for this branch.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only existing masters can be selected. The replacement is applied directly to matching
              consignments in the selected date range, preserving calculations through the
              replacement master ID.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void replaceValue()}
              disabled={branchId === "all" || updating || !currentValue || !replacementValue}
            >
              {updating ? "Updating…" : "Update / Replace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
