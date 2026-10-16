/* eslint-disable @typescript-eslint/no-explicit-any -- new LTMS tables are not in generated DB types yet. */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ConsignmentNetReport,
  type ConsignmentNetReportRow,
} from "@/components/reports/ConsignmentNetReport";
import { fetchAll } from "@/lib/fetch-all";

/* The report-era LTMS tables are newer than the generated Supabase types. */
const db = supabase as any;
type Amounts = {
  trip: number;
  workmen: number;
  transporter: number;
  consignment: number;
  net: number;
  unloading: number;
  financeIncome: number;
  financeExpenditure: number;
};
const zero = (): Amounts => ({
  trip: 0,
  workmen: 0,
  transporter: 0,
  consignment: 0,
  net: 0,
  unloading: 0,
  financeIncome: 0,
  financeExpenditure: 0,
});
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
const n = (value: unknown) => Number(value ?? 0) || 0;
const add = (rows: ConsignmentNetReportRow[]) =>
  rows.reduce(
    (sum, row) => ({
      trip: sum.trip + (row.trip_expenditure ?? 0),
      workmen: sum.workmen + row.loading_charges,
      transporter: sum.transporter + (row.transporter_expenditure ?? 0),
      consignment: sum.consignment + row.income,
      net: sum.net + row.net,
      unloading: sum.unloading,
    }),
    zero(),
  );

