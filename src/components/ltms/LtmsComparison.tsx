import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  LtmsDashboard,
  type LtmsDashboardAmounts,
  type LtmsDashboardFilters,
  type LtmsDashboardSummary,
} from "@/components/ltms/LtmsDashboard";

type Branch = { id: string; branch_name: string };
type Period = { fromDate: string; toDate: string };

type SummaryKey = "system" | "posted";
const comparisonMetrics: Array<[keyof LtmsDashboardAmounts, string]> = [
  ["trip", "Trip Expenditure"],
  ["workmen", "Workmen Charges"],
  ["transporter", "Transporter Expenditure"],
  ["unloading", "Unloading Income"],
  ["consignment", "Consignment Income"],
  ["net", "Consignment Net"],
  ["financeIncome", "LTMS Finance Income"],
  ["financeExpenditure", "LTMS Finance Expenditure"],
];

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthRange(offset: number): Period {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { fromDate: localDate(start), toDate: localDate(end) };
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function PeriodFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: Period;
  onChange: (next: Period) => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border bg-background p-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          From date
          <Input
            type="date"
            value={value.fromDate}
            onChange={(event) => onChange({ ...value, fromDate: event.target.value })}
            className="mt-1 h-9 text-sm text-foreground"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          To date
          <Input
            type="date"
            value={value.toDate}
            onChange={(event) => onChange({ ...value, toDate: event.target.value })}
            className="mt-1 h-9 text-sm text-foreground"
          />
        </label>
      </div>
    </section>
  );
}

