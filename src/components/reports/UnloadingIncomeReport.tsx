import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const money = (value: number | string | null | undefined) =>
  Number(value ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const num = (value: number | string | null | undefined) => Number(value ?? 0);
const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

type PackageRow = {
  id: string;
  package_rate_type_id: string;
  package_type: string;
  source_id: string;
  quantity?: number | string | null;
  weight_kg?: number | string | null;
  source?: { contract_name?: string | null } | null;
};
type RateType = { id: string; basis: "quantity" | "weight"; charge_mode: "fixed" | "rate" };
type RateEntry = {
  package_rate_type_id: string;
  from_value: number | string;
  to_value?: number | string | null;
  amount: number | string;
};
type Receipt = {
  id: string;
  receipt_number?: string | null;
  receipt_date: string;
  unloading_date: string;
  unloading_amount_received: number | string | null;
  additional_income_mode: "approval" | "source" | "both" | "none";
  approval_amount: number | string | null;
  stock_inward_sources?: Array<{
    source_id: string;
    source?: { contract_name?: string | null } | null;
  }>;
  stock_inward_packages?: PackageRow[];
};
type CalcLine = PackageRow & {
  basis?: string;
  measure: number;
  from?: number;
  to?: number | null;
  rateAmount: number;
  calculated: number;
};
type ReportRow = Receipt & { sourceIncome: number; calculations: CalcLine[] };

async function fetchAll<T>(queryFactory: (from?: number) => any): Promise<T[]> {
  const result: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFactory(offset);
    if (error) throw error;
    result.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return result;
    offset += 1000;
  }
}

