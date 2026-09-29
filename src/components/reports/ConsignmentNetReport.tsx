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
import { manifestCharges, num, type ContractLite, type EntryLite } from "@/lib/trip-calc";

type BranchOption = { id: string; branch_name: string };
type ConsignmentRow = {
  id: string;
  consignment_number: string;
  branch_id: string | null;
  consignment_date: string | null;
  consignment_type: string | null;
  movement_mode: string | null;
  transport_mode: string | null;
  trip_id: string | null;
  source_id: string | null;
  transporter_id: string | null;
  transporter_source_id: string | null;
  freight_deduction: number | string | null;
  additional_freight: number | string | null;
  loading_deduction: number | string | null;
  additional_loading: number | string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  to_details?: { pincode?: string | null } | null;
};
type PackageRow = {
  consignment_id: string;
  package_rate_type_id: string;
  package_type: string;
  basis: "quantity" | "weight";
  quantity: number | string | null;
  weight_kg: number | string | null;
};
type ConsignmentEntry = EntryLite & { mode?: string | null };
type LoadingRateType = {
  id: string;
  branch_id: string;
  package_type: string;
  basis: "quantity" | "weight";
  charge_mode: "fixed" | "rate";
};
type LoadingRateEntry = {
  package_rate_type_id: string;
  from_value: number | string;
  to_value: number | string | null;
  amount: number | string;
};
type TripRow = {
  id: string;
  ownership: string;
  vehicle_id: string | null;
  driver_id: string | null;
  third_party_vehicle_number: string | null;
  expense_hire_charges?: number | string | null;
  expense_toll_charges?: number | string | null;
  expense_toll_cash?: number | string | null;
  expense_fuel?: number | string | null;
  expense_driver_bata?: number | string | null;
  expense_morning?: number | string | null;
  expense_night?: number | string | null;
  expense_sunday?: number | string | null;
  expense_parking?: number | string | null;
  expense_dala?: number | string | null;
  expense_unloading?: number | string | null;
};
type TripExpenseRow = { trip_id: string; amount: number | string | null };
type ReportRow = {
  id: string;
  consignment_number: string;
  consignment_date: string;
  income: number;
  transporter_expenditure: number | null;
  loading_charges: number;
  trip_expenditure: number | null;
  total_expenditure: number;
  net: number;
};

type Manifest = {
  from_location_id: null;
  to_location_id: null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  weight_kg: string;
  quantity: string;
};

const moneyFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const displayMoney = (value: number) => moneyFormat.format(value);
const optionalMoney = (value: number | null) => (value == null ? "" : displayMoney(value));

function monthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function normalizeMode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
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
function findTransporterEntry(entries: ConsignmentEntry[], row: ConsignmentRow) {
  const savedToPin = String(row.to_pin_code ?? "").trim();
  const firstEwayToPin = String(row.to_details?.pincode ?? savedToPin).trim();
  const fromPin =
    row.movement_mode === "drop" ? savedToPin : String(row.from_pin_code ?? "").trim();
  const toPin = row.movement_mode === "drop" ? firstEwayToPin : savedToPin;
  const mode = normalizeMode(row.transport_mode);
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === mode &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}
function packageCharge(
  item: PackageRow,
  type: LoadingRateType | undefined,
  entries: LoadingRateEntry[],
) {
  if (!type) return { amount: 0, matched: false };
  const measure = type.basis === "weight" ? num(item.weight_kg) : num(item.quantity);
  const slab = entries
    .filter((entry) => entry.package_rate_type_id === type.id)
    .sort((a, b) => num(b.from_value) - num(a.from_value))
    .find(
      (entry) =>
        num(entry.from_value) <= measure &&
        (entry.to_value == null || measure <= num(entry.to_value)),
    );
  if (!slab) return { amount: 0, matched: false };
  return {
    amount: type.charge_mode === "rate" ? num(slab.amount) * measure : num(slab.amount),
    matched: true,
  };
}

