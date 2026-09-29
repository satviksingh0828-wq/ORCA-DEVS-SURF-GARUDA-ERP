import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, Truck } from "lucide-react";
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
type TripRow = {
  id: string;
  trip_code: string;
  ownership: string;
  branch_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  third_party_vehicle_number: string | null;
  start_date: string | null;
  branch?: { branch_name?: string | null } | null;
};
type ConsignmentRow = {
  id: string;
  trip_id: string | null;
  consignment_number: string;
  consignment_type: string | null;
  movement_mode: string | null;
  consignment_date: string | null;
};
type PackageRow = { consignment_id: string; weight_kg: number | string | null };
type TripExpenseRow = { trip_id: string; amount: number | string | null };
type VehicleRow = { id: string; registration_number: string | null };
type DriverRow = { id: string; full_name: string | null; driver_code?: string | null };
type ReportRow = {
  id: string;
  trip_id: string;
  trip_code: string;
  ownership: string;
  branch: string;
  vehicle_number: string;
  driver: string;
  start_date: string;
  consignment_number: string;
  consignment_date: string;
  consignment_weight: number;
  trip_weight: number;
  trip_expenditure: number;
  consignment_expenditure: number;
};

const moneyFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const money = (value: number) => moneyFormat.format(value);
const quantity = (value: number) => numberFormat.format(value);
function monthStart(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function isEligibleMovement(trip: TripRow, consignment: ConsignmentRow) {
  const ownership = String(trip.ownership ?? "").toLowerCase();
  const type = String(consignment.consignment_type ?? "").toLowerCase();
  const mode = String(consignment.movement_mode ?? "").toLowerCase();
  return (
    ownership === "own" ||
    (ownership === "third_party" && type === "third_party" && mode === "drop")
  );
}

export function TripExpenditureReport() {
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
      let tripQuery = supabase
        .from("trips")
        .select(
          "id,trip_code,ownership,branch_id,vehicle_id,driver_id,third_party_vehicle_number,start_date,branch:branches(branch_name),expense_hire_charges,expense_toll_charges,expense_toll_cash,expense_fuel,expense_driver_bata,expense_morning,expense_night,expense_sunday,expense_parking,expense_dala,expense_unloading",
        )
        .in("ownership", ["own", "third_party"])
        .gte("start_date", fromDate)
        .lte("start_date", toDate)
        .order("start_date", { ascending: false });
      if (branchId !== "all") tripQuery = tripQuery.eq("branch_id", branchId);
      const trips = await fetchAll<TripRow & Record<string, unknown>>(() => tripQuery);
      const tripIds = trips.map((trip) => trip.id);
      if (!tripIds.length) {
        setRows([]);
        return;
      }
      const [consignments, tripExpenses, vehicles, drivers] = await Promise.all([
        fetchAll<ConsignmentRow>(() =>
          supabase
            .from("consignments")
            .select("id,trip_id,consignment_number,consignment_type,movement_mode,consignment_date")
            .in("trip_id", tripIds),
        ),
        fetchAll<TripExpenseRow>(() =>
          supabase.from("trip_expenses").select("trip_id,amount").in("trip_id", tripIds),
        ),
        fetchAll<VehicleRow>(() =>
          supabase
            .from("vehicles")
            .select("id,registration_number")
            .in("id", [
              ...new Set(trips.map((trip) => trip.vehicle_id).filter(Boolean)),
            ] as string[]),
        ),
        fetchAll<DriverRow>(() =>
          supabase
            .from("drivers")
            .select("id,full_name,driver_code")
            .in("id", [
              ...new Set(trips.map((trip) => trip.driver_id).filter(Boolean)),
            ] as string[]),
        ),
      ]);
      const consignmentIds = consignments.map((consignment) => consignment.id);
      const packages = consignmentIds.length
        ? await fetchAll<PackageRow>(() =>
            supabase
              .from("consignment_package_information")
              .select("consignment_id,weight_kg")
              .in("consignment_id", consignmentIds),
          )
        : [];
      const packagesByConsignment = new Map<string, number>();
      for (const item of packages)
        packagesByConsignment.set(
          item.consignment_id,
          (packagesByConsignment.get(item.consignment_id) ?? 0) + num(item.weight_kg),
        );
      const expensesByTrip = new Map<string, number>();
      for (const expense of tripExpenses)
        expensesByTrip.set(
          expense.trip_id,
          (expensesByTrip.get(expense.trip_id) ?? 0) + num(expense.amount),
        );
      const vehicleMap = new Map(
        vehicles.map((vehicle) => [vehicle.id, vehicle.registration_number ?? "—"]),
      );
      const driverMap = new Map(
        drivers.map((driver) => [driver.id, driver.full_name || driver.driver_code || "—"]),
      );
      const nextRows: ReportRow[] = [];
      for (const trip of trips) {
        const assigned = consignments.filter(
          (consignment) => consignment.trip_id === trip.id && isEligibleMovement(trip, consignment),
        );
        if (!assigned.length) continue;
        const weights = assigned.map((consignment) => ({
          consignment,
          weight: packagesByConsignment.get(consignment.id) ?? 0,
        }));
        const tripWeight = weights.reduce((sum, item) => sum + item.weight, 0);
        const structuredExpense = [
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
        ].reduce((sum, key) => sum + num(trip[key]), 0);
        const lineExpense = expensesByTrip.get(trip.id) ?? 0;
        const tripExpenditure = structuredExpense > 0 ? structuredExpense : lineExpense;
        for (const item of weights) {
          nextRows.push({
            id: item.consignment.id,
            trip_id: trip.id,
            trip_code: trip.trip_code,
            ownership: trip.ownership === "third_party" ? "Third Party Drop" : "Own",
            branch: trip.branch?.branch_name ?? "—",
            vehicle_number:
              trip.ownership === "third_party"
                ? trip.third_party_vehicle_number || vehicleMap.get(trip.vehicle_id ?? "") || "—"
                : vehicleMap.get(trip.vehicle_id ?? "") || "—",
            driver: driverMap.get(trip.driver_id ?? "") || "—",
            start_date: trip.start_date ?? "—",
            consignment_number: item.consignment.consignment_number,
            consignment_date: item.consignment.consignment_date ?? "—",
            consignment_weight: item.weight,
            trip_weight: tripWeight,
            trip_expenditure: tripExpenditure,
            consignment_expenditure:
              tripWeight > 0 ? (tripExpenditure / tripWeight) * item.weight : 0,
          });
        }
      }
      setRows(nextRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load trip expenditure");
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
      [
        row.trip_code,
        row.vehicle_number,
        row.driver,
        row.consignment_number,
        row.branch,
        row.ownership,
      ].some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [rows, search]);
  const totals = useMemo(
    () =>
      filtered.reduce(
        (result, row) => ({
          weight: result.weight + row.consignment_weight,
          expenditure: result.expenditure + row.consignment_expenditure,
        }),
        { weight: 0, expenditure: 0 },
      ),
    [filtered],
  );
  function exportReport() {
    const csv = toCsv(
      filtered.map((row) => ({
        "Trip Number": row.trip_code,
        Type: row.ownership,
        Branch: row.branch,
        "Vehicle Number": row.vehicle_number,
        Driver: row.driver,
        "Trip Date": row.start_date,
        "Consignment Number": row.consignment_number,
        "Consignment Weight (KG)": row.consignment_weight,
        "Trip Total Weight (KG)": row.trip_weight,
        "Trip Expenditure": row.trip_expenditure,
        "Consignment Expenditure": row.consignment_expenditure,
      })),
      [
        "Trip Number",
        "Type",
        "Branch",
        "Vehicle Number",
        "Driver",
        "Trip Date",
        "Consignment Number",
        "Consignment Weight (KG)",
        "Trip Total Weight (KG)",
        "Trip Expenditure",
        "Consignment Expenditure",
      ],
    );
    downloadCsv(csv, `trip_expenditure_${fromDate}_to_${toDate}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search trip, vehicle, driver or consignment…"
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
      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        All consignments assigned to Own trips and Third Party Drop trips are included. Consignment
        Expenditure = (Trip Expenditure ÷ Total assigned Package Information Weight) × Consignment
        Package Information Weight.
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Trip Consignments</p>
          <p className="mt-1 text-xl font-bold">{filtered.length.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Package Weight</p>
          <p className="mt-1 text-xl font-bold text-teal-600">{quantity(totals.weight)} kg</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Allocated Expenditure</p>
          <p className="mt-1 text-xl font-bold text-orange-600">{money(totals.expenditure)}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Truck className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Trip Expenditure ({filtered.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1420px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Trip Number</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Vehicle Number</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Consignment Number</th>
                <th className="px-4 py-3">Trip Date</th>
                <th className="px-4 py-3 text-right">Consignment Weight</th>
                <th className="px-4 py-3 text-right">Total Trip Weight</th>
                <th className="px-4 py-3 text-right">Trip Expenditure</th>
                <th className="px-4 py-3 text-right">Consignment Expenditure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" /> Loading…
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-muted-foreground">
                    No own or third-party drop trips found.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={`${row.trip_id}-${row.id}`}
                    className="transition-colors hover:bg-muted/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{row.trip_code}</td>
                    <td className="px-4 py-3">{row.ownership}</td>
                    <td className="px-4 py-3">{row.vehicle_number}</td>
                    <td className="px-4 py-3">{row.driver}</td>
                    <td className="px-4 py-3">{row.branch}</td>
                    <td className="px-4 py-3 font-medium">{row.consignment_number}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.start_date}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {quantity(row.consignment_weight)} kg
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {quantity(row.trip_weight)} kg
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(row.trip_expenditure)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {money(row.consignment_expenditure)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3" colSpan={7}>
                    Total ({filtered.length} consignments)
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {quantity(totals.weight)} kg
                  </td>
                  <td />
                  <td />
                  <td className="px-4 py-3 text-right tabular-nums">{money(totals.expenditure)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
