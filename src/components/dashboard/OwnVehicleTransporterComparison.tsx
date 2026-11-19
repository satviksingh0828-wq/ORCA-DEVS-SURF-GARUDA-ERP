import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  currentFinancialYearStart,
  financialYearLabel,
  financialYearOptions,
} from "@/lib/financial-year";
import { serverFetchPnLPeriod, type PeriodSpec, type PnLRawData } from "@/lib/pnl";
import { inr } from "@/lib/trip-calc";

export function OwnVehicleTransporterComparison() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState("0");
  const [financialYear, setFinancialYear] = useState(String(currentFinancialYearStart()));
  const [branchId, setBranchId] = useState("all");
  const [data, setData] = useState<PnLRawData | null>(null);
  const [loading, setLoading] = useState(true);
  const years = useMemo(() => financialYearOptions(currentYear), [currentYear]);
  const calendarYears = useMemo(
    () => Array.from({ length: 6 }, (_, index) => currentYear - 3 + index),
    [currentYear],
  );
  const months = [
    { value: "0", label: "All Year" },
    ...Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      label: new Date(2000, index).toLocaleString("en", { month: "long" }),
    })),
  ];

  async function load() {
    setLoading(true);
    try {
      const period: PeriodSpec =
        financialYear !== "none"
          ? { financialYearStart: Number(financialYear) }
          : {
              year: Number(year),
              ...(Number(month) > 0 ? { month: Number(month) } : {}),
            };
      setData(await serverFetchPnLPeriod({ data: { period } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load comparison");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [financialYear, month, year]);

  const comparison = useMemo(() => {
    const trips = (data?.closedTrips ?? []).filter(
      (trip) => branchId === "all" || trip.branch_id === branchId,
    );
    const summarize = (own: boolean) => {
      const selected = trips.filter((trip) =>
        own
          ? trip.ownership === "own" || trip.ownership === "owned"
          : trip.ownership === "third_party" || Boolean(trip.rental_id) || Boolean(trip.transporter_id),
      );
      const income = selected.reduce((sum, trip) => sum + trip.total_income, 0);
      const expense = selected.reduce((sum, trip) => sum + trip.total_expense, 0);
      return { trips: selected.length, income, expense, net: income - expense };
    };
    return [
      { type: "Own Vehicles", ...summarize(true) },
      { type: "Rented / Transporters", ...summarize(false) },
    ];
  }, [branchId, data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Select
          value={year}
          onValueChange={(value) => {
            setYear(value);
            setFinancialYear("none");
          }}
        >
          <SelectTrigger className="h-9 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {calendarYears.map((item) => (
              <SelectItem key={item} value={String(item)}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={month}
          onValueChange={(value) => {
            setMonth(value);
            setFinancialYear("none");
          }}
        >
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={financialYear} onValueChange={setFinancialYear}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Financial Year: None</SelectItem>
            {years.map((fy) => (
              <SelectItem key={fy.value} value={fy.value}>
                FY {fy.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="All Branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
            {data?.branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.branch_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {financialYear !== "none"
          ? `FY ${financialYearLabel(Number(financialYear))} · April through March`
          : Number(month) > 0
            ? `${months[Number(month)]?.label} ${year}`
            : `Calendar year ${year}`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {comparison.map((row) => (
          <div key={row.type} className="surface-card p-5">
            <h3 className="font-semibold">{row.type}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{row.trips} trips</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground">Income</p>
                <b>{inr(row.income)}</b>
              </div>
              <div>
                <p className="text-muted-foreground">Expense</p>
                <b>{inr(row.expense)}</b>
              </div>
              <div>
                <p className="text-muted-foreground">Net</p>
                <b className={row.net >= 0 ? "text-green-600" : "text-red-600"}>{inr(row.net)}</b>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="surface-card p-5">
        <h3 className="mb-4 font-semibold">Own Vehicle vs Transporter</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={comparison}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="type" />
            <YAxis />
            <Tooltip formatter={(value: number) => inr(value)} />
            <Legend />
            <Bar dataKey="income" name="Income" fill="#22c55e" />
            <Bar dataKey="expense" name="Expense" fill="#ef4444" />
            <Bar dataKey="net" name="Net" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
