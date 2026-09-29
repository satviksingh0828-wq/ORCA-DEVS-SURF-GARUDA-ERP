import { useEffect, useMemo, useState } from "react";
import { Download, Package, RefreshCw, Save, Search } from "lucide-react";
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
import { manifestCharges, num, type ContractLite, type EntryLite } from "@/lib/trip-calc";

type SourceOption = { id: string; contract_name: string };
type ConsignmentRow = {
  id: string;
  consignment_number: string;
  source_id: string | null;
  consignment_date: string | null;
  transport_mode: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  loading_deduction: number | string | null;
  additional_loading: number | string | null;
  source?: { contract_name?: string | null } | null;
};
type PackageRow = {
  consignment_id: string;
  quantity: number | string | null;
  weight_kg: number | string | null;
};
type ConsignmentEntry = EntryLite & { mode?: string | null };
type ReportRow = ConsignmentRow & {
  total_quantity: number;
  total_weight: number;
  calculated_loading: number;
  final_loading: number;
  rateMatched: boolean;
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
const normalizeMode = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toUpperCase();
function monthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function findEntry(entries: ConsignmentEntry[], row: ConsignmentRow) {
  const mode = normalizeMode(row.transport_mode);
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === mode &&
      String(entry.from_pin_code ?? "").trim() === String(row.from_pin_code ?? "").trim() &&
      String(entry.to_pin_code ?? "").trim() === String(row.to_pin_code ?? "").trim(),
  );
}

export function LoadingChargesReport() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(monthEnd);
  const [sourceId, setSourceId] = useState("all");
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, Adjustment>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadSources() {
    const { data, error } = await supabase
      .from("contracts")
      .select("id,contract_name")
      .eq("status", "active")
      .order("contract_name");
    if (error) return toast.error(`Could not load sources: ${error.message}`);
    setSources((data ?? []) as SourceOption[]);
  }

  async function loadData() {
    if (!fromDate || !toDate) return toast.error("Select both From Date and To Date");
    if (fromDate > toDate) return toast.error("From Date cannot be after To Date");
    setLoading(true);
    try {
      let query = supabase
        .from("consignments")
        .select(
          "id,consignment_number,source_id,consignment_date,transport_mode,from_pin_code,to_pin_code,loading_deduction,additional_loading,source:contracts(contract_name)",
        )
        .gte("consignment_date", fromDate)
        .lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (sourceId !== "all") query = query.eq("source_id", sourceId);
      const consignments = await fetchAll<ConsignmentRow>(() => query);
      const ids = consignments.map((row) => row.id);
      const sourceIds = [
        ...new Set(consignments.map((row) => row.source_id).filter(Boolean)),
      ] as string[];
      const [packages, contracts, entries] = await Promise.all([
        ids.length
          ? fetchAll<PackageRow>(() =>
              supabase
                .from("consignment_package_information")
                .select("consignment_id,quantity,weight_kg")
                .in("consignment_id", ids),
            )
          : Promise.resolve([] as PackageRow[]),
        sourceIds.length
          ? fetchAll<ContractLite>(() =>
              supabase
                .from("contracts")
                .select(
                  "id,contract_name,company_name,gstin,fixed_monthly_charge,fixed_yearly_charge",
                )
                .in("id", sourceIds),
            )
          : Promise.resolve([] as ContractLite[]),
        sourceIds.length
          ? fetchAll<ConsignmentEntry>(() =>
              supabase
                .from("contract_entries")
                .select(
                  "id,contract_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges,per_manifest_amount",
                )
                .in("contract_id", sourceIds),
            )
          : Promise.resolve([] as ConsignmentEntry[]),
      ]);
      const packageTotals = new Map<string, { quantity: number; weight: number }>();
      for (const item of packages) {
        const current = packageTotals.get(item.consignment_id) ?? { quantity: 0, weight: 0 };
        current.quantity += num(item.quantity);
        current.weight += num(item.weight_kg);
        packageTotals.set(item.consignment_id, current);
      }
      const contractMap = new Map(contracts.map((contract) => [contract.id, contract]));
      const entriesBySource = new Map<string, ConsignmentEntry[]>();
      for (const entry of entries)
        entriesBySource.set(entry.contract_id, [
          ...(entriesBySource.get(entry.contract_id) ?? []),
          entry,
        ]);
      const nextAdjustments: Record<string, Adjustment> = {};
      const nextRows = consignments.map((row) => {
        const packageTotal = packageTotals.get(row.id) ?? { quantity: 0, weight: 0 };
        const entry = row.source_id
          ? findEntry(entriesBySource.get(row.source_id) ?? [], row)
          : undefined;
        const charges = manifestCharges(
          row.source_id ? contractMap.get(row.source_id) : undefined,
          entry,
          {
            from_location_id: null,
            to_location_id: null,
            from_pin_code: row.from_pin_code,
            to_pin_code: row.to_pin_code,
            weight_kg: String(packageTotal.weight),
            quantity: String(packageTotal.quantity),
          },
        );
        const deduction = num(row.loading_deduction);
        const addition = num(row.additional_loading);
        nextAdjustments[row.id] = { deduction: String(deduction), addition: String(addition) };
        return {
          ...row,
          total_quantity: packageTotal.quantity,
          total_weight: packageTotal.weight,
          calculated_loading: charges.loading,
          final_loading: Math.max(0, charges.loading - deduction + addition),
          rateMatched: charges.matched && Boolean(entry),
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
    void loadSources();
  }, []);
  useEffect(() => {
    void loadData();
  }, [fromDate, toDate, sourceId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [
        row.consignment_number,
        row.source?.contract_name,
        row.transport_mode,
        row.from_pin_code,
        row.to_pin_code,
      ].some((value) =>
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
    setAdjustments((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { deduction: "0", addition: "0" }), [key]: value },
    }));
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              final_loading: Math.max(
                0,
                row.calculated_loading -
                  (key === "deduction" ? num(value) : num(adjustments[id]?.deduction)) +
                  (key === "addition" ? num(value) : num(adjustments[id]?.addition)),
              ),
            }
          : row,
      ),
    );
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
        Source: row.source?.contract_name ?? "",
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
        "Source",
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
            placeholder="Search consignment or source…"
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
          <label className="text-xs font-medium text-muted-foreground">Package Rate</label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue placeholder="All package rates" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All package rates</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.contract_name}
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        Loading is calculated from the selected Package Rate using Package Information quantity and
        weight. Final Loading = Calculated Loading − Deduction + Addition.
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Package className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">
            Package Information — Loading Charges ({filtered.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Consignment No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Package Rate</th>
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
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" /> Loading…
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-muted-foreground">
                    No Package Information found for these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const value = adjustments[row.id] ?? { deduction: "0", addition: "0" };
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3 font-medium">
                        {row.consignment_number}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {row.consignment_date ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {row.source?.contract_name ?? "—"}
                        {!row.rateMatched && (
                          <span className="ml-1 text-xs text-muted-foreground">(no rate)</span>
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
                  );
                })
              )}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3" colSpan={5}>
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
