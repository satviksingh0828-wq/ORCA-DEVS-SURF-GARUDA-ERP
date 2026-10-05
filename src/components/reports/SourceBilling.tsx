/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, PackageSearch, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { manifestCharges, num, type ContractLite, type EntryLite } from "@/lib/trip-calc";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { ConsignmentDetailsDialog } from "@/components/operations/ConsignmentDetailsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Source = {
  id: string;
  contract_name: string;
  branch_id?: string | null;
  company_name?: string | null;
  legal_business_name?: string | null;
  gstin?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pin_code?: string | null;
  source_asset_ledger_id?: string | null;
  freight_income_ledger_id?: string | null;
  loading_income_ledger_id?: string | null;
  unloading_income_ledger_id?: string | null;
};
type Bill = {
  id: string;
  bill_number: string;
  branch_id: string;
  source_id: string;
  bill_date: string;
  due_date: string;
  period_from: string;
  period_to: string;
  total_freight: number | string;
  total_loading: number | string;
  total_unloading_income: number | string;
  deleted_at: string | null;
  branch?: { branch_name?: string | null } | null;
  source?: { contract_name?: string | null } | null;
  source_company_name?: string | null;
  source_legal_business_name?: string | null;
  source_gstin?: string | null;
  source_address?: string | null;
  source_address_line1?: string | null;
  source_address_line2?: string | null;
  source_city?: string | null;
  source_state?: string | null;
  source_country?: string | null;
  source_pin_code?: string | null;
  source_asset_ledger_id?: string | null;
  freight_income_ledger_id?: string | null;
  loading_income_ledger_id?: string | null;
};
type Consignment = {
  id: string;
  consignment_number: string;
  branch_id: string;
  source_id: string;
  consignment_date: string | null;
  transport_mode: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  billing_status: string;
  source_bill_id: string | null;
  freight_deduction: number | string | null;
  additional_freight: number | string | null;
  loading_deduction: number | string | null;
  additional_loading: number | string | null;
  source?: { contract_name?: string | null } | null;
};
type PackageRow = {
  consignment_id: string;
  quantity: number | string | null;
  weight_kg: number | string | null;
};
type ShipmentPin = {
  consignment_id: string;
  dispatch_from_pin_code: string | null;
  ship_to_pin_code: string | null;
};
type Entry = EntryLite & { mode?: string | null };
type BillLine = Consignment & {
  from_pin_code: string;
  to_pin_code: string;
  calculated_freight: number;
  calculated_loading: number;
  freight_deduction: number;
  additional_freight: number;
  loading_deduction: number;
  additional_loading: number;
  final_freight: number;
  final_loading: number;
};
type StockInwardPackage = {
  package_rate_type_id: string;
  source_id: string;
  quantity: number | string | null;
  weight_kg: number | string | null;
};
type StockInwardReceipt = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  branch_id: string;
  additional_income_mode: "approval" | "source" | "both" | "none";
  stock_inward_sources?: Array<{ source_id: string }>;
  stock_inward_packages?: StockInwardPackage[];
};
type StockIncomeLine = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  source_income_amount: number;
};
type StockIncomeRateType = {
  id: string;
  basis: "quantity" | "weight";
  charge_mode: "fixed" | "rate";
};
type StockIncomeRateEntry = {
  package_rate_type_id: string;
  from_value: number | string;
  to_value: number | string | null;
  amount: number | string;
};
type LedgerAccount = {
  id: string;
  account_name: string;
  ledger_type: string;
  account_kind: string;
};
type JournalPreviewLine = {
  key: string;
  label: string;
  id?: string | null;
  amount: number;
  side: "debit" | "credit";
  account?: LedgerAccount;
};
type BillItem = {
  id: string;
  bill_id: string;
  consignment_id: string;
  consignment_number: string;
  consignment_date: string | null;
  from_pin_code: string;
  to_pin_code: string;
  calculated_freight: number | string;
  freight_deduction: number | string;
  additional_freight: number | string;
  final_freight: number | string;
  calculated_loading: number | string;
  loading_deduction: number | string;
  additional_loading: number | string;
  final_loading: number | string;
};
type StockInwardBillItem = {
  id: string;
  bill_id: string;
  stock_inward_receipt_id: string;
  source_id: string;
  receipt_number: string;
  receipt_date: string;
  source_income_amount: number | string;
};