export function LtmsDashboard() {
  const [rows, setRows] = useState<ConsignmentNetReportRow[]>([]);
  const [system, setSystem] = useState<Amounts>(zero());
  const [posted, setPosted] = useState<Amounts>(zero());
  const [systemWorkmenUnloading, setSystemWorkmenUnloading] = useState(0);
  const [financeTotals, setFinanceTotals] = useState({ income: 0, expenditure: 0 });
  const [financeLoading, setFinanceLoading] = useState(false);
  const [loadingPosted, setLoadingPosted] = useState(false);
  const [filters, setFilters] = useState({
    fromDate: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`,
    toDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10),
    branchId: "all",
  });
  const onRowsChange = useCallback((value: ConsignmentNetReportRow[]) => setRows(value), []);
  const onFiltersChange = useCallback((value: typeof filters) => setFilters(value), []);

  useEffect(() => {
    let cancelled = false;
    async function loadFinanceTotals() {
      setFinanceLoading(true);
      try {
        const [incomes, expenditures] = await Promise.all([
          fetchAll<{ amount: string | number | null }>(() => {
            let query = db
              .from("incomes")
              .select("amount")
              .gte("entry_date", filters.fromDate)
              .lte("entry_date", filters.toDate);
            if (filters.branchId !== "all") query = query.eq("branch_id", filters.branchId);
            return query;
          }),
          fetchAll<{ amount: string | number | null }>(() => {
            let query = db
              .from("expenditures")
              .select("amount")
              .gte("entry_date", filters.fromDate)
              .lte("entry_date", filters.toDate);
            if (filters.branchId !== "all") query = query.eq("branch_id", filters.branchId);
            return query;
          }),
        ]);
        const next = {
          income: incomes.reduce((sum, row) => sum + n(row.amount), 0),
          expenditure: expenditures.reduce((sum, row) => sum + n(row.amount), 0),
        };
        if (!cancelled) setFinanceTotals(next);
      } catch (error) {
        if (!cancelled)
          toast.error(
            error instanceof Error ? error.message : "Could not load LTMS Finance totals",
          );
      } finally {
        if (!cancelled) setFinanceLoading(false);
      }
    }
    void loadFinanceTotals();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function loadUnloadingIncome() {
      try {
        let query = db
          .from("stock_inward_receipts")
          .select(
            "id,branch_id,receipt_date,unloading_amount_received,additional_income_mode,approval_amount,approval_income_journal_entry_id,unloading_received_journal_entry_id,unloading_deduction,additional_unloading,stock_inward_packages(package_rate_type_id,quantity,weight_kg)",
          )
          .gte("receipt_date", filters.fromDate)
          .lte("receipt_date", filters.toDate);
        if (filters.branchId !== "all") query = query.eq("branch_id", filters.branchId);
        const receiptsResult = await query;
        if (receiptsResult.error) throw receiptsResult.error;
        const receipts = receiptsResult.data ?? [];
        const branchIds = [...new Set(receipts.map((row: any) => row.branch_id).filter(Boolean))];
        const typeIds = [
          ...new Set(
            receipts.flatMap((row: any) =>
              (row.stock_inward_packages ?? []).map((item: any) => item.package_rate_type_id),
            ),
          ),
        ];
        const [typesResult, ratesResult] = await Promise.all([
          branchIds.length
            ? db
                .from("package_rate_types")
                .select("id,basis,charge_mode")
                .in("branch_id", branchIds)
            : Promise.resolve({ data: [], error: null }),
          typeIds.length
            ? db
                .from("package_rate_entries")
                .select("package_rate_type_id,from_value,to_value,amount")
                .eq("rate_kind", "unloading")
                .in("package_rate_type_id", typeIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (typesResult.error) throw typesResult.error;
        if (ratesResult.error) throw ratesResult.error;
        const receiptIds = receipts.map((row: any) => row.id);
        const sourceItemsResult = receiptIds.length
          ? await db
              .from("ltms_source_bill_stock_inward_items")
              .select("stock_inward_receipt_id,bill_id,source_income_amount")
              .in("stock_inward_receipt_id", receiptIds)
          : { data: [], error: null };
        if (sourceItemsResult.error) throw sourceItemsResult.error;
        const sourceItems = sourceItemsResult.data ?? [];
        const sourceBillIds = [...new Set(sourceItems.map((row: any) => row.bill_id))];
        const sourceBillsResult = sourceBillIds.length
          ? await db
              .from("ltms_source_bills")
              .select("id,journal_entry_id")
              .in("id", sourceBillIds)
              .is("deleted_at", null)
          : { data: [], error: null };
        if (sourceBillsResult.error) throw sourceBillsResult.error;
        const postedSourceBillIds = new Set(
          (sourceBillsResult.data ?? [])
            .filter((row: any) => row.journal_entry_id)
            .map((row: any) => row.id),
        );
        const sourcePostedByReceipt = new Map<string, number>();
        for (const item of sourceItems)
          if (postedSourceBillIds.has(item.bill_id))
            sourcePostedByReceipt.set(
              item.stock_inward_receipt_id,
              (sourcePostedByReceipt.get(item.stock_inward_receipt_id) ?? 0) +
                n(item.source_income_amount),
            );
        const typeMap = new Map((typesResult.data ?? []).map((row: any) => [row.id, row]));
        const rates = ratesResult.data ?? [];
        let all = 0;
        let postedAmount = 0;
        let finalWorkmenUnloading = 0;
        for (const receipt of receipts) {
          const mode = receipt.additional_income_mode;
          const approval = mode === "approval" || mode === "both" ? n(receipt.approval_amount) : 0;
          const source = (receipt.stock_inward_packages ?? []).reduce((sum: number, item: any) => {
            const type = typeMap.get(item.package_rate_type_id);
            const measure = type?.basis === "weight" ? n(item.weight_kg) : n(item.quantity);
            const slab = rates
              .filter((rate: any) => rate.package_rate_type_id === item.package_rate_type_id)
              .sort((a: any, b: any) => n(b.from_value) - n(a.from_value))
              .find(
                (rate: any) =>
                  n(rate.from_value) <= measure &&
                  (rate.to_value == null || measure <= n(rate.to_value)),
              );
            if (!type || !slab || !(mode === "source" || mode === "both")) return sum;
            return sum + (type.charge_mode === "rate" ? n(slab.amount) * measure : n(slab.amount));
          }, 0);
          const received = n(receipt.unloading_amount_received);
          all += received + approval + source;
          const calculatedUnloading = (receipt.stock_inward_packages ?? []).reduce(
            (sum: number, item: any) => {
              const type = typeMap.get(item.package_rate_type_id);
              const measure = type?.basis === "weight" ? n(item.weight_kg) : n(item.quantity);
              const slab = rates
                .filter((rate: any) => rate.package_rate_type_id === item.package_rate_type_id)
                .sort((a: any, b: any) => n(b.from_value) - n(a.from_value))
                .find(
                  (rate: any) =>
                    n(rate.from_value) <= measure &&
                    (rate.to_value == null || measure <= n(rate.to_value)),
                );
              if (!type || !slab) return sum;
              return (
                sum + (type.charge_mode === "rate" ? n(slab.amount) * measure : n(slab.amount))
              );
            },
            0,
          );
          finalWorkmenUnloading += Math.max(
            0,
            calculatedUnloading - n(receipt.unloading_deduction) + n(receipt.additional_unloading),
          );
          if (receipt.unloading_received_journal_entry_id) postedAmount += received;
          if (receipt.approval_income_journal_entry_id) postedAmount += approval;
          postedAmount += sourcePostedByReceipt.get(receipt.id) ?? 0;
        }
        if (!cancelled) {
          setSystem((current) => ({ ...current, unloading: all }));
          setPosted((current) => ({ ...current, unloading: postedAmount }));
          setSystemWorkmenUnloading(finalWorkmenUnloading);
        }
      } catch (error) {
        if (!cancelled)
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not load Unloading Income report values",
          );
      }
    }
    void loadUnloadingIncome();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function loadPosted() {
      setLoadingPosted(true);
      try {
        const all = add(rows);
        setSystem((current) => ({ ...all, unloading: current.unloading }));
        let receiptQuery = db
          .from("stock_inward_receipts")
          .select("id")
          .gte("receipt_date", filters.fromDate)
          .lte("receipt_date", filters.toDate);
        if (filters.branchId !== "all")
          receiptQuery = receiptQuery.eq("branch_id", filters.branchId);
        const receiptResult = await receiptQuery;
        if (receiptResult.error) throw receiptResult.error;
        const receiptIds = (receiptResult.data ?? []).map((row: { id: string }) => row.id);
        const sourceBillIds = [
          ...new Set(rows.map((row) => row.source_bill_id).filter(Boolean)),
        ] as string[];
        const transporterBillIds = [
          ...new Set(rows.map((row) => row.transporter_bill_id).filter(Boolean)),
        ] as string[];
        const tripIds = [...new Set(rows.map((row) => row.trip_id).filter(Boolean))] as string[];
        const consignmentIds = rows.map((row) => row.id);
        const [sourceBills, transporterBills, trips, loadingItems, unloadingItems] =
          await Promise.all([
            sourceBillIds.length
              ? db
                  .from("ltms_source_bills")
                  .select("id,journal_entry_id")
                  .in("id", sourceBillIds)
                  .is("deleted_at", null)
              : Promise.resolve({ data: [], error: null }),
            transporterBillIds.length
              ? db
                  .from("ltms_transporter_bills")
                  .select("id,journal_entry_id")
                  .in("id", transporterBillIds)
                  .is("deleted_at", null)
              : Promise.resolve({ data: [], error: null }),
            tripIds.length
              ? db.from("trips").select("id,posted_journal_entry_id").in("id", tripIds)
              : Promise.resolve({ data: [], error: null }),
            consignmentIds.length
              ? db
                  .from("workmen_bill_items")
                  .select("consignment_id,bill_id,final_amount")
                  .eq("charge_type", "loading")
                  .in("consignment_id", consignmentIds)
              : Promise.resolve({ data: [], error: null }),
            receiptIds.length
              ? db
                  .from("workmen_bill_items")
                  .select("stock_inward_receipt_id,bill_id,final_amount")
                  .eq("charge_type", "unloading")
                  .in("stock_inward_receipt_id", receiptIds)
              : Promise.resolve({ data: [], error: null }),
          ]);
        for (const result of [sourceBills, transporterBills, trips, loadingItems, unloadingItems])
          if (result.error) throw result.error;
        const workmenItems = [...(loadingItems.data ?? []), ...(unloadingItems.data ?? [])];
        const workmenBillIds = [
          ...new Set(workmenItems.map((item: { bill_id: string }) => item.bill_id)),
        ];
        const workmenBills = workmenBillIds.length
          ? await db.from("workmen_bills").select("id,journal_entry_id").in("id", workmenBillIds)
          : { data: [], error: null };
        if (workmenBills.error) throw workmenBills.error;
        const postedSources = new Set(
          (sourceBills.data ?? [])
            .filter((bill: { journal_entry_id: string | null }) => bill.journal_entry_id)
            .map((bill: { id: string }) => bill.id),
        );
        const postedTransporters = new Set(
          (transporterBills.data ?? [])
            .filter((bill: { journal_entry_id: string | null }) => bill.journal_entry_id)
            .map((bill: { id: string }) => bill.id),
        );
        const postedTrips = new Set(
          (trips.data ?? [])
            .filter(
              (trip: { posted_journal_entry_id: string | null }) => trip.posted_journal_entry_id,
            )
            .map((trip: { id: string }) => trip.id),
        );
        const postedWorkmenBills = new Set(
          (workmenBills.data ?? [])
            .filter((bill: { journal_entry_id: string | null }) => bill.journal_entry_id)
            .map((bill: { id: string }) => bill.id),
        );
        const postedWorkmenByConsignment = new Map<string, number>();
        let postedWorkmenUnloading = 0;
        for (const item of workmenItems) {
          if (!postedWorkmenBills.has(item.bill_id)) continue;
          if (item.consignment_id)
            postedWorkmenByConsignment.set(
              item.consignment_id,
              (postedWorkmenByConsignment.get(item.consignment_id) ?? 0) + n(item.final_amount),
            );
          else postedWorkmenUnloading += n(item.final_amount);
        }
        const postedRows = rows.reduce((total, row) => {
          const income =
            row.source_bill_id && postedSources.has(row.source_bill_id) ? row.income : 0;
          const transporter =
            row.transporter_bill_id && postedTransporters.has(row.transporter_bill_id)
              ? (row.transporter_expenditure ?? 0)
              : 0;
          const workmen = postedWorkmenByConsignment.get(row.id) ?? 0;
          const trip =
            row.trip_id && postedTrips.has(row.trip_id) ? (row.trip_expenditure ?? 0) : 0;
          total.consignment += income;
          total.transporter += transporter;
          total.workmen += workmen;
          total.trip += trip;
          total.net += income - transporter - workmen - trip;
          return total;
        }, zero());
        postedRows.workmen += postedWorkmenUnloading;
        if (!cancelled) setPosted((current) => ({ ...postedRows, unloading: current.unloading }));
      } catch (error) {
        if (!cancelled)
          toast.error(
            error instanceof Error ? error.message : "Could not load posted dashboard values",
          );
      } finally {
        if (!cancelled) setLoadingPosted(false);
      }
    }
    void loadPosted();
    return () => {
      cancelled = true;
    };
  }, [rows, filters]);

  const metrics: Array<[keyof Amounts, string]> = [
    ["trip", "Trip Expenditure"],
    ["workmen", "Workmen Charges"],
    ["transporter", "Transporter Expenditure"],
    ["unloading", "Unloading Income"],
    ["consignment", "Consignment Income"],
    ["net", "Consignment Net"],
    ["financeIncome", "LTMS Finance Income"],
    ["financeExpenditure", "LTMS Finance Expenditure"],
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Figures use the LTMS report calculations for the selected period and branch.
      </p>
      <ConsignmentNetReport
        onRowsChange={onRowsChange}
        onFiltersChange={onFiltersChange}
        dashboardCompact
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <MetricGroup
          title="IN SYSTEM"
          subtitle="Final report values; Workmen Charges = loading + unloading"
          values={{
            ...system,
            workmen: system.workmen + systemWorkmenUnloading,
            financeIncome: financeTotals.income,
            financeExpenditure: financeTotals.expenditure,
          }}
          loading={financeLoading}
          metrics={metrics}
        />
        <MetricGroup
          title="IN SYSTEM AND POSTED"
          subtitle="Posted journal-linked amounts; Workmen Charges = loading + unloading"
          values={{
            ...posted,
            financeIncome: financeTotals.income,
            financeExpenditure: financeTotals.expenditure,
          }}
          loading={loadingPosted || financeLoading}
          metrics={metrics}
        />
      </div>
    </div>
  );
}
function MetricGroup({
  title,
  subtitle,
  values,
  loading,
  metrics,
}: {
  title: string;
  subtitle: string;
  values: Amounts;
  loading: boolean;
  metrics: Array<[keyof Amounts, string]>;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-4 border-b pb-3">
        <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map(([key, label]) => (
          <article key={key} className="min-w-0 rounded-lg border bg-background p-3">
            <p className="min-h-9 text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 truncate text-lg font-semibold tabular-nums">
              {loading ? "Loading…" : money(values[key])}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
