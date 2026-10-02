/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, PackageSearch, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { manifestCharges, num, type ContractLite, type EntryLite } from "@/lib/trip-calc";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Source = { id: string; contract_name: string };
type Bill = {
  id: string;
  bill_number: string;
  branch_id: string;
  source_id: string;
  bill_date: string;
  due_date: string;
  period_from: string;
  period_to: string;
  total_freight: number | string;
  total_loading: number | string;
  deleted_at: string | null;
  branch?: { branch_name?: string | null } | null;
  source?: { contract_name?: string | null } | null;
};
type Consignment = {
  id: string;
  consignment_number: string;
  branch_id: string;
  source_id: string;
  consignment_date: string | null;
  transport_mode: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  billing_status: string;
  source_bill_id: string | null;
  freight_deduction: number | string | null;
  additional_freight: number | string | null;
  loading_deduction: number | string | null;
  additional_loading: number | string | null;
  source?: { contract_name?: string | null } | null;
};
type PackageRow = {
  consignment_id: string;
  quantity: number | string | null;
  weight_kg: number | string | null;
};
type ShipmentPin = {
  consignment_id: string;
  dispatch_from_pin_code: string | null;
  ship_to_pin_code: string | null;
};
type Entry = EntryLite & { mode?: string | null };
type BillLine = Consignment & {
  from_pin_code: string;
  to_pin_code: string;
  calculated_freight: number;
  calculated_loading: number;
  freight_deduction: number;
  additional_freight: number;
  loading_deduction: number;
  additional_loading: number;
  final_freight: number;
  final_loading: number;
};

