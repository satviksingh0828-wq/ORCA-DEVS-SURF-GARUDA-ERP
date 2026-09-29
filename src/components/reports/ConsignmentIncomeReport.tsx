import { useEffect, useMemo, useState } from "react";
import { Download, Package, RefreshCw, Search } from "lucide-react";
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
  transporter_id: string | null;
  consignment_date: string | null;
  consignment_type: string | null;
  transport_mode: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
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

function findConsignmentEntry(
  entries: ConsignmentEntry[],
  consignment: ConsignmentRow,
): ConsignmentEntry | undefined {
  const mode = normalizeMode(consignment.transport_mode);
  const fromPin = String(consignment.from_pin_code ?? "").trim();
  const toPin = String(consignment.to_pin_code ?? "").trim();
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === mode &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}
export function ConsignmentIncomeReport() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(monthEnd);
  const [sourceId, setSourceId] = useState("all");
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

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
          "id,consignment_number,source_id,transporter_id,consignment_date,consignment_type,transport_mode,from_pin_code,to_pin_code,source:contracts(contract_name)",
        )
        .gte("consignment_date", fromDate)
        .lte("consignment_date", toDate)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (sourceId !== "all") query = query.eq("source_id", sourceId);

      const consignments = await fetchAll<ConsignmentRow>(() => query);
      const consignmentIds = consignments.map((row) => row.id);
      const sourceIds = [
        ...new Set(consignments.map((row) => row.source_id).filter(Boolean)),
      ] as string[];
      const transporterIds = [
        ...new Set(consignments.map((row) => row.transporter_id).filter(Boolean)),
      ] as string[];
      const [packages, contracts, entries] = await Promise.all([
        consignmentIds.length
          ? fetchAll<PackageRow>(() =>
              supabase
                .from("consignment_package_information")
                .select("consignment_id,quantity,weight_kg")
                .in("consignment_id", consignmentIds),
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
        transporterIds.length
          ? fetchAll<ConsignmentEntry>(() =>
              // The transporter-entry table is added by the app migration and is not in older generated Supabase types.
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
      const contractMap = new Map(contracts.map((contract) => [contract.id, contract]));
      const entriesByTransporter = new Map<string, ConsignmentEntry[]>();
      for (const entry of entries) {
        const transporterId = String(
          (entry as ConsignmentEntry & { transporter_id?: string }).transporter_id ?? "",
        );
        const list = entriesByTransporter.get(transporterId) ?? [];
        list.push(entry);
        entriesByTransporter.set(transporterId, list);
      }

      setRows(
        consignments.map((row) => {
          const packageTotal = packageTotals.get(row.id) ?? { quantity: 0, weight: 0 };
          const contract = row.source_id ? contractMap.get(row.source_id) : undefined;
          const entry = row.transporter_id
            ? findConsignmentEntry(entriesByTransporter.get(row.transporter_id) ?? [], row)
            : undefined;
          const charges = manifestCharges(contract, entry, {
            from_location_id: null,
            to_location_id: null,
            from_pin_code: row.from_pin_code,
            to_pin_code: row.to_pin_code,
            weight_kg: String(packageTotal.weight),
            quantity: String(packageTotal.quantity),
          });
          return {
            ...row,
            total_quantity: packageTotal.quantity,
            total_weight: packageTotal.weight,
            freight: charges.freight,
            loading: charges.loading,
            total_income: charges.freight + charges.loading,
            rateMatched: charges.matched && Boolean(entry),
          };
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load consignment income");
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
        Source: row.source?.contract_name ?? "",
        Mode: row.transport_mode ?? "",
        "Consignment From PIN": row.from_pin_code ?? "",
        "Consignment To PIN": row.to_pin_code ?? "",
        "Total Quantity": row.total_quantity,
        "Total Weight (KG)": row.total_weight,
        Freight: row.freight,
        Loading: row.loading,
        "Total Income": row.total_income,
      })),
      [
        "Consignment No.",
        "Date",
        "Source",
        "Mode",
        "Consignment From PIN",
        "Consignment To PIN",
        "Total Quantity",
        "Total Weight (KG)",
        "Freight",
        "Loading",
        "Total Income",
      ],
    );
    downloadCsv(csv, `consignment_income_${fromDate}_to_${toDate}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search consignment, PIN or mode…"
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
          <label className="text-xs font-medium text-muted-foreground">Source</label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
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

      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Default period is the current month. Freight and loading are calculated from the selected
        LTMS source using the consignment mode, source route PINs, and Package Information totals.
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
          <h2 className="text-sm font-semibold">Consignment Income ({filtered.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Consignment No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Consignment From PIN</th>
                <th className="px-4 py-3">Consignment To PIN</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Weight (KG)</th>
                <th className="px-4 py-3 text-right">Freight</th>
                <th className="px-4 py-3 text-right">Loading</th>
                <th className="px-4 py-3 text-right">Total Income</th>
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
                    No consignments found for these filters.
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
                    <td className="px-4 py-3">{row.source?.contract_name ?? "—"}</td>
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
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filtered.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3" colSpan={6}>
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
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}