export function ConsignmentNetReport() {
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
          "id,consignment_number,branch_id,consignment_date,consignment_type,movement_mode,transport_mode,trip_id,source_id,transporter_id,transporter_source_id,freight_deduction,additional_freight,loading_deduction,additional_loading,from_pin_code,to_pin_code,to_details",
        )
        .gte("consignment_date", fromDate)
        .lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (branchId !== "all") query = query.eq("branch_id", branchId);
      const consignments = await fetchAll<ConsignmentRow>(() => query);
      const consignmentIds = consignments.map((row) => row.id);
      const branchIds = [
        ...new Set(consignments.map((row) => row.branch_id).filter(Boolean)),
      ] as string[];
      const sourceIds = [
        ...new Set(consignments.map((row) => row.source_id).filter(Boolean)),
      ] as string[];
      const transporterIds = [
        ...new Set(consignments.map((row) => row.transporter_id).filter(Boolean)),
      ] as string[];
      const tripIds = [
        ...new Set(consignments.map((row) => row.trip_id).filter(Boolean)),
      ] as string[];

      const [
        packages,
        contracts,
        incomeEntries,
        transporterEntries,
        loadingTypes,
        loadingEntries,
        trips,
        tripExpenses,
      ] = await Promise.all([
        consignmentIds.length
          ? fetchAll<PackageRow>(() =>
              supabase
                .from("consignment_package_information")
                .select("consignment_id,package_rate_type_id,package_type,basis,quantity,weight_kg")
                .in("consignment_id", consignmentIds),
            )
          : Promise.resolve([] as PackageRow[]),
        sourceIds.length
          ? fetchAll<ContractLite>(() =>
              supabase.from("contracts").select("id,contract_name").in("id", sourceIds),
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
        transporterIds.length
          ? fetchAll<ConsignmentEntry>(() =>
              (supabase as never as { from: (table: string) => any })
                .from("ltms_transporter_entries")
                .select(
                  "id,transporter_id,source_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges",
                )
                .in("transporter_id", transporterIds),
            )
          : Promise.resolve([] as ConsignmentEntry[]),
        branchIds.length
          ? fetchAll<LoadingRateType>(() =>
              supabase
                .from("package_rate_types")
                .select("id,branch_id,package_type,basis,charge_mode")
                .in("branch_id", branchIds),
            )
          : Promise.resolve([] as LoadingRateType[]),
        branchIds.length
          ? fetchAll<LoadingRateEntry>(() =>
              supabase
                .from("package_rate_entries")
                .select("package_rate_type_id,from_value,to_value,amount")
                .in("branch_id", branchIds),
            )
          : Promise.resolve([] as LoadingRateEntry[]),
        tripIds.length
          ? fetchAll<TripRow>(() =>
              supabase
                .from("trips")
                .select(
                  "id,ownership,vehicle_id,driver_id,third_party_vehicle_number,expense_hire_charges,expense_toll_charges,expense_toll_cash,expense_fuel,expense_driver_bata,expense_morning,expense_night,expense_sunday,expense_parking,expense_dala,expense_unloading",
                )
                .in("id", tripIds),
            )
          : Promise.resolve([] as TripRow[]),
        tripIds.length
          ? fetchAll<TripExpenseRow>(() =>
              supabase.from("trip_expenses").select("trip_id,amount").in("trip_id", tripIds),
            )
          : Promise.resolve([] as TripExpenseRow[]),
      ]);

      const packageMap = new Map<string, PackageRow[]>();
      for (const item of packages)
        packageMap.set(item.consignment_id, [...(packageMap.get(item.consignment_id) ?? []), item]);
      const contractMap = new Map(contracts.map((contract) => [contract.id, contract]));
      const incomeEntriesBySource = new Map<string, ConsignmentEntry[]>();
      for (const entry of incomeEntries)
        incomeEntriesBySource.set(entry.contract_id, [
          ...(incomeEntriesBySource.get(entry.contract_id) ?? []),
          entry,
        ]);
      const transporterEntriesByScope = new Map<string, ConsignmentEntry[]>();
      for (const entry of transporterEntries) {
        const key = String(
          (entry as ConsignmentEntry & { source_id?: string }).source_id ??
            (entry as ConsignmentEntry & { transporter_id?: string }).transporter_id ??
            "",
        );
        transporterEntriesByScope.set(key, [...(transporterEntriesByScope.get(key) ?? []), entry]);
      }
      const loadingTypesById = new Map(loadingTypes.map((type) => [type.id, type]));
      const expensesByTrip = new Map<string, number>();
      for (const expense of tripExpenses)
        expensesByTrip.set(
          expense.trip_id,
          (expensesByTrip.get(expense.trip_id) ?? 0) + num(expense.amount),
        );
      const tripMap = new Map(trips.map((trip) => [trip.id, trip]));
      const tripWeights = new Map<string, number>();
      for (const row of consignments) {
        const tripId = row.trip_id;
        const trip = tripId ? tripMap.get(tripId) : undefined;
        const eligible =
          trip &&
          (String(trip.ownership).toLowerCase() === "own" ||
            (String(row.consignment_type).toLowerCase() === "third_party" &&
              String(row.movement_mode).toLowerCase() === "drop"));
        if (tripId && eligible) {
          tripWeights.set(
            tripId,
            (tripWeights.get(tripId) ?? 0) +
              (packageMap.get(row.id) ?? []).reduce((sum, item) => sum + num(item.weight_kg), 0),
          );
        }
      }
      const structuredKeys = [
        "expense_hire_charges",
        "expense_toll_charges",
        "expense_toll_cash",
        "expense_fuel",
        "expense_driver_bata",
        "expense_morning",
        "expense_night",
        "expense_sunday",
        "expense_parking",
        "expense_dala",
        "expense_unloading",
      ] as const;

      setRows(
        consignments.map((row) => {
          const items = packageMap.get(row.id) ?? [];
          const packageTotals = items.reduce(
            (result, item) => ({
              quantity: result.quantity + num(item.quantity),
              weight: result.weight + num(item.weight_kg),
            }),
            { quantity: 0, weight: 0 },
          );
          const manifest: Manifest = {
            from_location_id: null,
            to_location_id: null,
            from_pin_code: row.from_pin_code,
            to_pin_code: row.to_pin_code,
            weight_kg: String(packageTotals.weight),
            quantity: String(packageTotals.quantity),
          };
          const incomeEntry = row.source_id
            ? findEntry(incomeEntriesBySource.get(row.source_id) ?? [], row)
            : undefined;
          const income = manifestCharges(
            row.source_id ? contractMap.get(row.source_id) : undefined,
            incomeEntry,
            manifest,
          );
          const transporterEntry = row.transporter_id
            ? findTransporterEntry(
                transporterEntriesByScope.get(row.transporter_source_id ?? row.transporter_id) ??
                  [],
                row,
              )
            : undefined;
          const transporter =
            String(row.consignment_type ?? "").toLowerCase() === "third_party" && transporterEntry
              ? manifestCharges(
                  { id: row.transporter_id ?? "", contract_name: "Transporter" },
                  transporterEntry,
                  {
                    ...manifest,
                    from_pin_code:
                      row.movement_mode === "drop" ? row.to_pin_code : row.from_pin_code,
                    to_pin_code:
                      row.movement_mode === "drop"
                        ? (row.to_details?.pincode ?? row.to_pin_code)
                        : row.to_pin_code,
                  },
                )
              : null;
          const calculatedLoading = items.reduce(
            (sum, item) =>
              sum +
              packageCharge(item, loadingTypesById.get(item.package_rate_type_id), loadingEntries)
                .amount,
            0,
          );
          const loading = Math.max(
            0,
            calculatedLoading - num(row.loading_deduction) + num(row.additional_loading),
          );
          const tripId = row.trip_id;
          const trip = tripId ? tripMap.get(tripId) : undefined;
          const eligibleTrip =
            trip &&
            (String(trip.ownership).toLowerCase() === "own" ||
              (String(row.consignment_type).toLowerCase() === "third_party" &&
                String(row.movement_mode).toLowerCase() === "drop"));
          const structured = trip
            ? structuredKeys.reduce((sum, key) => sum + num(trip[key]), 0)
            : 0;
          const tripTotal = trip
            ? structured > 0
              ? structured
              : (expensesByTrip.get(trip.id) ?? 0)
            : 0;
          const weight = items.reduce((sum, item) => sum + num(item.weight_kg), 0);
          const tripExpenditure =
            eligibleTrip && tripTotal > 0 && (tripWeights.get(trip.id) ?? 0) > 0
              ? (tripTotal / (tripWeights.get(trip.id) ?? 1)) * weight
              : null;
          const transporterExpenditure = transporter
            ? Math.max(
                0,
                transporter.freight - num(row.freight_deduction) + num(row.additional_freight),
              ) +
              Math.max(
                0,
                transporter.loading - num(row.loading_deduction) + num(row.additional_loading),
              )
            : null;
          const totalExpenditure = (transporterExpenditure ?? 0) + loading + (tripExpenditure ?? 0);
          return {
            id: row.id,
            consignment_number: row.consignment_number,
            consignment_date: row.consignment_date ?? "",
            income: income.freight + income.loading,
            transporter_expenditure: transporterExpenditure,
            loading_charges: loading,
            trip_expenditure: tripExpenditure,
            total_expenditure: totalExpenditure,
            net: income.freight + income.loading - totalExpenditure,
          };
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Consignment Net report");
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
    const value = search.trim().toLowerCase();
    return value
      ? rows.filter((row) => row.consignment_number.toLowerCase().includes(value))
      : rows;
  }, [rows, search]);
  const totals = useMemo(
    () =>
      filtered.reduce(
        (result, row) => ({
          income: result.income + row.income,
          expenditure: result.expenditure + row.total_expenditure,
          net: result.net + row.net,
        }),
        { income: 0, expenditure: 0, net: 0 },
      ),
    [filtered],
  );

  function exportReport() {
    const csv = toCsv(
      filtered.map((row) => ({
        "Consignment Number": row.consignment_number,
        Date: row.consignment_date,
        "Total Income": row.income,
        "Transporter Expenditure":
          row.transporter_expenditure == null ? "" : -row.transporter_expenditure,
        "Loading Charges": -row.loading_charges,
        "Trip Expenditure": row.trip_expenditure == null ? "" : -row.trip_expenditure,
        "Total Expenditure": -row.total_expenditure,
        "Net Income/Expenditure": row.net,
      })),
      [
        "Consignment Number",
        "Date",
        "Total Income",
        "Transporter Expenditure",
        "Loading Charges",
        "Trip Expenditure",
        "Total Expenditure",
        "Net Income/Expenditure",
      ],
    );
    downloadCsv(csv, `consignment_net_${fromDate}_to_${toDate}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search consignment number…"
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
            <Download className="size-4" /> Export CSV
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Total Income</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{displayMoney(totals.income)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Total Expenditure</p>
          <p className="mt-1 text-xl font-bold text-red-600">{displayMoney(totals.expenditure)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Net</p>
          <p
            className={`mt-1 text-xl font-bold ${totals.net >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {displayMoney(totals.net)}
          </p>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Consignment Net ({filtered.length})</h2>
          <span className="text-xs text-muted-foreground">Expenses are negative in CSV export</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Consignment Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Total Income</th>
                <th className="px-4 py-3 text-right">Transporter Expenditure</th>
                <th className="px-4 py-3 text-right">Loading Charges</th>
                <th className="px-4 py-3 text-right">Trip Expenditure</th>
                <th className="px-4 py-3 text-right">Total Expenditure</th>
                <th className="px-4 py-3 text-right">Net Income/Expenditure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" /> Loading…
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    No consignments found for these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{row.consignment_number}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.consignment_date || "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">
                      {displayMoney(row.income)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {optionalMoney(row.transporter_expenditure)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {displayMoney(row.loading_charges)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {optionalMoney(row.trip_expenditure)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-600">
                      {displayMoney(row.total_expenditure)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${row.net >= 0 ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {displayMoney(row.net)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
