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
import { reportDateRange, useReportFilters } from "@/lib/report-filters";

type ConsignmentRow = {
  id: string;
  consignment_number: string;
  branch_id: string | null;
  consignment_date: string | null;
  consignment_type: string | null;
  branch?: { branch_name?: string | null } | null;
  source?: { contract_name?: string | null } | null;
};

type PackageRow = {
  consignment_id: string;
  quantity: number | string | null;
  weight_kg: number | string | null;
};

type ReportRow = ConsignmentRow & {
  total_quantity: number;
  total_weight: number;
};

const MONTHS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const numberValue = (value: unknown) => Number(value ?? 0) || 0;
const formatNumber = (value: number) =>
  value.toLocaleString("en-IN", { maximumFractionDigits: 3 });

export function ConsignmentIncomeReport() {
  const { branchId, financialYear } = useReportFilters();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const years = useMemo(() => {
    const values: string[] = [];
    for (let value = now.getFullYear(); value >= 2020; value -= 1) values.push(String(value));
    return values;
  }, [now]);

  function calendarDateRange() {
    const start = `${year}-${month === "all" ? "01" : month}-01`;
    const end =
      month === "all"
        ? `${Number(year) + 1}-01-01`
        : Number(month) === 12
          ? `${Number(year) + 1}-01-01`
          : `${year}-${String(Number(month) + 1).padStart(2, "0")}-01`;
    return { start, end };
  }

  async function loadData() {
    setLoading(true);
    try {
      const { start, end } = reportDateRange(financialYear, calendarDateRange);
      let consignmentQuery = supabase
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,consignment_date,consignment_type,branch:branches(branch_name),source:contracts(contract_name)",
        )
        .gte("consignment_date", start)
        .lt("consignment_date", end)
        .order("consignment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (branchId !== "all") consignmentQuery = consignmentQuery.eq("branch_id", branchId);

      const consignments = await fetchAll<ConsignmentRow>(() => consignmentQuery);
      const consignmentIds = consignments.map((row) => row.id);
      const packages = consignmentIds.length
        ? await fetchAll<PackageRow>(() =>
            supabase
              .from("consignment_package_information")
              .select("consignment_id,quantity,weight_kg")
              .in("consignment_id", consignmentIds),
          )
        : [];
      const totals = new Map<string, { quantity: number; weight: number }>();
      for (const item of packages) {
        const current = totals.get(item.consignment_id) ?? { quantity: 0, weight: 0 };
        current.quantity += numberValue(item.quantity);
        current.weight += numberValue(item.weight_kg);
        totals.set(item.consignment_id, current);
      }
      setRows(
        consignments.map((row) => ({
          ...row,
          total_quantity: totals.get(row.id)?.quantity ?? 0,
          total_weight: totals.get(row.id)?.weight ?? 0,
        })),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load consignment income");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [branchId, financialYear, year, month]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [
        row.consignment_number,
        row.source?.contract_name,
        row.branch?.branch_name,
        row.consignment_type,
      ].some((value) => String(value ?? "").toLowerCase().includes(query)),
    );
  }, [rows, search]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (result, row) => ({
          quantity: result.quantity + row.total_quantity,
          weight: result.weight + row.total_weight,
        }),
        { quantity: 0, weight: 0 },
      ),
    [filtered],
  );

  function exportReport() {
    const csv = toCsv(
      filtered.map((row) => ({
        "Consignment No.": row.consignment_number,
        Date: row.consignment_date ?? "",
        Source: row.source?.contract_name ?? "",
        Branch: row.branch?.branch_name ?? "",
        Type: row.consignment_type === "third_party" ? "Third Party" : "Own",
        "Total Quantity": row.total_quantity,
        "Total Weight (KG)": row.total_weight,
      })),
      [
        "Consignment No.",
        "Date",
        "Source",
        "Branch",
        "Type",
        "Total Quantity",
        "Total Weight (KG)",
      ],
    );
    downloadCsv(csv, `consignment_income_${year}-${month === "all" ? "all" : month}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="h-9 pl-9"
            placeholder="Search consignment or source…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="h-9 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Months</SelectItem>
            {MONTHS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportReport} disabled={!filtered.length} className="h-9 gap-2">
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Consignments</p>
          <p className="mt-1 text-xl font-bold">{filtered.length.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Total Package Quantity</p>
          <p className="mt-1 text-xl font-bold text-indigo-600">{formatNumber(totals.quantity)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Total Package Weight</p>
          <p className="mt-1 text-xl font-bold text-teal-600">{formatNumber(totals.weight)} kg</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Package className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Consignment Income ({filtered.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Consignment No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Total Quantity</th>
                <th className="px-4 py-3 text-right">Total Weight (KG)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-6 animate-spin opacity-20" /> Loading…
                  </td>
                </tr>
              ) : !filtered.length ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No consignments found for these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{row.consignment_number}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {row.consignment_date ?? "—"}
                    </td>
                    <td className="px-4 py-3">{row.source?.contract_name ?? "—"}</td>
                    <td className="px-4 py-3">{row.branch?.branch_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {row.consignment_type === "third_party" ? "Third Party" : "Own"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(row.total_quantity)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(row.total_weight)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filtered.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3" colSpan={5}>
                    Total ({filtered.length} consignments)
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.quantity)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(totals.weight)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}
