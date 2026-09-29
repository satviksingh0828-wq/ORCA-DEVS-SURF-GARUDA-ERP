import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Package,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
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
import { num } from "@/lib/trip-calc";

type BranchOption = { id: string; branch_name: string };
type ConsignmentRow = {
  id: string;
  consignment_number: string;
  branch_id: string | null;
  consignment_date: string | null;
  loading_deduction: number | string | null;
  additional_loading: number | string | null;
  branch?: { branch_name?: string | null } | null;
};
type PackageRow = {
  consignment_id: string;
  package_rate_type_id: string;
  package_type: string;
  basis: "quantity" | "weight";
  quantity: number | string | null;
  weight_kg: number | string | null;
};
type RateType = {
  id: string;
  branch_id: string;
  package_type: string;
  basis: "quantity" | "weight";
  charge_mode: "fixed" | "rate";
};
type RateEntry = {
  package_rate_type_id: string;
  from_value: number | string;
  to_value: number | string | null;
  amount: number | string;
};
type PackageDetail = PackageRow & {
  rate_type: string;
  charge_mode: "fixed" | "rate" | "—";
  measure: number;
  slab_from: number | null;
  slab_to: number | null;
  slab_amount: number | null;
  calculated_amount: number;
  matched: boolean;
};
type ReportRow = ConsignmentRow & {
  package_count: number;
  package_summary: string;
  total_quantity: number;
  total_weight: number;
  calculated_loading: number;
  final_loading: number;
  rateMatched: boolean;
  package_details: PackageDetail[];
};
type Adjustment = { deduction: string; addition: string };

const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const moneyFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const displayNumber = (value: number) => numberFormat.format(value);
const displayMoney = (value: number) => moneyFormat.format(value);
function monthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function packageCharge(packageRow: PackageRow, type: RateType | undefined, entries: RateEntry[]) {
  const measure = type?.basis === "weight" ? num(packageRow.weight_kg) : num(packageRow.quantity);
  const detail: PackageDetail = {
    ...packageRow,
    rate_type: type?.package_type ?? packageRow.package_type,
    charge_mode: type?.charge_mode ?? "—",
    measure,
    slab_from: null,
    slab_to: null,
    slab_amount: null,
    calculated_amount: 0,
    matched: false,
  };
  if (!type) return { amount: 0, matched: false, detail };
  const slab = entries
    .filter((entry) => entry.package_rate_type_id === type.id)
    .sort((a, b) => num(b.from_value) - num(a.from_value))
    .find(
      (entry) =>
        num(entry.from_value) <= measure &&
        (entry.to_value == null || measure <= num(entry.to_value)),
    );
  if (!slab) return { amount: 0, matched: false, detail };
  const amount = type.charge_mode === "rate" ? num(slab.amount) * measure : num(slab.amount);
  return {
    amount,
    matched: true,
    detail: {
      ...detail,
      slab_from: num(slab.from_value),
      slab_to: slab.to_value == null ? null : num(slab.to_value),
      slab_amount: num(slab.amount),
      calculated_amount: amount,
      matched: true,
    },
  };
}