export function UnloadingIncomeReport() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(monthEnd);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    if (!fromDate || !toDate || fromDate > toDate) return toast.error("Select a valid date range");
    setLoading(true);
    try {
      const receipts = await fetchAll<Receipt>((offset = 0) =>
        supabase
          .from("stock_inward_receipts")
          .select(
            "id,receipt_number,receipt_date,unloading_date,unloading_amount_received,additional_income_mode,approval_amount,stock_inward_sources(source_id,source:contracts(contract_name)),stock_inward_packages(id,package_rate_type_id,package_type,source_id,quantity,weight_kg,source:contracts(contract_name))",
          )
          .gte("receipt_date", fromDate)
          .lte("receipt_date", toDate)
          .order("receipt_date", { ascending: false })
          .range(offset, offset + 999),
      );
      const typeIds = [
        ...new Set(
          receipts.flatMap((row) =>
            (row.stock_inward_packages ?? []).map((item) => item.package_rate_type_id),
          ),
        ),
      ];
      const [types, entries] = await Promise.all([
        typeIds.length
          ? fetchAll<RateType>((offset = 0) =>
              supabase
                .from("package_rate_types")
                .select("id,basis,charge_mode")
                .in("id", typeIds)
                .range(offset, offset + 999),
            )
          : Promise.resolve([] as RateType[]),
        typeIds.length
          ? fetchAll<RateEntry>((offset = 0) =>
              supabase
                .from("package_rate_entries")
                .select("package_rate_type_id,from_value,to_value,amount")
                .eq("rate_kind", "unloading")
                .in("package_rate_type_id", typeIds)
                .order("from_value")
                .range(offset, offset + 999),
            )
          : Promise.resolve([] as RateEntry[]),
      ]);
      const typeMap = new Map(types.map((type) => [type.id, type]));
      const next = receipts.map((receipt) => {
        const calculations = (receipt.stock_inward_packages ?? []).map((item) => {
          const type = typeMap.get(item.package_rate_type_id);
          const measure = type?.basis === "weight" ? num(item.weight_kg) : num(item.quantity);
          const slab = entries
            .filter((entry) => entry.package_rate_type_id === item.package_rate_type_id)
            .sort((a, b) => num(b.from_value) - num(a.from_value))
            .find(
              (entry) =>
                num(entry.from_value) <= measure &&
                (entry.to_value == null || measure <= num(entry.to_value)),
            );
          const rateAmount = num(slab?.amount);
          const calculated =
            slab && type ? (type.charge_mode === "rate" ? rateAmount * measure : rateAmount) : 0;
          return {
            ...item,
            basis: type?.basis,
            measure,
            from: slab ? num(slab.from_value) : undefined,
            to: slab?.to_value == null ? null : num(slab.to_value),
            rateAmount,
            calculated,
          };
        });
        return {
          ...receipt,
          calculations,
          sourceIncome: calculations.reduce((sum, line) => sum + line.calculated, 0),
        };
      });
      setRows(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load unloading income");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);
  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          received: sum.received + num(row.unloading_amount_received),
          approval:
            sum.approval +
            (row.additional_income_mode === "approval" || row.additional_income_mode === "both"
              ? num(row.approval_amount)
              : 0),
          source:
            sum.source +
            (row.additional_income_mode === "source" || row.additional_income_mode === "both"
              ? row.sourceIncome
              : 0),
        }),
        { received: 0, approval: 0, source: 0 },
      ),
    [rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="grid gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <Button type="button" onClick={() => void loadData()} disabled={loading}>
          <RefreshCw className="size-4" />
          {loading ? "Loading…" : "Load"}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Unloading amount received</p>
          <p className="mt-1 text-xl font-semibold">₹ {money(totals.received)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Approval charges</p>
          <p className="mt-1 text-xl font-semibold">₹ {money(totals.approval)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Source income</p>
          <p className="mt-1 text-xl font-semibold">₹ {money(totals.source)}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3">Stock Inward No.</th>
              <th className="px-3 py-3">Package Types</th>
              <th className="px-3 py-3">Sources</th>
              <th className="px-3 py-3 text-right">Unloading Amount Received</th>
              <th className="px-3 py-3">Additional Income Type</th>
              <th className="px-3 py-3 text-right">Approval Charges</th>
              <th className="px-3 py-3 text-right">Source Income</th>
              <th className="px-3 py-3">Calculation</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  No Stock Inward records found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const showApproval =
                  row.additional_income_mode === "approval" ||
                  row.additional_income_mode === "both";
                const showSource =
                  row.additional_income_mode === "source" || row.additional_income_mode === "both";
                const open = expanded === row.id;
                return (
                  <tbody key={row.id} className="contents">
                    <tr className="border-t border-border align-top">
                      <td className="px-3 py-3 font-medium">
                        {row.receipt_number ?? row.id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-3">
                        {[
                          ...new Set(
                            (row.stock_inward_packages ?? []).map((item) => item.package_type),
                          ),
                        ].join(", ") || "—"}
                      </td>
                      <td className="px-3 py-3">
                        {(row.stock_inward_sources ?? [])
                          .map((item) => item.source?.contract_name)
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        ₹ {money(row.unloading_amount_received)}
                      </td>
                      <td className="px-3 py-3 capitalize">{row.additional_income_mode}</td>
                      <td className="px-3 py-3 text-right">
                        {showApproval ? `₹ ${money(row.approval_amount)}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {showSource ? `₹ ${money(row.sourceIncome)}` : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setExpanded(open ? null : row.id)}
                        >
                          {open ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}{" "}
                          {open ? "Hide" : "View"}
                        </Button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="space-y-2">
                            <p className="font-medium">Source income calculation</p>
                            {row.calculations.length === 0 ? (
                              <p className="text-muted-foreground">
                                No package calculation available.
                              </p>
                            ) : (
                              row.calculations.map((line) => (
                                <div
                                  key={line.id}
                                  className="grid gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_1fr]"
                                >
                                  <span>
                                    <b>Package</b>
                                    <br />
                                    {line.package_type}
                                  </span>
                                  <span>
                                    <b>Source</b>
                                    <br />
                                    {line.source?.contract_name ?? "—"}
                                  </span>
                                  <span>
                                    <b>Basis / measure</b>
                                    <br />
                                    {line.basis ?? "—"} / {line.measure}
                                  </span>
                                  <span>
                                    <b>Slab</b>
                                    <br />
                                    {line.from ?? "—"} - {line.to ?? "∞"}
                                  </span>
                                  <span>
                                    <b>Rate/value</b>
                                    <br />₹ {money(line.rateAmount)}
                                  </span>
                                  <span>
                                    <b>Calculated</b>
                                    <br />₹ {money(line.calculated)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