const money = (value: number | string | null | undefined) =>
  `₹${num(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const monthEnd = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
};
const normalizeMode = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toUpperCase();
function routeEntry(entries: Entry[], row: Consignment, fromPin: string, toPin: string) {
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === normalizeMode(row.transport_mode) &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}

export function SourceBilling() {
  const branches = useBranches();
  const { user } = useSession();
  const [screen, setScreen] = useState<"list" | "create">("list");
  const [bills, setBills] = useState<Bill[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [branchSources, setBranchSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [listFilters, setListFilters] = useState({
    branch: "all",
    source: "all",
    from: monthStart(),
    to: monthEnd(),
  });
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [viewing, setViewing] = useState<Bill | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<BillLine[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [form, setForm] = useState({
    branch: "",
    source: "",
    billDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    from: monthStart(),
    to: monthEnd(),
  });
  const [generating, setGenerating] = useState(false);

  async function loadSources() {
    const { data, error } = await (supabase as any)
      .from("contracts")
      .select("id,contract_name")
      .order("contract_name");
    if (error) return toast.error(`Could not load sources: ${error.message}`);
    setSources((data ?? []) as Source[]);
  }
  async function loadBills() {
    setLoading(true);
    try {
      let query = (supabase as any)
        .from("ltms_source_bills")
        .select(
          "id,bill_number,branch_id,source_id,bill_date,due_date,period_from,period_to,total_freight,total_loading,deleted_at,branch:branches(branch_name),source:contracts(contract_name)",
        )
        .gte("bill_date", listFilters.from)
        .lte("bill_date", listFilters.to)
        .order("bill_date", { ascending: false });
      if (listFilters.branch !== "all") query = query.eq("branch_id", listFilters.branch);
      if (listFilters.source !== "all") query = query.eq("source_id", listFilters.source);
      if (!showDeleted) query = query.is("deleted_at", null);
      else query = query.not("deleted_at", "is", null);
      const rows = await fetchAll<Bill>(() => query);
      setBills(rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load source bills");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadSources();
  }, []);
  useEffect(() => {
    if (!form.branch) {
      setBranchSources([]);
      return;
    }
    void (async () => {
      const { data } = await (supabase as any)
        .from("consignments")
        .select("source_id")
        .eq("branch_id", form.branch)
        .not("source_id", "is", null);
      const ids = new Set(
        (data ?? []).map((row: { source_id: string | null }) => row.source_id).filter(Boolean),
      );
      setBranchSources(sources.filter((source) => ids.has(source.id)));
    })();
  }, [form.branch, sources]);
  useEffect(() => {
    void loadBills();
    // loadBills intentionally follows the filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFilters.branch, listFilters.source, listFilters.from, listFilters.to, showDeleted]);

  async function loadCandidates() {
    if (!form.branch || !form.source) return toast.error("Select a branch and source first");
    if (!form.from || !form.to || form.from > form.to)
      return toast.error("Enter a valid billing period");
    setPickerLoading(true);
    try {
      const query = (supabase as any)
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,source_id,consignment_date,transport_mode,from_pin_code,to_pin_code,billing_status,source_bill_id,freight_deduction,additional_freight,loading_deduction,additional_loading,source:contracts(contract_name)",
        )
        .eq("branch_id", form.branch)
        .eq("source_id", form.source)
        .eq("billing_status", "to_be_billed")
        .gte("consignment_date", form.from)
        .lte("consignment_date", form.to)
        .order("consignment_date", { ascending: false });
      const consignments = await fetchAll<Consignment>(() => query);
      const ids = consignments.map((row) => row.id);
      if (!ids.length) {
        setCandidates([]);
        setPickerOpen(true);
        return;
      }
      const [packages, shipments, contractRows, entries] = await Promise.all([
        fetchAll<PackageRow>(() =>
          (supabase as any)
            .from("consignment_package_information")
            .select("consignment_id,quantity,weight_kg")
            .in("consignment_id", ids),
        ),
        fetchAll<ShipmentPin>(() =>
          (supabase as any)
            .from("shipments")
            .select("consignment_id,dispatch_from_pin_code,ship_to_pin_code")
            .in("consignment_id", ids)
            .order("created_at", { ascending: true }),
        ),
        fetchAll<ContractLite>(() =>
          (supabase as any)
            .from("contracts")
            .select("id,contract_name,company_name,gstin,fixed_monthly_charge,fixed_yearly_charge")
            .eq("id", form.source),
        ),
        fetchAll<Entry>(() =>
          (supabase as any)
            .from("contract_entries")
            .select(
              "id,contract_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges,per_manifest_amount",
            )
            .eq("contract_id", form.source),
        ),
      ]);
      const totals = new Map<string, { quantity: number; weight: number }>();
      packages.forEach((item) => {
        const current = totals.get(item.consignment_id) ?? { quantity: 0, weight: 0 };
        current.quantity += num(item.quantity);
        current.weight += num(item.weight_kg);
        totals.set(item.consignment_id, current);
      });
      const firstPins = new Map<string, ShipmentPin>();
      shipments.forEach((item) => {
        if (!firstPins.has(item.consignment_id)) firstPins.set(item.consignment_id, item);
      });
      const contract = contractRows[0];
      const rows = consignments.map((row) => {
        const pins = firstPins.get(row.id);
        const from = pins?.dispatch_from_pin_code || row.from_pin_code || "";
        const to = pins?.ship_to_pin_code || row.to_pin_code || "";
        const pack = totals.get(row.id) ?? { quantity: 0, weight: 0 };
        const entry = routeEntry(entries, row, from, to);
        const charges = manifestCharges(contract, entry, {
          from_location_id: null,
          to_location_id: null,
          from_pin_code: from,
          to_pin_code: to,
          weight_kg: String(pack.weight),
          quantity: String(pack.quantity),
        });
        const freightDeduction = num(row.freight_deduction);
        const additionalFreight = num(row.additional_freight);
        const loadingDeduction = num(row.loading_deduction);
        const additionalLoading = num(row.additional_loading);
        return {
          ...row,
          from_pin_code: from,
          to_pin_code: to,
          calculated_freight: charges.freight,
          calculated_loading: charges.loading,
          freight_deduction: freightDeduction,
          additional_freight: additionalFreight,
          loading_deduction: loadingDeduction,
          additional_loading: additionalLoading,
          final_freight: Math.max(0, charges.freight - freightDeduction + additionalFreight),
          final_loading: Math.max(0, charges.loading - loadingDeduction + additionalLoading),
        };
      });
      setCandidates(rows);
      setPickerOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load consignments");
    } finally {
      setPickerLoading(false);
    }
  }
  function addLine(row: BillLine) {
    if (lines.some((item) => item.id === row.id)) return;
    setLines((current) => [...current, row]);
    setPickerOpen(false);
  }
  function updateLine(id: string, key: keyof BillLine, value: string) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, [key]: Number(value) || 0 } as BillLine;
        next.final_freight = Math.max(
          0,
          next.calculated_freight - next.freight_deduction + next.additional_freight,
        );
        next.final_loading = Math.max(
          0,
          next.calculated_loading - next.loading_deduction + next.additional_loading,
        );
        return next;
      }),
    );
  }
  async function generate() {
    if (!form.branch || !form.source || !lines.length)
      return toast.error("Select branch, source and at least one consignment");
    if (form.from > form.to || form.billDate < form.from || form.dueDate < form.billDate)
      return toast.error("Check bill and billing period dates");
    setGenerating(true);
    const { error } = await (supabase as any).rpc("generate_ltms_source_bill", {
      p_branch_id: form.branch,
      p_source_id: form.source,
      p_bill_date: form.billDate,
      p_due_date: form.dueDate,
      p_period_from: form.from,
      p_period_to: form.to,
      p_created_by: user?.id ?? null,
      p_items: lines.map((line) => ({
        consignment_id: line.id,
        consignment_number: line.consignment_number,
        from_pin_code: line.from_pin_code,
        to_pin_code: line.to_pin_code,
        calculated_freight: line.calculated_freight,
        freight_deduction: line.freight_deduction,
        additional_freight: line.additional_freight,
        final_freight: line.final_freight,
        calculated_loading: line.calculated_loading,
        loading_deduction: line.loading_deduction,
        additional_loading: line.additional_loading,
        final_loading: line.final_loading,
      })),
    });
    setGenerating(false);
    if (error) return toast.error(`Could not generate source bill: ${error.message}`);
    toast.success("Source bill generated. Selected consignments are now locked.");
    setLines([]);
    setScreen("list");
    await loadBills();
  }
  async function deleteBill(bill: Bill) {
    if (bill.deleted_at) return;
    const { error } = await (supabase as any).rpc("soft_delete_ltms_source_bill", {
      p_bill_id: bill.id,
      p_deleted_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("Source bill moved to deleted history");
    await loadBills();
  }
  const visibleBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? bills.filter((bill) =>
          [bill.bill_number, bill.branch?.branch_name, bill.source?.contract_name]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : bills;
  }, [bills, search]);
  const totals = useMemo(
    () =>
      lines.reduce(
        (result, row) => ({
          freight: result.freight + row.final_freight,
          loading: result.loading + row.final_loading,
        }),
        { freight: 0, loading: 0 },
      ),
    [lines],
  );
  const updateForm = (key: keyof typeof form, value: string) =>
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "branch" ? { source: "" } : {}),
    }));
  const sourceList = listFilters.branch === "all" ? sources : sources;
  return (
    <div className="space-y-6">
      {screen === "list" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Source Billing History</h2>
              <p className="text-xs text-muted-foreground">
                Generated bills are immutable; delete moves them to history only.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setScreen("create")}>
                <FilePlus2 className="size-4" /> Create Source Bill
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadBills()}
                disabled={loading}
              >
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button
                variant={showDeleted ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowDeleted((value) => !value)}
              >
                {showDeleted ? "Deleted bills" : "Active bills"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/30 p-3">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search bill, source or branch"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select
              value={listFilters.branch}
              onValueChange={(value) => setListFilters((f) => ({ ...f, branch: value }))}
            >
              <SelectTrigger className="h-9 w-48">
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
            <Select
              value={listFilters.source}
              onValueChange={(value) => setListFilters((f) => ({ ...f, source: value }))}
            >
              <SelectTrigger className="h-9 w-52">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceList.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.contract_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-9 w-40"
              type="date"
              value={listFilters.from}
              onChange={(event) => setListFilters((f) => ({ ...f, from: event.target.value }))}
            />
            <Input
              className="h-9 w-40"
              type="date"
              value={listFilters.to}
              onChange={(event) => setListFilters((f) => ({ ...f, to: event.target.value }))}
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3">Bill No.</th>
                  <th className="px-3 py-3">Bill Date</th>
                  <th className="px-3 py-3">Branch</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Period</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleBills.length ? (
                  visibleBills.map((bill) => (
                    <tr key={bill.id} className="hover:bg-muted/20">
                      <td className="px-3 py-3 font-medium">
                        {bill.bill_number}
                        {bill.deleted_at && (
                          <span className="ml-2 text-xs text-destructive">Deleted</span>
                        )}
                      </td>
                      <td className="px-3 py-3">{bill.bill_date}</td>
                      <td className="px-3 py-3">{bill.branch?.branch_name ?? "—"}</td>
                      <td className="px-3 py-3">{bill.source?.contract_name ?? "—"}</td>
                      <td className="px-3 py-3">
                        {bill.period_from} → {bill.period_to}
                      </td>
                      <td className="px-3 py-3 text-right">{money(bill.total_freight)}</td>
                      <td className="px-3 py-3 text-right">{money(bill.total_loading)}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setViewing(bill)}>
                            <Eye className="size-3.5" /> View
                          </Button>
                          {!bill.deleted_at && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => void deleteBill(bill)}
                            >
                              <Trash2 className="size-3.5" /> Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      {loading ? "Loading bills…" : "No source bills found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {screen === "create" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <FilePlus2 className="size-4 text-primary" /> Create Source Bill
              </h2>
              <Button variant="outline" size="sm" onClick={() => setScreen("list")}>
                Back to bills
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only consignments marked To be billed can be selected. Source, branch and billing
              dates are stored on the bill.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Branch
              <Select value={form.branch} onValueChange={(value) => updateForm("branch", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Source
              <Select value={form.source} onValueChange={(value) => updateForm("source", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {(form.branch ? branchSources : []).map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.contract_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Bill Date
              <Input
                type="date"
                value={form.billDate}
                onChange={(event) => updateForm("billDate", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Bill Due Date
              <Input
                type="date"
                value={form.dueDate}
                onChange={(event) => updateForm("dueDate", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Billing From
              <Input
                type="date"
                value={form.from}
                onChange={(event) => updateForm("from", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Billing To
              <Input
                type="date"
                value={form.to}
                onChange={(event) => updateForm("to", event.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => void loadCandidates()}
              disabled={pickerLoading}
            >
              {pickerLoading ? <RefreshCw className="animate-spin" /> : <PackageSearch />} Load
              consignments
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1200px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3">Consignment</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">From → To</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-right">Adjustments</th>
                  <th className="px-3 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.length ? (
                  lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-3 font-medium">{line.consignment_number}</td>
                      <td className="px-3 py-3">{line.consignment_date ?? "—"}</td>
                      <td className="px-3 py-3">
                        {line.from_pin_code || "—"} → {line.to_pin_code || "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div>{money(line.final_freight)}</div>
                        <div className="mt-1 flex justify-end gap-1">
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Additional freight"
                            placeholder="+ freight"
                            value={line.additional_freight || ""}
                            onChange={(event) =>
                              updateLine(line.id, "additional_freight", event.target.value)
                            }
                          />
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Freight deduction"
                            placeholder="- freight"
                            value={line.freight_deduction || ""}
                            onChange={(event) =>
                              updateLine(line.id, "freight_deduction", event.target.value)
                            }
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div>{money(line.final_loading)}</div>
                        <div className="mt-1 flex justify-end gap-1">
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Additional loading"
                            placeholder="+ loading"
                            value={line.additional_loading || ""}
                            onChange={(event) =>
                              updateLine(line.id, "additional_loading", event.target.value)
                            }
                          />
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Loading deduction"
                            placeholder="- loading"
                            value={line.loading_deduction || ""}
                            onChange={(event) =>
                              updateLine(line.id, "loading_deduction", event.target.value)
                            }
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-muted-foreground">
                        Freight: {money(line.freight_deduction)} / {money(line.additional_freight)}
                        <br />
                        Loading: {money(line.loading_deduction)} / {money(line.additional_loading)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setLines((current) => current.filter((item) => item.id !== line.id))
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No consignments selected. Use Load consignments.
                    </td>
                  </tr>
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td colSpan={3} className="px-3 py-3">
                      Total ({lines.length} consignments)
                    </td>
                    <td className="px-3 py-3 text-right">{money(totals.freight)}</td>
                    <td className="px-3 py-3 text-right">{money(totals.loading)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void generate()} disabled={generating || !lines.length}>
              {generating ? "Generating…" : "Generate Source Bill"}
            </Button>
          </div>
        </section>
      )}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Select one unbilled consignment</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[850px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3">Consignment</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">From → To</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidates
                  .filter((row) => !lines.some((line) => line.id === row.id))
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-3 font-medium">{row.consignment_number}</td>
                      <td className="px-3 py-3">{row.consignment_date ?? "—"}</td>
                      <td className="px-3 py-3">
                        {row.from_pin_code} → {row.to_pin_code}
                      </td>
                      <td className="px-3 py-3 text-right">{money(row.final_freight)}</td>
                      <td className="px-3 py-3 text-right">{money(row.final_loading)}</td>
                      <td className="px-3 py-3 text-center">
                        <Button size="sm" onClick={() => addLine(row)}>
                          <Plus className="size-3.5" /> Add
                        </Button>
                      </td>
                    </tr>
                  ))}
                {!candidates.length && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-muted-foreground">
                      No unbilled consignments found for this branch, source and period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Source Bill {viewing?.bill_number}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Branch</span>
                <p className="font-medium">{viewing.branch?.branch_name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Source</span>
                <p className="font-medium">{viewing.source?.contract_name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Bill date</span>
                <p>{viewing.bill_date}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Due date</span>
                <p>{viewing.due_date}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Period</span>
                <p>
                  {viewing.period_from} → {viewing.period_to}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Totals</span>
                <p className="font-semibold">
                  {money(viewing.total_freight)} freight · {money(viewing.total_loading)} loading
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