function ComparisonSection({
  title,
  summaryKey,
  first,
  second,
  loading,
}: {
  title: string;
  summaryKey: SummaryKey;
  first: LtmsDashboardSummary | null;
  second: LtmsDashboardSummary | null;
  loading: boolean;
}) {
  const firstValues = first?.[summaryKey];
  const secondValues = second?.[summaryKey];
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Change is Period 2 minus Period 1.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Metric</th>
              <th className="px-4 py-3 text-right font-medium">Period 1</th>
              <th className="px-4 py-3 text-right font-medium">Period 2</th>
              <th className="px-4 py-3 text-right font-medium">Change</th>
              <th className="px-4 py-3 text-right font-medium">Change %</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparisonMetrics.map(([key, label]) => {
              const firstValue = firstValues?.[key] ?? 0;
              const secondValue = secondValues?.[key] ?? 0;
              const change = secondValue - firstValue;
              const changePercent =
                firstValue === 0
                  ? secondValue === 0
                    ? "0.0%"
                    : "—"
                  : `${((change / Math.abs(firstValue)) * 100).toFixed(1)}%`;
              const expenseMetric = [
                "trip",
                "workmen",
                "transporter",
                "financeExpenditure",
              ].includes(key);
              const changeColor =
                change === 0
                  ? "text-muted-foreground"
                  : expenseMetric
                    ? change < 0
                      ? "text-emerald-600"
                      : "text-red-600"
                    : change > 0
                      ? "text-emerald-600"
                      : "text-red-600";
              return (
                <tr key={key}>
                  <td className="px-4 py-3 font-medium">{label}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {loading || first?.loading ? "Loading…" : money(firstValue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {loading || second?.loading ? "Loading…" : money(secondValue)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${changeColor}`}>
                    {loading || first?.loading || second?.loading ? "Loading…" : money(change)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {loading || first?.loading || second?.loading ? "Loading…" : changePercent}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LtmsComparison() {
  const [firstPeriod, setFirstPeriod] = useState(() => monthRange(-1));
  const [secondPeriod, setSecondPeriod] = useState(() => monthRange(0));
  const [branchId, setBranchId] = useState("all");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [firstSummary, setFirstSummary] = useState<LtmsDashboardSummary | null>(null);
  const [secondSummary, setSecondSummary] = useState<LtmsDashboardSummary | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const firstFilters: LtmsDashboardFilters = { ...firstPeriod, branchId };
  const secondFilters: LtmsDashboardFilters = { ...secondPeriod, branchId };
  const filtersKey = (filters: LtmsDashboardFilters) =>
    `${filters.fromDate}|${filters.toDate}|${filters.branchId}`;
  const firstKey = filtersKey(firstFilters);
  const secondKey = filtersKey(secondFilters);
  const latestFirstKey = useRef(firstKey);
  const latestSecondKey = useRef(secondKey);
  latestFirstKey.current = firstKey;
  latestSecondKey.current = secondKey;
  const onFirstSummary = useCallback(
    (summary: LtmsDashboardSummary) => {
      if (latestFirstKey.current === firstKey) setFirstSummary(summary);
    },
    [firstKey],
  );
  const onSecondSummary = useCallback(
    (summary: LtmsDashboardSummary) => {
      if (latestSecondKey.current === secondKey) setSecondSummary(summary);
    },
    [secondKey],
  );
  const updateFirstPeriod = useCallback((period: Period) => {
    setFirstPeriod(period);
    setFirstSummary(null);
  }, []);
  const updateSecondPeriod = useCallback((period: Period) => {
    setSecondPeriod(period);
    setSecondSummary(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBranches() {
      setBranchesLoading(true);
      const { data, error } = await supabase
        .from("branches")
        .select("id,branch_name")
        .order("branch_name");
      if (cancelled) return;
      if (error) toast.error(`Could not load branches: ${error.message}`);
      else setBranches((data ?? []) as Branch[]);
      setBranchesLoading(false);
    }
    void loadBranches();
    return () => {
      cancelled = true;
    };
  }, []);

  const periodsValid =
    Boolean(
      firstPeriod.fromDate && firstPeriod.toDate && secondPeriod.fromDate && secondPeriod.toDate,
    ) &&
    firstPeriod.fromDate <= firstPeriod.toDate &&
    secondPeriod.fromDate <= secondPeriod.toDate;
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
        <div>
          <h2 className="font-semibold">Compare periods</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare the same LTMS metrics across two date ranges for one branch.
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_240px]">
          <PeriodFields title="Period 1" value={firstPeriod} onChange={updateFirstPeriod} />
          <PeriodFields title="Period 2" value={secondPeriod} onChange={updateSecondPeriod} />
          <label className="space-y-2 text-xs font-medium text-muted-foreground">
            Branch
            <Select
              value={branchId}
              onValueChange={(value) => {
                setBranchId(value);
                setFirstSummary(null);
                setSecondSummary(null);
              }}
              disabled={branchesLoading}
            >
              <SelectTrigger className="h-9 bg-background text-sm text-foreground">
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
          </label>
        </div>
        {(!firstPeriod.fromDate ||
          !firstPeriod.toDate ||
          firstPeriod.fromDate > firstPeriod.toDate) && (
          <p className="text-sm text-destructive">Period 1 needs a valid start and end date.</p>
        )}
        {(!secondPeriod.fromDate ||
          !secondPeriod.toDate ||
          secondPeriod.fromDate > secondPeriod.toDate) && (
          <p className="text-sm text-destructive">Period 2 needs a valid start and end date.</p>
        )}
      </section>

      {periodsValid ? (
        <>
          <div className="hidden" aria-hidden="true">
            <LtmsDashboard
              key={`period-1-${filtersKey(firstFilters)}`}
              initialFilters={firstFilters}
              onSummaryChange={onFirstSummary}
              comparisonMode
            />
            <LtmsDashboard
              key={`period-2-${filtersKey(secondFilters)}`}
              initialFilters={secondFilters}
              onSummaryChange={onSecondSummary}
              comparisonMode
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ComparisonSection
              title="In System"
              summaryKey="system"
              first={firstSummary}
              second={secondSummary}
              loading={!firstSummary || !secondSummary}
            />
            <ComparisonSection
              title="In System and Posted"
              summaryKey="posted"
              first={firstSummary}
              second={secondSummary}
              loading={!firstSummary || !secondSummary}
            />
          </div>
        </>
      ) : (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Select a valid start and end date for both periods to compare them.
        </div>
      )}
    </div>
  );
}