const money = (value: number | string | null | undefined) =>
  `₹${num(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const monthEnd = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
};
const normalizeMode = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toUpperCase();
function routeEntry(entries: Entry[], row: Consignment, fromPin: string, toPin: string) {
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === normalizeMode(row.transport_mode) &&
      String(entry.from_pin_code ?? "").trim() === fromPin &&
      String(entry.to_pin_code ?? "").trim() === toPin,
  );
}

export function SourceBilling() {
  const branches = useBranches();
  const { user } = useSession();
  const [screen, setScreen] = useState<"list" | "create" | "view">("list");
  const [bills, setBills] = useState<Bill[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<Record<string, LedgerAccount>>({});
  const [branchSources, setBranchSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [listFilters, setListFilters] = useState({
    branch: "all",
    source: "all",
    from: monthStart(),
    to: monthEnd(),
  });
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [viewing, setViewing] = useState<Bill | null>(null);
  const [viewItems, setViewItems] = useState<BillItem[]>([]);
  const [viewStockInwardItems, setViewStockInwardItems] = useState<StockInwardBillItem[]>([]);
  const [viewItemsLoading, setViewItemsLoading] = useState(false);
  const [consignmentViewing, setConsignmentViewing] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<BillLine[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [stockInwardPickerOpen, setStockInwardPickerOpen] = useState(false);
  const [stockInwardCandidates, setStockInwardCandidates] = useState<StockIncomeLine[]>([]);
  const [selectedStockInwardIds, setSelectedStockInwardIds] = useState<string[]>([]);
  const [stockInwardLines, setStockInwardLines] = useState<StockIncomeLine[]>([]);
  const [form, setForm] = useState({
    branch: "",
    source: "",
    billDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    from: monthStart(),
    to: monthEnd(),
  });
  const [generating, setGenerating] = useState(false);
  const [journalPreviewOpen, setJournalPreviewOpen] = useState(false);
  const [journalPostStatus, setJournalPostStatus] = useState<"pending" | "success" | "error">("pending");
  const [journalPostError, setJournalPostError] = useState<string | null>(null);
  const [journalPreviewAmounts, setJournalPreviewAmounts] = useState<{ freight: number; loading: number; unloading: number } | null>(null);
  const [postedJournalEntryId, setPostedJournalEntryId] = useState<string | null>(null);
  const [postedJournalLines, setPostedJournalLines] = useState<JournalPreviewLine[] | null>(null);

  async function loadBillItems(billId: string) {
    setViewItemsLoading(true);
    try {
      const [rows, stockItems] = await Promise.all([
        fetchAll<BillItem>(() =>
          (supabase as any)
            .from("ltms_source_bill_items")
            .select(
              "id,bill_id,consignment_id,consignment_number,consignment_date,from_pin_code,to_pin_code,calculated_freight,freight_deduction,additional_freight,final_freight,calculated_loading,loading_deduction,additional_loading,final_loading",
            )
            .eq("bill_id", billId)
            .order("consignment_date", { ascending: false }),
        ),
        fetchAll<StockInwardBillItem>(() =>
          (supabase as any)
            .from("ltms_source_bill_stock_inward_items")
            .select("id,bill_id,stock_inward_receipt_id,source_id,receipt_number,receipt_date,source_income_amount")
            .eq("bill_id", billId)
            .order("receipt_date", { ascending: false }),
        ),
      ]);
      setViewItems(rows);
      setViewStockInwardItems(stockItems);
    } catch (error) {
      setViewItems([]);
      setViewStockInwardItems([]);
      toast.error(error instanceof Error ? error.message : "Could not load billed consignments");
    } finally {
      setViewItemsLoading(false);
    }
  }

  useEffect(() => {
    if (!viewing) {
      setViewItems([]);
      setViewStockInwardItems([]);
      return;
    }
    void loadBillItems(viewing.id);
  }, [viewing]);

  async function loadSources() {
    const { data, error } = await (supabase as any)
      .from("contracts")
      .select(
        "id,contract_name,branch_id,company_name,legal_business_name,gstin,address_line1,address_line2,city,state,country,pin_code,source_asset_ledger_id,freight_income_ledger_id,loading_income_ledger_id,unloading_income_ledger_id",
      )
      .order("contract_name");
    if (error) return toast.error(`Could not load sources: ${error.message}`);
    const loadedSources = (data ?? []) as Source[];
    setSources(loadedSources);
    const ledgerIds = [...new Set(loadedSources.flatMap((source) => [
      source.source_asset_ledger_id,
      source.freight_income_ledger_id,
      source.loading_income_ledger_id,
      source.unloading_income_ledger_id,
    ].filter((id): id is string => Boolean(id))))];
    if (ledgerIds.length) {
      const { data: ledgerRows, error: ledgerError } = await (supabase as any)
        .from("ledger_accounts")
        .select("id,account_name,ledger_type,account_kind")
        .in("id", ledgerIds);
      if (ledgerError) return toast.error(`Could not load mapped source accounts: ${ledgerError.message}`);
      setLedgerAccounts(Object.fromEntries(((ledgerRows ?? []) as LedgerAccount[]).map((ledger) => [ledger.id, ledger])));
    } else {
      setLedgerAccounts({});
    }
  }
  async function loadBills() {
    setLoading(true);
    try {
      let query = (supabase as any)
        .from("ltms_source_bills")
        .select(
          "id,bill_number,branch_id,source_id,bill_date,due_date,period_from,period_to,total_freight,total_loading,total_unloading_income,deleted_at,source_company_name,source_legal_business_name,source_gstin,source_address,source_address_line1,source_address_line2,source_city,source_state,source_country,source_pin_code,branch:branches(branch_name),source:contracts(contract_name)",
        )
        .gte("bill_date", listFilters.from)
        .lte("bill_date", listFilters.to)
        .order("bill_date", { ascending: false });
      if (listFilters.branch !== "all") query = query.eq("branch_id", listFilters.branch);
      if (listFilters.source !== "all") query = query.eq("source_id", listFilters.source);
      if (!showDeleted) query = query.is("deleted_at", null);
      else query = query.not("deleted_at", "is", null);
      const rows = await fetchAll<Bill>(() => query);
      setBills(rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load source bills");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadSources();
  }, []);
  useEffect(() => {
    if (!form.branch) {
      setBranchSources([]);
      return;
    }
    setBranchSources(sources.filter((source) => source.branch_id === form.branch));
  }, [form.branch, sources]);
  useEffect(() => {
    void loadBills();
    // loadBills intentionally follows the filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFilters.branch, listFilters.source, listFilters.from, listFilters.to, showDeleted]);

  async function loadCandidates() {
    if (!form.branch || !form.source) return toast.error("Select a branch and source first");
    if (!form.from || !form.to || form.from > form.to)
      return toast.error("Enter a valid billing period");
    setPickerLoading(true);
    try {
      const query = (supabase as any)
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,source_id,consignment_date,transport_mode,from_pin_code,to_pin_code,billing_status,source_bill_id,freight_deduction,additional_freight,loading_deduction,additional_loading,source:contracts(contract_name)",
        )
        .eq("branch_id", form.branch)
        .eq("source_id", form.source)
        .eq("billing_status", "to_be_billed")
        .gte("consignment_date", form.from)
        .lte("consignment_date", form.to)
        .order("consignment_date", { ascending: false });
      const consignments = await fetchAll<Consignment>(() => query);
      const ids = consignments.map((row) => row.id);
      if (!ids.length) {
        setCandidates([]);
        setSelectedCandidateIds([]);
        setPickerOpen(true);
        return;
      }
      const [packages, shipments, contractRows, entries] = await Promise.all([
        fetchAll<PackageRow>(() =>
          (supabase as any)
            .from("consignment_package_information")
            .select("consignment_id,quantity,weight_kg")
            .in("consignment_id", ids),
        ),
        fetchAll<ShipmentPin>(() =>
          (supabase as any)
            .from("shipments")
            .select("consignment_id,dispatch_from_pin_code,ship_to_pin_code")
            .in("consignment_id", ids)
            .order("created_at", { ascending: true }),
        ),
        fetchAll<ContractLite>(() =>
          (supabase as any)
            .from("contracts")
            .select("id,contract_name,company_name,gstin,fixed_monthly_charge,fixed_yearly_charge")
            .eq("id", form.source),
        ),
        fetchAll<Entry>(() =>
          (supabase as any)
            .from("contract_entries")
            .select(
              "id,contract_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges,per_manifest_amount",
            )
            .eq("contract_id", form.source),
        ),
      ]);
      const totals = new Map<string, { quantity: number; weight: number }>();
      packages.forEach((item) => {
        const current = totals.get(item.consignment_id) ?? { quantity: 0, weight: 0 };
        current.quantity += num(item.quantity);
        current.weight += num(item.weight_kg);
        totals.set(item.consignment_id, current);
      });
      const firstPins = new Map<string, ShipmentPin>();
      shipments.forEach((item) => {
        if (!firstPins.has(item.consignment_id)) firstPins.set(item.consignment_id, item);
      });
      const contract = contractRows[0];
      const rows = consignments.map((row) => {
        const pins = firstPins.get(row.id);
        const from = pins?.dispatch_from_pin_code || row.from_pin_code || "";
        const to = pins?.ship_to_pin_code || row.to_pin_code || "";
        const pack = totals.get(row.id) ?? { quantity: 0, weight: 0 };
        const entry = routeEntry(entries, row, from, to);
        const charges = manifestCharges(contract, entry, {
          from_location_id: null,
          to_location_id: null,
          from_pin_code: from,
          to_pin_code: to,
          weight_kg: String(pack.weight),
          quantity: String(pack.quantity),
        });
        const freightDeduction = num(row.freight_deduction);
        const additionalFreight = num(row.additional_freight);
        const loadingDeduction = num(row.loading_deduction);
        const additionalLoading = num(row.additional_loading);
        return {
          ...row,
          from_pin_code: from,
          to_pin_code: to,
          calculated_freight: charges.freight,
          calculated_loading: charges.loading,
          freight_deduction: freightDeduction,
          additional_freight: additionalFreight,
          loading_deduction: loadingDeduction,
          additional_loading: additionalLoading,
          final_freight: Math.max(0, charges.freight - freightDeduction + additionalFreight),
          final_loading: Math.max(0, charges.loading - loadingDeduction + additionalLoading),
        };
      });
      setCandidates(rows);
      setSelectedCandidateIds([]);
      setPickerOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load consignments");
    } finally {
      setPickerLoading(false);
    }
  }
  async function loadStockInwardCandidates() {
    if (!form.branch || !form.source) return toast.error("Select a branch and source first");
    if (!form.from || !form.to || form.from > form.to)
      return toast.error("Enter a valid billing period");
    setPickerLoading(true);
    try {
      const receiptQuery = (supabase as any)
        .from("stock_inward_receipts")
        .select(
          "id,receipt_number,receipt_date,branch_id,additional_income_mode,stock_inward_sources!inner(source_id),stock_inward_packages(package_rate_type_id,source_id,quantity,weight_kg)",
        )
        .eq("branch_id", form.branch)
        .eq("stock_inward_sources.source_id", form.source)
        .in("additional_income_mode", ["source", "both"])
        .gte("receipt_date", form.from)
        .lte("receipt_date", form.to)
        .order("receipt_date", { ascending: false });
      const [receipts, billedRows] = await Promise.all([
        fetchAll<StockInwardReceipt>(() => receiptQuery),
        fetchAll<{ stock_inward_receipt_id: string }>(() =>
          (supabase as any)
            .from("ltms_source_bill_stock_inward_items")
            .select("stock_inward_receipt_id")
            .eq("source_id", form.source),
        ),
      ]);
      const billedIds = new Set(billedRows.map((row) => row.stock_inward_receipt_id));
      const eligible = receipts.filter((receipt) => !billedIds.has(receipt.id));
      const typeIds = [
        ...new Set(
          eligible.flatMap((receipt) =>
            (receipt.stock_inward_packages ?? [])
              .filter((item) => item.source_id === form.source)
              .map((item) => item.package_rate_type_id),
          ),
        ),
      ];
      const [types, entries] = await Promise.all([
        typeIds.length
          ? fetchAll<StockIncomeRateType>(() =>
              (supabase as any)
                .from("package_rate_types")
                .select("id,basis,charge_mode")
                .in("id", typeIds),
            )
          : Promise.resolve([] as StockIncomeRateType[]),
        typeIds.length
          ? fetchAll<StockIncomeRateEntry>(() =>
              (supabase as any)
                .from("package_rate_entries")
                .select("package_rate_type_id,from_value,to_value,amount")
                .eq("rate_kind", "unloading")
                .in("package_rate_type_id", typeIds)
                .order("from_value"),
            )
          : Promise.resolve([] as StockIncomeRateEntry[]),
      ]);
      const typeById = new Map(types.map((type) => [type.id, type]));
      const nextCandidates = eligible.flatMap((receipt) => {
        const sourceIncome = (receipt.stock_inward_packages ?? [])
          .filter((item) => item.source_id === form.source)
          .reduce((sum, item) => {
            const type = typeById.get(item.package_rate_type_id);
            if (!type) return sum;
            const measure = type.basis === "weight" ? num(item.weight_kg) : num(item.quantity);
            const slab = entries
              .filter((entry) => entry.package_rate_type_id === item.package_rate_type_id)
              .sort((a, b) => num(b.from_value) - num(a.from_value))
              .find(
                (entry) =>
                  num(entry.from_value) <= measure &&
                  (entry.to_value == null || measure <= num(entry.to_value)),
              );
            const rate = num(slab?.amount);
            return sum + (slab ? (type.charge_mode === "rate" ? rate * measure : rate) : 0);
          }, 0);
        if (sourceIncome <= 0) return [];
        return [{
          id: receipt.id,
          receipt_number: receipt.receipt_number,
          receipt_date: receipt.receipt_date,
          source_income_amount: Math.round((sourceIncome + Number.EPSILON) * 100) / 100,
        }];
      });
      setStockInwardCandidates(nextCandidates);
      setSelectedStockInwardIds([]);
      setStockInwardPickerOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Stock Inward source income");
    } finally {
      setPickerLoading(false);
    }
  }
  function addSelectedStockInward() {
    const selected = stockInwardCandidates.filter(
      (row) => selectedStockInwardIds.includes(row.id) && !stockInwardLines.some((line) => line.id === row.id),
    );
    if (!selected.length) return toast.error("Select at least one Stock Inward entry");
    setStockInwardLines((current) => [...current, ...selected]);
    setSelectedStockInwardIds([]);
    setStockInwardPickerOpen(false);
  }
  function addSelectedLines() {
    const selected = candidates.filter(
      (row) => selectedCandidateIds.includes(row.id) && !lines.some((line) => line.id === row.id),
    );
    if (!selected.length) return toast.error("Select at least one consignment");
    setLines((current) => [...current, ...selected]);
    setSelectedCandidateIds([]);
    setPickerOpen(false);
  }
  function updateLine(id: string, key: keyof BillLine, value: string) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, [key]: Number(value) || 0 } as BillLine;
        next.final_freight = Math.max(
          0,
          next.calculated_freight - next.freight_deduction + next.additional_freight,
        );
        next.final_loading = Math.max(
          0,
          next.calculated_loading - next.loading_deduction + next.additional_loading,
        );
        return next;
      }),
    );
  }
  async function generate() {
    if (!form.branch || !form.source || (!lines.length && !stockInwardLines.length))
      return toast.error("Select branch, source and at least one consignment or Stock Inward entry");
    if (form.from > form.to || form.billDate < form.from || form.dueDate < form.billDate)
      return toast.error("Check bill and billing period dates");
    if (totals.freight + totals.loading + stockIncomeTotal <= 0)
      return toast.error(
        "Source bill income total must be greater than zero before posting the journal entry",
      );
    setJournalPreviewAmounts({ freight: totals.freight, loading: totals.loading, unloading: stockIncomeTotal });
    setJournalPostError(null);
    setJournalPostStatus("pending");
    setPostedJournalEntryId(null);
    setPostedJournalLines(null);
    setJournalPreviewOpen(true);
    setGenerating(true);
    const { data: generatedBillId, error } = await (supabase as any).rpc("generate_ltms_source_bill", {
      p_branch_id: form.branch,
      p_source_id: form.source,
      p_bill_date: form.billDate,
      p_due_date: form.dueDate,
      p_period_from: form.from,
      p_period_to: form.to,
      p_created_by: user?.id ?? null,
      p_items: [
        ...lines.map((line) => ({
          consignment_id: line.id,
          consignment_number: line.consignment_number,
          from_pin_code: line.from_pin_code,
          to_pin_code: line.to_pin_code,
          calculated_freight: line.calculated_freight,
          freight_deduction: line.freight_deduction,
          additional_freight: line.additional_freight,
          final_freight: line.final_freight,
          calculated_loading: line.calculated_loading,
          loading_deduction: line.loading_deduction,
          additional_loading: line.additional_loading,
          final_loading: line.final_loading,
        })),
        ...stockInwardLines.map((line) => ({
          stock_inward_receipt_id: line.id,
          source_income_amount: line.source_income_amount,
        })),
      ],
    });
    setGenerating(false);
    if (error) {
      setJournalPostStatus("error");
      setJournalPostError(error.message);
      return toast.error(`Could not generate source bill: ${error.message}`);
    }
    const { data: savedBill, error: savedBillError } = await (supabase as any)
      .from("ltms_source_bills")
      .select("journal_entry_id")
      .eq("id", generatedBillId)
      .maybeSingle();
    if (savedBillError || !savedBill?.journal_entry_id) {
      setJournalPostStatus("error");
      setJournalPostError(savedBillError?.message ?? "The bill was created but no journal entry was linked to it.");
      return toast.error("Bill created, but the posted journal could not be verified");
    }
    const { data: savedLines, error: savedLinesError } = await (supabase as any)
      .from("journal_lines")
      .select("line_no,ledger_account_id,account_kind,line_description,debit,credit,ledger_account:ledger_accounts(account_name,ledger_type,account_kind)")
      .eq("journal_entry_id", savedBill.journal_entry_id)
      .order("line_no");
    if (savedLinesError || !savedLines?.length) {
      setJournalPostStatus("error");
      setJournalPostError(savedLinesError?.message ?? "The journal entry was linked but has no saved journal lines.");
      return toast.error("Bill created, but saved journal lines could not be verified");
    }
    setPostedJournalEntryId(savedBill.journal_entry_id);
    setPostedJournalLines((savedLines as Array<any>).flatMap((line) => {
      const debit = num(line.debit);
      const credit = num(line.credit);
      const account = line.ledger_account
        ? { id: line.ledger_account_id, account_name: line.ledger_account.account_name, ledger_type: line.ledger_account.ledger_type, account_kind: line.ledger_account.account_kind }
        : undefined;
      return [
        debit > 0 ? { key: `posted-${line.line_no}-debit`, label: line.line_description ?? `Line ${line.line_no}`, id: line.ledger_account_id, amount: debit, side: "debit" as const, account } : null,
        credit > 0 ? { key: `posted-${line.line_no}-credit`, label: line.line_description ?? `Line ${line.line_no}`, id: line.ledger_account_id, amount: credit, side: "credit" as const, account } : null,
      ].filter((entry): entry is JournalPreviewLine => entry !== null);
    }));
    setJournalPostStatus("success");
    toast.success("Source bill and journal posted. Selected consignments and Stock Inward entries are now locked.");
    setLines([]);
    setStockInwardLines([]);
    setScreen("list");
    await loadBills();
  }
  async function deleteBill(bill: Bill) {
    if (bill.deleted_at) return;
    const { error } = await (supabase as any).rpc("soft_delete_ltms_source_bill", {
      p_bill_id: bill.id,
      p_deleted_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("Source bill moved to deleted history");
    await loadBills();
  }
  const visibleBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? bills.filter((bill) =>
          [bill.bill_number, bill.branch?.branch_name, bill.source?.contract_name]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : bills;
  }, [bills, search]);
  const totals = useMemo(
    () =>
      lines.reduce(
        (result, row) => ({
          freight: result.freight + row.final_freight,
          loading: result.loading + row.final_loading,
        }),
        { freight: 0, loading: 0 },
      ),
    [lines],
  );
  const stockIncomeTotal = useMemo(
    () => stockInwardLines.reduce((sum, line) => sum + num(line.source_income_amount), 0),
    [stockInwardLines],
  );
  const selectedBillingSource = sources.find((source) => source.id === form.source);
  const previewTotals = useMemo(
    () => journalPreviewAmounts ?? { ...totals, unloading: stockIncomeTotal },
    [journalPreviewAmounts, stockIncomeTotal, totals],
  );
  const journalPreviewLines = useMemo<JournalPreviewLine[]>(() => {
    const source = selectedBillingSource;
    const mapped = [
      { key: "source", label: "Source account (debit)", id: source?.source_asset_ledger_id, amount: previewTotals.freight + previewTotals.loading + previewTotals.unloading, side: "debit" },
      { key: "freight", label: "Freight income (credit)", id: source?.freight_income_ledger_id, amount: previewTotals.freight, side: "credit" },
      { key: "loading", label: "Loading income (credit)", id: source?.loading_income_ledger_id, amount: previewTotals.loading, side: "credit" },
      { key: "unloading", label: "Unloading income (credit)", id: source?.unloading_income_ledger_id, amount: previewTotals.unloading, side: "credit" },
    ];
    return mapped.filter((line) => line.amount > 0 || line.key === "source").map((line) => ({
      ...line,
      account: line.id ? ledgerAccounts[line.id] : undefined,
    }));
  }, [ledgerAccounts, previewTotals, selectedBillingSource]);
  const journalDebit = journalPreviewLines.reduce((sum, line) => sum + (line.side === "debit" ? line.amount : 0), 0);
  const journalCredit = journalPreviewLines.reduce((sum, line) => sum + (line.side === "credit" ? line.amount : 0), 0);
  const journalBalanced = Math.abs(journalDebit - journalCredit) < 0.005;
  const displayedJournalLines = postedJournalLines ?? journalPreviewLines;
  const displayedJournalDebit = displayedJournalLines.reduce((sum, line) => sum + (line.side === "debit" ? line.amount : 0), 0);
  const displayedJournalCredit = displayedJournalLines.reduce((sum, line) => sum + (line.side === "credit" ? line.amount : 0), 0);
  const displayedJournalBalanced = Math.abs(displayedJournalDebit - displayedJournalCredit) < 0.005;

  const updateForm = (key: keyof typeof form, value: string) =>
    {
      setForm((current) => ({
        ...current,
        [key]: value,
        ...(key === "branch" ? { source: "" } : {}),
      }));
      if (key === "branch" || key === "source") {
        setLines([]);
        setStockInwardLines([]);
        setCandidates([]);
        setStockInwardCandidates([]);
      }
    };
  const sourceList = listFilters.branch === "all" ? sources : sources;
  const selectedSource = sources.find((source) => source.id === form.source);
  const selectedSourceAddress = selectedSource
    ? [
        selectedSource.address_line1,
        selectedSource.address_line2,
        selectedSource.city,
        selectedSource.state,
        selectedSource.country,
        selectedSource.pin_code,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  return (
    <div className="space-y-6">
      {screen === "list" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Source Billing History</h2>
              <p className="text-xs text-muted-foreground">
                Generated bills are immutable; delete moves them to history only.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setScreen("create")}>
                <FilePlus2 className="size-4" /> Create Source Bill
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadBills()}
                disabled={loading}
              >
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
              <Button
                variant={showDeleted ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowDeleted((value) => !value)}
              >
                {showDeleted ? "Deleted bills" : "Active bills"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/30 p-3">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search bill, source or branch"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select
              value={listFilters.branch}
              onValueChange={(value) => setListFilters((f) => ({ ...f, branch: value }))}
            >
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
            <Select
              value={listFilters.source}
              onValueChange={(value) => setListFilters((f) => ({ ...f, source: value }))}
            >
              <SelectTrigger className="h-9 w-52">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceList.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.contract_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-9 w-40"
              type="date"
              value={listFilters.from}
              onChange={(event) => setListFilters((f) => ({ ...f, from: event.target.value }))}
            />
            <Input
              className="h-9 w-40"
              type="date"
              value={listFilters.to}
              onChange={(event) => setListFilters((f) => ({ ...f, to: event.target.value }))}
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3">Bill No.</th>
                  <th className="px-3 py-3">Bill Date</th>
                  <th className="px-3 py-3">Branch</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Period</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-right">Unloading Income</th>
                  <th className="px-3 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleBills.length ? (
                  visibleBills.map((bill) => (
                    <tr key={bill.id} className="hover:bg-muted/20">
                      <td className="px-3 py-3 font-medium">
                        {bill.bill_number}
                        {bill.deleted_at && (
                          <span className="ml-2 text-xs text-destructive">Deleted</span>
                        )}
                      </td>
                      <td className="px-3 py-3">{bill.bill_date}</td>
                      <td className="px-3 py-3">{bill.branch?.branch_name ?? "—"}</td>
                      <td className="px-3 py-3">{bill.source?.contract_name ?? "—"}</td>
                      <td className="px-3 py-3">
                        {bill.period_from} → {bill.period_to}
                      </td>
                      <td className="px-3 py-3 text-right">{money(bill.total_freight)}</td>
                      <td className="px-3 py-3 text-right">{money(bill.total_loading)}</td>
                      <td className="px-3 py-3 text-right">{money(bill.total_unloading_income)}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setViewing(bill);
                              setScreen("view");
                            }}
                          >
                            <Eye className="size-3.5" /> View
                          </Button>
                          {!bill.deleted_at && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => void deleteBill(bill)}
                            >
                              <Trash2 className="size-3.5" /> Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-muted-foreground">
                      {loading ? "Loading bills…" : "No source bills found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {screen === "create" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <FilePlus2 className="size-4 text-primary" /> Create Source Bill
              </h2>
              <Button variant="outline" size="sm" onClick={() => setScreen("list")}>
                Back to bills
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Select consignments and/or eligible Stock Inward source income. A Stock Inward entry
              is eligible only when Additional Income Type is Source or Both.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Branch
              <Select value={form.branch} onValueChange={(value) => updateForm("branch", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Source
              <Select value={form.source} onValueChange={(value) => updateForm("source", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {(form.branch ? branchSources : []).map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.contract_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Bill Date
              <Input
                type="date"
                value={form.billDate}
                onChange={(event) => updateForm("billDate", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Bill Due Date
              <Input
                type="date"
                value={form.dueDate}
                onChange={(event) => updateForm("dueDate", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Billing From
              <Input
                type="date"
                value={form.from}
                onChange={(event) => updateForm("from", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Billing To
              <Input
                type="date"
                value={form.to}
                onChange={(event) => updateForm("to", event.target.value)}
              />
            </label>
          </div>
          {selectedSource && (
            <div className="grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm sm:grid-cols-3">
              <div>
                <span className="text-xs text-muted-foreground">Source company</span>
                <p className="font-medium">
                  {selectedSource.company_name ||
                    selectedSource.legal_business_name ||
                    selectedSource.contract_name}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">GSTIN</span>
                <p>{selectedSource.gstin || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Address</span>
                <p>{selectedSourceAddress || "—"}</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => void loadCandidates()}
              disabled={pickerLoading}
            >
              {pickerLoading ? <RefreshCw className="animate-spin" /> : <PackageSearch />} Load
              consignments
            </Button>
            <Button
              variant="outline"
              onClick={() => void loadStockInwardCandidates()}
              disabled={pickerLoading}
            >
              {pickerLoading ? <RefreshCw className="animate-spin" /> : <PackageSearch />} Load
              Stock Inward
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1200px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3">Consignment</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">From → To</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-right">Adjustments</th>
                  <th className="px-3 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.length ? (
                  lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-3 font-medium">{line.consignment_number}</td>
                      <td className="px-3 py-3">{line.consignment_date ?? "—"}</td>
                      <td className="px-3 py-3">
                        {line.from_pin_code || "—"} → {line.to_pin_code || "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div>{money(line.final_freight)}</div>
                        <div className="mt-1 flex justify-end gap-1">
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Additional freight"
                            placeholder="+ freight"
                            value={line.additional_freight || ""}
                            onChange={(event) =>
                              updateLine(line.id, "additional_freight", event.target.value)
                            }
                          />
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Freight deduction"
                            placeholder="- freight"
                            value={line.freight_deduction || ""}
                            onChange={(event) =>
                              updateLine(line.id, "freight_deduction", event.target.value)
                            }
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div>{money(line.final_loading)}</div>
                        <div className="mt-1 flex justify-end gap-1">
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Additional loading"
                            placeholder="+ loading"
                            value={line.additional_loading || ""}
                            onChange={(event) =>
                              updateLine(line.id, "additional_loading", event.target.value)
                            }
                          />
                          <Input
                            className="h-7 w-24"
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Loading deduction"
                            placeholder="- loading"
                            value={line.loading_deduction || ""}
                            onChange={(event) =>
                              updateLine(line.id, "loading_deduction", event.target.value)
                            }
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-muted-foreground">
                        Freight: {money(line.freight_deduction)} / {money(line.additional_freight)}
                        <br />
                        Loading: {money(line.loading_deduction)} / {money(line.additional_loading)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setLines((current) => current.filter((item) => item.id !== line.id))
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No consignments selected. Use Load consignments.
                    </td>
                  </tr>
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td colSpan={3} className="px-3 py-3">
                      Total ({lines.length} consignments)
                    </td>
                    <td className="px-3 py-3 text-right">{money(totals.freight)}</td>
                    <td className="px-3 py-3 text-right">{money(totals.loading)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <section className="space-y-3 rounded-lg border border-border p-3">
            <div>
              <h3 className="text-sm font-semibold">Stock Inward Source Income</h3>
              <p className="text-xs text-muted-foreground">
                Receipt reference number and date are saved with the calculated Source Income,
                posted as Unloading Income.
              </p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[650px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-3">Stock Inward Reference No.</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3 text-right">Source Income / Unloading Income</th>
                    <th className="px-3 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stockInwardLines.length ? (
                    stockInwardLines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-3 font-medium">{line.receipt_number}</td>
                        <td className="px-3 py-3">{line.receipt_date}</td>
                        <td className="px-3 py-3 text-right">{money(line.source_income_amount)}</td>
                        <td className="px-3 py-3 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setStockInwardLines((current) => current.filter((item) => item.id !== line.id))}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                        No Stock Inward source income selected. Use Load Stock Inward.
                      </td>
                    </tr>
                  )}
                </tbody>
                {stockInwardLines.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 bg-muted/30 font-semibold">
                      <td colSpan={2} className="px-3 py-3">
                        Total ({stockInwardLines.length} Stock Inward entries)
                      </td>
                      <td className="px-3 py-3 text-right">{money(stockIncomeTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
          <div className="flex justify-end">
            <Button onClick={() => void generate()} disabled={generating || (!lines.length && !stockInwardLines.length)}>
              {generating ? "Generating…" : "Generate Source Bill"}
            </Button>
          </div>
        </section>
      )}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Select unbilled consignments</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[850px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all visible consignments"
                      checked={
                        candidates.filter((row) => !lines.some((line) => line.id === row.id))
                          .length > 0 &&
                        candidates
                          .filter((row) => !lines.some((line) => line.id === row.id))
                          .every((row) => selectedCandidateIds.includes(row.id))
                      }
                      onChange={(event) =>
                        setSelectedCandidateIds(
                          event.target.checked
                            ? candidates
                                .filter((row) => !lines.some((line) => line.id === row.id))
                                .map((row) => row.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th className="px-3 py-3">Consignment</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">From → To</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidates
                  .filter((row) => !lines.some((line) => line.id === row.id))
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.consignment_number}`}
                          checked={selectedCandidateIds.includes(row.id)}
                          onChange={(event) =>
                            setSelectedCandidateIds((current) =>
                              event.target.checked
                                ? [...current, row.id]
                                : current.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-3 font-medium">{row.consignment_number}</td>
                      <td className="px-3 py-3">{row.consignment_date ?? "—"}</td>
                      <td className="px-3 py-3">
                        {row.from_pin_code} → {row.to_pin_code}
                      </td>
                      <td className="px-3 py-3 text-right">{money(row.final_freight)}</td>
                      <td className="px-3 py-3 text-right">{money(row.final_loading)}</td>
                      <td className="px-3 py-3 text-center">Select above</td>
                    </tr>
                  ))}
                {!candidates.length && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      No unbilled consignments found for this branch, source and period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Close
            </Button>
            <Button onClick={addSelectedLines} disabled={!selectedCandidateIds.length}>
              <Plus className="size-3.5" /> Add selected ({selectedCandidateIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={stockInwardPickerOpen} onOpenChange={setStockInwardPickerOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Select eligible Stock Inward source income</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Only entries with Additional Income Type Source or Both are listed. Source Income is
            recalculated from the unloading package slabs for the selected source.
          </p>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[650px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all eligible Stock Inward entries"
                      checked={
                        stockInwardCandidates.filter((row) => !stockInwardLines.some((line) => line.id === row.id)).length > 0 &&
                        stockInwardCandidates
                          .filter((row) => !stockInwardLines.some((line) => line.id === row.id))
                          .every((row) => selectedStockInwardIds.includes(row.id))
                      }
                      onChange={(event) =>
                        setSelectedStockInwardIds(
                          event.target.checked
                            ? stockInwardCandidates
                                .filter((row) => !stockInwardLines.some((line) => line.id === row.id))
                                .map((row) => row.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th className="px-3 py-3">Stock Inward Reference No.</th>
                  <th className="px-3 py-3">Receipt Date</th>
                  <th className="px-3 py-3 text-right">Source Income / Unloading Income</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stockInwardCandidates
                  .filter((row) => !stockInwardLines.some((line) => line.id === row.id))
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select Stock Inward ${row.receipt_number}`}
                          checked={selectedStockInwardIds.includes(row.id)}
                          onChange={(event) =>
                            setSelectedStockInwardIds((current) =>
                              event.target.checked
                                ? [...current, row.id]
                                : current.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-3 font-medium">{row.receipt_number}</td>
                      <td className="px-3 py-3">{row.receipt_date}</td>
                      <td className="px-3 py-3 text-right">{money(row.source_income_amount)}</td>
                    </tr>
                  ))}
                {!stockInwardCandidates.length && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground">
                      No unbilled Stock Inward entries with positive Source Income were found for
                      this source and billing period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockInwardPickerOpen(false)}>
              Close
            </Button>
            <Button onClick={addSelectedStockInward} disabled={!selectedStockInwardIds.length}>
              <Plus className="size-3.5" /> Add selected ({selectedStockInwardIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={journalPreviewOpen} onOpenChange={(open) => !generating && setJournalPreviewOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Source Bill Journal Entry Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span><strong>Basis:</strong> adjusted final freight/loading plus Stock Inward source income</span>
                <span><strong>Total:</strong> {money(previewTotals.freight + previewTotals.loading + previewTotals.unloading)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Freight, loading and selected Source Income (Unloading Income) are posted to this
                journal; approval income and unloading amounts received are not included.
              </p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2">Journal line</th><th className="px-3 py-2">Mapped account</th><th className="px-3 py-2">Account kind</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayedJournalLines.map((line) => (
                    <tr key={line.key}>
                      <td className="px-3 py-2">{line.label}</td>
                      <td className="px-3 py-2 font-medium">{line.account?.account_name ?? (line.id ? `Mapped ID ${line.id}` : "NOT MAPPED")}</td>
                      <td className="px-3 py-2">{line.account ? `${line.account.ledger_type} / ${line.account.account_kind}` : "—"}</td>
                      <td className="px-3 py-2 text-right">{line.side === "debit" ? money(line.amount) : "—"}</td>
                      <td className="px-3 py-2 text-right">{line.side === "credit" ? money(line.amount) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
                  <tr><td colSpan={3} className="px-3 py-2">Totals {displayedJournalBalanced ? "(balanced)" : "(NOT BALANCED)"}</td><td className="px-3 py-2 text-right">{money(displayedJournalDebit)}</td><td className="px-3 py-2 text-right">{money(displayedJournalCredit)}</td></tr>
                </tfoot>
              </table>
            </div>
            {journalPreviewLines.some((line) => !line.account) && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">One or more Source Master accounts are missing or could not be loaded. The database will reject this entry unless the required mapped accounts are active in this branch.</p>
            )}
            {postedJournalEntryId && <p className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">Verified from saved journal entry <strong>{postedJournalEntryId}</strong>. The lines above are the actual posted voucher, not only the preview.</p>}
            {generating && <p className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">Posting this exact entry now… Please wait.</p>}
            {journalPostStatus === "success" && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">Journal entry passed and the source bill was generated successfully.</p>}
            {journalPostError && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">Journal entry was not passed:
{journalPostError}</pre>}
          </div>
          <DialogFooter><Button variant="outline" disabled={generating} onClick={() => setJournalPreviewOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {screen === "view" && viewing && (
        <section className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Source Bill {viewing.bill_number}</h2>
              <p className="text-xs text-muted-foreground">
                Full bill view · billed consignments and Stock Inward receipts are locked.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setViewing(null);
                setScreen("list");
              }}
            >
              Back to bills
            </Button>
          </div>
          <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Branch</span>
              <p className="font-medium">{viewing.branch?.branch_name ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Source</span>
              <p className="font-medium">{viewing.source?.contract_name ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Bill date / Due date</span>
              <p>
                {viewing.bill_date} / {viewing.due_date}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Billing period</span>
              <p>
                {viewing.period_from} → {viewing.period_to}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Company / GSTIN</span>
              <p className="font-medium">
                {viewing.source_company_name || viewing.source_legal_business_name || "—"}
              </p>
              <p className="text-xs">{viewing.source_gstin || "GSTIN —"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Company address</span>
              <p>
                {viewing.source_address ||
                  [
                    viewing.source_address_line1,
                    viewing.source_address_line2,
                    viewing.source_city,
                    viewing.source_state,
                    viewing.source_country,
                    viewing.source_pin_code,
                  ]
                    .filter(Boolean)
                    .join(", ") ||
                  "—"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Consignments</span>
              <p className="font-medium">{viewItems.length}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Stock Inward source-income entries</span>
              <p className="font-medium">{viewStockInwardItems.length}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Bill totals</span>
              <p className="font-semibold">
                {money(viewing.total_freight)} freight · {money(viewing.total_loading)} loading · {money(viewing.total_unloading_income)} unloading income
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Consignment</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Route</th>
                  <th className="px-3 py-2 text-right">Freight</th>
                  <th className="px-3 py-2 text-right">Loading</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-center">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {viewItemsLoading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      Loading billed consignments…
                    </td>
                  </tr>
                ) : viewItems.length ? (
                  viewItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-medium">{item.consignment_number}</td>
                      <td className="px-3 py-2">{item.consignment_date ?? "—"}</td>
                      <td className="px-3 py-2">
                        {item.from_pin_code || "—"} → {item.to_pin_code || "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{money(item.final_freight)}</td>
                      <td className="px-3 py-2 text-right">{money(item.final_loading)}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {money(num(item.final_freight) + num(item.final_loading))}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConsignmentViewing(item.consignment_id)}
                        >
                          <Eye className="size-3.5" /> View details
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No consignments found for this bill.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">Stock Inward Source Income (Unloading Income)</h3>
              <p className="text-xs text-muted-foreground">
                Source Income only is billed; approval amounts and unloading amounts received are excluded.
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[650px] text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Reference No.</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Source Income / Unloading Income</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {viewStockInwardItems.length ? (
                    viewStockInwardItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-medium">{item.receipt_number}</td>
                        <td className="px-3 py-2">{item.receipt_date}</td>
                        <td className="px-3 py-2 text-right">{money(item.source_income_amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        No Stock Inward source-income lines on this bill.
                      </td>
                    </tr>
                  )}
                </tbody>
                {viewStockInwardItems.length > 0 && (
                  <tfoot className="border-t-2 bg-muted/30 font-semibold">
                    <tr>
                      <td colSpan={2} className="px-3 py-2">Unloading Income subtotal</td>
                      <td className="px-3 py-2 text-right">{money(viewing.total_unloading_income)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </section>
      )}
      <Dialog
        open={false}
        onOpenChange={(open) => {
          if (!open) {
            setViewing(null);
            setConsignmentViewing(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Source Bill {viewing?.bill_number}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-5">
              <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">Branch</span>
                  <p className="font-medium">{viewing.branch?.branch_name ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Source</span>
                  <p className="font-medium">{viewing.source?.contract_name ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Bill date / Due date</span>
                  <p>
                    {viewing.bill_date} / {viewing.due_date}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Billing period</span>
                  <p>
                    {viewing.period_from} → {viewing.period_to}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Consignments</span>
                  <p className="font-medium">{viewItems.length}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Bill totals</span>
                  <p className="font-semibold">
                    {money(viewing.total_freight)} freight · {money(viewing.total_loading)} loading
                  </p>
                </div>
              </div>
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Billed consignments</h3>
                  <span className="text-xs text-muted-foreground">
                    Open any row to view complete consignment details
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[1050px] text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Consignment</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Route</th>
                        <th className="px-3 py-2 text-right">Freight</th>
                        <th className="px-3 py-2 text-right">Loading</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-center">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {viewItemsLoading ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-muted-foreground">
                            Loading billed consignments…
                          </td>
                        </tr>
                      ) : viewItems.length ? (
                        viewItems.map((item) => (
                          <tr key={item.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-medium">{item.consignment_number}</td>
                            <td className="px-3 py-2">{item.consignment_date ?? "—"}</td>
                            <td className="px-3 py-2">
                              {item.from_pin_code || "—"} → {item.to_pin_code || "—"}
                            </td>
                            <td className="px-3 py-2 text-right">{money(item.final_freight)}</td>
                            <td className="px-3 py-2 text-right">{money(item.final_loading)}</td>
                            <td className="px-3 py-2 text-right font-medium">
                              {money(num(item.final_freight) + num(item.final_loading))}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConsignmentViewing(item.consignment_id)}
                              >
                                <Eye className="size-3.5" /> View details
                              </Button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-muted-foreground">
                            No consignments found for this bill.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConsignmentDetailsDialog
        consignmentId={consignmentViewing}
        open={consignmentViewing !== null}
        onOpenChange={(open) => !open && setConsignmentViewing(null)}
      />
    </div>
  );
}
