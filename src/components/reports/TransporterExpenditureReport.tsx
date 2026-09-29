import { useEffect, useMemo, useState } from "react";
import { Download, Package, Pencil, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type TransporterOption = { id: string; transporter_name: string };

type ConsignmentRow = {
  id: string;
  consignment_number: string;
  transporter_id: string | null;
  movement_mode: string | null;
  consignment_date: string | null;
  consignment_type: string | null;
  transport_mode: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  to_details?: { pincode?: string | null } | null;
  transporter?: { transporter_name?: string | null; pin_code?: string | null } | null;
  freight_deduction: number | string | null;
  additional_freight: number | string | null;
  loading_deduction: number | string | null;
  additional_loading: number | string | null;
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
  freight: number;
  loading: number;
  total_income: number;
  rateMatched: boolean;
};

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

function transporterRoutePins(consignment: ConsignmentRow) {
  const savedToPin = String(consignment.to_pin_code ?? "").trim();
  const firstEwayToPin = String(consignment.to_details?.pincode ?? savedToPin).trim();
  return consignment.movement_mode === "drop"
    ? { fromPin: savedToPin, toPin: firstEwayToPin }
    : { fromPin: String(consignment.from_pin_code ?? "").trim(), toPin: savedToPin };
}
function findTransporterEntry(
  entries: ConsignmentEntry[],
  consignment: ConsignmentRow,
): ConsignmentEntry | undefined {
  const mode = normalizeMode(consignment.transport_mode);
  const { fromPin, toPin } = transporterRoutePins(consignment);
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === mode &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}
export function TransporterExpenditureReport() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(monthEnd);
  const [transporterId, setTransporterId] = useState("all");
  const [transporters, setTransporters] = useState<TransporterOption[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ReportRow | null>(null);
  const [adjustments, setAdjustments] = useState({
    freight_deduction: "0",
    additional_freight: "0",
    loading_deduction: "0",
    additional_loading: "0",
  });
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  function openAdjustment(row: ReportRow) {
    setEditing(row);
    setAdjustments({
      freight_deduction: String(row.freight_deduction ?? 0),
      additional_freight: String(row.additional_freight ?? 0),
      loading_deduction: String(row.loading_deduction ?? 0),
      additional_loading: String(row.additional_loading ?? 0),
    });
  }

  async function saveAdjustment() {
    if (!editing) return;
    setSavingAdjustment(true);
    const { error } = await supabase
      .from("consignments")
      .update({
        freight_deduction: Number(adjustments.freight_deduction) || 0,
        additional_freight: Number(adjustments.additional_freight) || 0,
        loading_deduction: Number(adjustments.loading_deduction) || 0,
        additional_loading: Number(adjustments.additional_loading) || 0,
      })
      .eq("id", editing.id);
    setSavingAdjustment(false);
    if (error) return toast.error(`Could not save adjustments: ${error.message}`);
    setEditing(null);
    toast.success("Transporter expense adjustments saved");
    await loadData();
  }

  async function loadTransporters() {
    const { data, error } = await supabase
      .from("ltms_transporters")
      .select("id,transporter_name")
      .order("transporter_name");
    if (error) return toast.error(`Could not load transporters: ${error.message}`);
    setTransporters((data ?? []) as TransporterOption[]);
  }
  async function loadData() {
    if (!fromDate || !toDate) return toast.error("Select both From Date and To Date");
    if (fromDate > toDate) return toast.error("From Date cannot be after To Date");
    setLoading(true);
    try {
      let query = supabase
        .from("consignments")
        .select(
          "id,consignment_number,transporter_id,movement_mode,consignment_date,consignment_type,transport_mode,from_pin_code,to_pin_code,to_details,freight_deduction,additional_freight,loading_deduction,additional_loading,transporter:ltms_transporters(transporter_name,pin_code)",
        )
        .eq("consignment_type", "third_party")
        .gte("consignment_date", fromDate)
        .lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (transporterId !== "all") query = query.eq("transporter_id", transporterId);
      const consignments = await fetchAll<ConsignmentRow>(() => query);
      const consignmentIds = consignments.map((row) => row.id);
      const transporterIds = [
        ...new Set(consignments.map((row) => row.transporter_id).filter(Boolean)),
      ] as string[];
      const [packages, entries] = await Promise.all([
        consignmentIds.length
          ? fetchAll<PackageRow>(() =>
              supabase
                .from("consignment_package_information")
                .select("consignment_id,quantity,weight_kg")
                .in("consignment_id", consignmentIds),
            )
          : Promise.resolve([] as PackageRow[]),
        transporterIds.length
          ? fetchAll<ConsignmentEntry>(() =>
              // This table is created by the app migration and may be absent from older generated types.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as never as { from: (table: string) => any })
                .from("ltms_transporter_entries")
                .select(
                  "id,transporter_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges",
                )
                .in("transporter_id", transporterIds),
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
      const entriesByTransporter = new Map<string, ConsignmentEntry[]>();
      for (const entry of entries) {
        const id = String(
          (entry as ConsignmentEntry & { transporter_id?: string }).transporter_id ?? "",
        );
        const list = entriesByTransporter.get(id) ?? [];
        list.push(entry);
        entriesByTransporter.set(id, list);
      }
      setRows(
        consignments.map((row) => {
          const packageTotal = packageTotals.get(row.id) ?? { quantity: 0, weight: 0 };
          const route = transporterRoutePins(row);
          const entry = row.transporter_id
            ? findTransporterEntry(entriesByTransporter.get(row.transporter_id) ?? [], row)
            : undefined;
          const transporterContract: ContractLite = {
            id: row.transporter_id ?? "",
            contract_name: row.transporter?.transporter_name ?? "Transporter",
          };
          const charges = manifestCharges(transporterContract, entry, {
            from_location_id: null,
            to_location_id: null,
            from_pin_code: route.fromPin,
            to_pin_code: route.toPin,
            weight_kg: String(packageTotal.weight),
            quantity: String(packageTotal.quantity),
          });
          return {
            ...row,
            from_pin_code: route.fromPin,
            to_pin_code: route.toPin,
            total_quantity: packageTotal.quantity,
            total_weight: packageTotal.weight,
            freight: Math.max(
              0,
              charges.freight - num(row.freight_deduction) + num(row.additional_freight),
            ),
            loading: Math.max(
              0,
              charges.loading - num(row.loading_deduction) + num(row.additional_loading),
            ),
            total_income:
              Math.max(
                0,
                charges.freight - num(row.freight_deduction) + num(row.additional_freight),
              ) +
              Math.max(
                0,
                charges.loading - num(row.loading_deduction) + num(row.additional_loading),
              ),
            rateMatched: charges.matched && Boolean(entry),
          };
        }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load transporter expenditure",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadTransporters();
  }, []);

  useEffect(() => {
    void loadData();
  }, [fromDate, toDate, transporterId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [
        row.consignment_number,
        row.transporter?.transporter_name,
        row.transport_mode,
        row.from_pin_code,
        row.to_pin_code,
        row.movement_mode,
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
          freight: result.freight + row.freight,
          loading: result.loading + row.loading,
          income: result.income + row.total_income,
        }),
        { quantity: 0, weight: 0, freight: 0, loading: 0, income: 0 },
      ),
    [filtered],
  );

  function exportReport() {
    const csv = toCsv(
      filtered.map((row) => ({
        "Consignment No.": row.consignment_number,
        Date: row.consignment_date ?? "",
        Transporter: row.transporter?.transporter_name ?? "",
        Movement: row.movement_mode ?? "",
        Mode: row.transport_mode ?? "",
        "Transporter From PIN": row.from_pin_code ?? "",
        "Transporter To PIN": row.to_pin_code ?? "",
        "Total Quantity": row.total_quantity,
        "Total Weight (KG)": row.total_weight,
        Freight: row.freight,
        Loading: row.loading,
        "Total Expenditure": row.total_income,
      })),
      [
        "Consignment No.",
        "Date",
        "Transporter",
        "Movement",
        "Mode",
        "Transporter From PIN",
        "Transporter To PIN",
        "Total Quantity",
        "Total Weight (KG)",
        "Freight",
        "Loading",
        "Total Expenditure",
      ],
    );
    downloadCsv(csv, `transporter_expenditure_${fromDate}_to_${toDate}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search consignment, transporter, PIN or mode…"
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
          <label className="text-xs font-medium text-muted-foreground">Transporter</label>
          <Select value={transporterId} onValueChange={setTransporterId}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="All transporters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All transporters</SelectItem>
              {transporters.map((transporter) => (
                <SelectItem key={transporter.id} value={transporter.id}>
                  {transporter.transporter_name}
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
        Default period is the current month. Drop uses the saved transporter To PIN as From and the
        first E-Way Bill To PIN as destination. Pickup uses the saved From/To PIN route.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Consignments", value: filtered.length.toLocaleString("en-IN"), color: "" },
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
          { label: "Freight", value: displayMoney(totals.freight), color: "text-blue-600" },
          { label: "Loading", value: displayMoney(totals.loading), color: "text-orange-600" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={`mt-1 text-xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Package className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Transporter Expenditure ({filtered.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1650px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Consignment No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Transporter</th>
                <th className="px-4 py-3">Movement</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Transporter From PIN</th>
                <th className="px-4 py-3">Transporter To PIN</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Weight (KG)</th>
                <th className="px-4 py-3 text-right">Freight</th>
                <th className="px-4 py-3 text-right">Loading</th>
                <th className="px-4 py-3 text-right">Total Expenditure</th>
                <th className="px-4 py-3 text-right">Options</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" /> Loading…
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-muted-foreground">
                    No third-party consignments found for these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {row.consignment_number}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {row.consignment_date ?? "—"}
                    </td>
                    <td className="px-4 py-3">{row.transporter?.transporter_name ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{row.movement_mode ?? "—"}</td>
                    <td className="px-4 py-3">{row.transport_mode ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{row.from_pin_code || "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{row.to_pin_code || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {displayNumber(row.total_quantity)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {displayNumber(row.total_weight)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {displayMoney(row.freight)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {displayMoney(row.loading)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {displayMoney(row.total_income)}
                      {!row.rateMatched && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          (no route)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => openAdjustment(row)}>
                        <Pencil className="mr-1 size-3.5" /> Adjust
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filtered.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3" colSpan={7}>
                    Total ({filtered.length} consignments)
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {displayNumber(totals.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {displayNumber(totals.weight)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {displayMoney(totals.freight)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {displayMoney(totals.loading)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {displayMoney(totals.income)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transporter Expense Adjustments</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{editing.consignment_number}</div>
                <div className="text-xs text-muted-foreground">
                  {editing.transporter?.transporter_name || "Transporter"}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Freight", editing.freight],
                  ["Loading", editing.loading],
                  ["Total", editing.total_income],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 font-semibold tabular-nums">
                      {displayMoney(Number(value))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["freight_deduction", "Freight Deduction"],
                    ["additional_freight", "Additional Freight"],
                    ["loading_deduction", "Loading Deduction"],
                    ["additional_loading", "Additional Loading"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="space-y-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {label}
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={adjustments[key]}
                      onChange={(event) =>
                        setAdjustments((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Final freight/loading = calculated amount − deduction + additional amount.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveAdjustment()} disabled={savingAdjustment}>
              {savingAdjustment ? "Saving…" : "Save Adjustments"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