export function LoadingChargesReport() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(monthEnd);
  const [branchId, setBranchId] = useState("all");
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, Adjustment>>({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

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
          "id,consignment_number,branch_id,consignment_date,loading_deduction,additional_loading,branch:branches(branch_name)",
        )
        .gte("consignment_date", fromDate)
        .lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (branchId !== "all") query = query.eq("branch_id", branchId);
      const consignments = await fetchAll<ConsignmentRow>(() => query);
      const ids = consignments.map((row) => row.id);
      const branchIds = [
        ...new Set(consignments.map((row) => row.branch_id).filter(Boolean)),
      ] as string[];
      const [packages, rateTypes, rateEntries] = await Promise.all([
        ids.length
          ? fetchAll<PackageRow>(() =>
              supabase
                .from("consignment_package_information")
                .select("consignment_id,package_rate_type_id,package_type,basis,quantity,weight_kg")
                .in("consignment_id", ids),
            )
          : Promise.resolve([] as PackageRow[]),
        branchIds.length
          ? fetchAll<RateType>(() =>
              supabase
                .from("package_rate_types")
                .select("id,branch_id,package_type,basis,charge_mode")
                .in("branch_id", branchIds),
            )
          : Promise.resolve([] as RateType[]),
        branchIds.length
          ? fetchAll<RateEntry>(() =>
              supabase
                .from("package_rate_entries")
                .select("package_rate_type_id,from_value,to_value,amount")
                .in("branch_id", branchIds)
                .order("from_value"),
            )
          : Promise.resolve([] as RateEntry[]),
      ]);
      const types = new Map(rateTypes.map((type) => [type.id, type]));
      const packagesByConsignment = new Map<string, PackageRow[]>();
      for (const item of packages)
        packagesByConsignment.set(item.consignment_id, [
          ...(packagesByConsignment.get(item.consignment_id) ?? []),
          item,
        ]);
      const nextAdjustments: Record<string, Adjustment> = {};
      const nextRows = consignments.map((row) => {
        const packageRows = packagesByConsignment.get(row.id) ?? [];
        let calculated = 0;
        let rateMatched = packageRows.length > 0;
        let quantity = 0;
        let weight = 0;
        const packageDetails: PackageDetail[] = [];
        for (const item of packageRows) {
          quantity += num(item.quantity);
          weight += num(item.weight_kg);
          const result = packageCharge(item, types.get(item.package_rate_type_id), rateEntries);
          calculated += result.amount;
          rateMatched = rateMatched && result.matched;
          packageDetails.push(result.detail);
        }
        const deduction = num(row.loading_deduction);
        const addition = num(row.additional_loading);
        nextAdjustments[row.id] = { deduction: String(deduction), addition: String(addition) };
        return {
          ...row,
          package_count: packageRows.length,
          package_summary: [
            ...new Set(packageRows.map((item) => item.package_type).filter(Boolean)),
          ].join(", "),
          total_quantity: quantity,
          total_weight: weight,
          calculated_loading: calculated,
          final_loading: Math.max(0, calculated - deduction + addition),
          rateMatched,
          package_details: packageDetails,
        };
      });
      setAdjustments(nextAdjustments);
      setRows(nextRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load loading charges");
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
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.consignment_number, row.branch?.branch_name, row.package_summary].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [rows, search]);
  const totals = useMemo(
    () =>
      filtered.reduce(
        (result, row) => ({
          quantity: result.quantity + row.total_quantity,
          weight: result.weight + row.total_weight,
          calculated: result.calculated + row.calculated_loading,
          final: result.final + row.final_loading,
        }),
        { quantity: 0, weight: 0, calculated: 0, final: 0 },
      ),
    [filtered],
  );

  function updateAdjustment(id: string, key: keyof Adjustment, value: string) {
    const current = adjustments[id] ?? { deduction: "0", addition: "0" };
    const next = { ...current, [key]: value };
    setAdjustments((all) => ({ ...all, [id]: next }));
    setRows((all) =>
      all.map((row) =>
        row.id === id
          ? {
              ...row,
              final_loading: Math.max(
                0,
                row.calculated_loading - num(next.deduction) + num(next.addition),
              ),
            }
          : row,
      ),
    );
  }
  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function saveAdjustment(row: ReportRow) {
    const value = adjustments[row.id] ?? { deduction: "0", addition: "0" };
    setSavingId(row.id);
    const { error } = await supabase
      .from("consignments")
      .update({ loading_deduction: num(value.deduction), additional_loading: num(value.addition) })
      .eq("id", row.id);
    setSavingId(null);
    if (error) return toast.error(`Could not save loading adjustment: ${error.message}`);
    toast.success(`Loading adjustment saved for ${row.consignment_number}`);
  }
  function exportReport() {
    const csv = toCsv(
      filtered.map((row) => ({
        "Consignment No.": row.consignment_number,
        Date: row.consignment_date ?? "",
        Branch: row.branch?.branch_name ?? "",
        "Package Information": row.package_summary,
        "Package Quantity": row.total_quantity,
        "Package Weight (KG)": row.total_weight,
        "Calculated Loading": row.calculated_loading,
        "Loading Deduction": num(adjustments[row.id]?.deduction),
        "Additional Loading": num(adjustments[row.id]?.addition),
        "Final Loading": row.final_loading,
      })),
      [
        "Consignment No.",
        "Date",
        "Branch",
        "Package Information",
        "Package Quantity",
        "Package Weight (KG)",
        "Calculated Loading",
        "Loading Deduction",
        "Additional Loading",
        "Final Loading",
      ],
    );
    downloadCsv(csv, `loading_charges_${fromDate}_to_${toDate}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search consignment, branch or package…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From Date</label>
          <Input
            className="h-9 w-40"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To Date</label>
          <Input
            className="h-9 w-40"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Branch</label>
          <Select value={branchId} onValueChange={setBranchId}>
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
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportReport}
            disabled={!filtered.length}
            className="h-9 gap-2"
          >
            <Download className="size-4" /> Export
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void loadData()}
            disabled={loading}
            className="size-9"
            title="Refresh"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          {
            label: "Package Information",
            value: filtered.length.toLocaleString("en-IN"),
            color: "",
          },
          {
            label: "Package Quantity",
            value: displayNumber(totals.quantity),
            color: "text-indigo-600",
          },
          {
            label: "Package Weight",
            value: `${displayNumber(totals.weight)} kg`,
            color: "text-teal-600",
          },
          {
            label: "Calculated Loading",
            value: displayMoney(totals.calculated),
            color: "text-orange-600",
          },
          { label: "Final Loading", value: displayMoney(totals.final), color: "text-emerald-600" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={`mt-1 text-xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Loading is calculated from the selected branch&apos;s Package Rate master using Package
        Information. Final Loading = Calculated Loading − Deduction + Addition.
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Package className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">
            Package Information — Loading Charges ({filtered.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="w-10 px-2 py-3" />
                <th className="px-4 py-3">Consignment No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Package Information</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Weight (KG)</th>
                <th className="px-4 py-3 text-right">Calculated Loading</th>
                <th className="px-4 py-3 text-right">Deduction</th>
                <th className="px-4 py-3 text-right">Addition</th>
                <th className="px-4 py-3 text-right">Final Loading</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" /> Loading…
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-muted-foreground">
                    No Package Information found for these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const value = adjustments[row.id] ?? { deduction: "0", addition: "0" };
                  return (
                    <Fragment key={row.id}>
                      <tr key={row.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-2 py-3 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => toggleExpanded(row.id)}
                            title={
                              expanded.has(row.id) ? "Hide package details" : "Show package details"
                            }
                          >
                            {expanded.has(row.id) ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </Button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium">
                          {row.consignment_number}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {row.consignment_date ?? "—"}
                        </td>
                        <td className="px-4 py-3">{row.branch?.branch_name ?? "—"}</td>
                        <td className="px-4 py-3">
                          {row.package_summary || "—"}
                          {!row.rateMatched && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (rate not matched)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {displayNumber(row.total_quantity)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {displayNumber(row.total_weight)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {displayMoney(row.calculated_loading)}
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            className="ml-auto h-8 w-28 text-right"
                            type="number"
                            min="0"
                            step="0.01"
                            value={value.deduction}
                            onChange={(event) =>
                              updateAdjustment(row.id, "deduction", event.target.value)
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            className="ml-auto h-8 w-28 text-right"
                            type="number"
                            min="0"
                            step="0.01"
                            value={value.addition}
                            onChange={(event) =>
                              updateAdjustment(row.id, "addition", event.target.value)
                            }
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {displayMoney(row.final_loading)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void saveAdjustment(row)}
                            disabled={savingId === row.id}
                          >
                            <Save className="mr-1 size-3.5" />
                            {savingId === row.id ? "Saving…" : "Save"}
                          </Button>
                        </td>
                      </tr>
                      {expanded.has(row.id) && (
                        <tr key={`${row.id}-details`} className="bg-muted/20">
                          <td colSpan={12} className="px-6 py-4">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Package rate calculation details
                            </div>
                            {row.package_details.length ? (
                              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                                <table className="w-full min-w-[980px] text-xs">
                                  <thead className="bg-muted/40 text-left font-semibold text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2">Package</th>
                                      <th className="px-3 py-2">Basis / Value</th>
                                      <th className="px-3 py-2">Rate Mode</th>
                                      <th className="px-3 py-2">Matched Slab</th>
                                      <th className="px-3 py-2 text-right">Rate / Amount</th>
                                      <th className="px-3 py-2">Calculation</th>
                                      <th className="px-3 py-2 text-right">Calculated</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {row.package_details.map((detail, index) => {
                                      const slab =
                                        detail.slab_from == null
                                          ? "No matching slab"
                                          : `${displayNumber(detail.slab_from)}–${detail.slab_to == null ? "∞" : displayNumber(detail.slab_to)}`;
                                      const calculation = !detail.matched
                                        ? "Not calculated"
                                        : detail.charge_mode === "rate"
                                          ? `${displayMoney(detail.slab_amount ?? 0)} × ${displayNumber(detail.measure)}`
                                          : "Fixed slab amount";
                                      return (
                                        <tr key={`${row.id}-package-${index}`}>
                                          <td className="px-3 py-2 font-medium">
                                            {detail.rate_type}
                                          </td>
                                          <td className="px-3 py-2">
                                            {detail.basis} · {displayNumber(detail.measure)}
                                          </td>
                                          <td className="px-3 py-2">{detail.charge_mode}</td>
                                          <td className="px-3 py-2">{slab}</td>
                                          <td className="px-3 py-2 text-right tabular-nums">
                                            {detail.slab_amount == null
                                              ? "—"
                                              : displayMoney(detail.slab_amount)}
                                          </td>
                                          <td className="px-3 py-2">{calculation}</td>
                                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                            {displayMoney(detail.calculated_amount)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                No Package Information entries found.
                              </p>
                            )}
                            <div className="mt-3 text-xs text-muted-foreground">
                              Loading total: {displayMoney(row.calculated_loading)} − Deduction{" "}
                              {displayMoney(num(value.deduction))} + Addition{" "}
                              {displayMoney(num(value.addition))} ={" "}
                              <span className="font-semibold text-foreground">
                                {displayMoney(row.final_loading)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3" colSpan={7}>
                    Total ({filtered.length} consignments)
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {displayMoney(totals.calculated)}
                  </td>
                  <td />
                  <td />
                  <td className="px-4 py-3 text-right tabular-nums">
                    {displayMoney(totals.final)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
