/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, PackageSearch, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { manifestCharges, num, type EntryLite } from "@/lib/trip-calc";
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

type Transporter = { id: string; transporter_name: string };
type TransporterSource = {
  id: string;
  source_name: string;
  transporter_id: string;
  branch_id?: string | null;
  liability_ledger_id?: string | null;
  freight_expenditure_ledger_id?: string | null;
  loading_expenditure_ledger_id?: string | null;
  liability_ledger?: { account_name?: string | null } | null;
  freight_expenditure_ledger?: { account_name?: string | null } | null;
  loading_expenditure_ledger?: { account_name?: string | null } | null;
};
type Bill = {
  id: string;
  system_number: string;
  system_date: string;
  transporter_bill_number: string;
  transporter_bill_date: string;
  period_from: string | null;
  period_to: string | null;
  branch?: { branch_name?: string | null } | null;
  transporter?: { transporter_name?: string | null } | null;
  transporter_source?: { source_name?: string | null } | null;
  total_freight: number | string;
  total_loading: number | string;
  deleted_at: string | null;
  journal_entry_id: string | null;
};
type Consignment = {
  id: string;
  consignment_number: string;
  branch_id: string;
  transporter_id: string | null;
  transporter_source_id: string | null;
  movement_mode: string | null;
  consignment_date: string | null;
  transport_mode: string | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  to_details?: { pincode?: string | null } | null;
  transporter?: { transporter_name?: string | null; pin_code?: string | null } | null;
  transporter_source?: { source_name?: string | null } | null;
  transporter_bill_id: string | null;
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
type Entry = EntryLite & {
  mode?: string | null;
  transporter_id?: string | null;
  source_id?: string | null;
};
type BillLine = Consignment & {
  from_pin_code: string;
  to_pin_code: string;
  total_quantity: number;
  total_weight: number;
  calculated_freight: number;
  calculated_loading: number;
  freight_deduction: number;
  additional_freight: number;
  loading_deduction: number;
  additional_loading: number;
  final_freight: number;
  final_loading: number;
};
type BillItem = {
  id: string;
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
function routePins(row: Consignment) {
  const savedTo = String(row.to_pin_code ?? "").trim();
  const ewayTo = String(row.to_details?.pincode ?? savedTo).trim();
  return row.movement_mode === "drop"
    ? { from: savedTo, to: ewayTo }
    : { from: String(row.from_pin_code ?? "").trim(), to: savedTo };
}
function findEntry(entries: Entry[], row: Consignment, sourceId: string) {
  const pins = routePins(row);
  return entries.find(
    (entry) =>
      normalizeMode(entry.mode) === normalizeMode(row.transport_mode) &&
      String(entry.source_id ?? "") === sourceId &&
      String(entry.from_pin_code ?? "").trim() === pins.from &&
      String(entry.to_pin_code ?? "").trim() === pins.to,
  );
}

export function TransporterBilling() {
  const branches = useBranches();
  const { user } = useSession();
  const [screen, setScreen] = useState<"list" | "create">("list");
  const [bills, setBills] = useState<Bill[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [sources, setSources] = useState<TransporterSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState("");
  const [listFilters, setListFilters] = useState({
    branch: "all",
    transporter: "all",
    source: "all",
    from: monthStart(),
    to: monthEnd(),
  });
  const [viewing, setViewing] = useState<Bill | null>(null);
  const [viewItems, setViewItems] = useState<BillItem[]>([]);
  const [viewItemsLoading, setViewItemsLoading] = useState(false);
  const [consignmentViewing, setConsignmentViewing] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<BillLine[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [form, setForm] = useState({
    branch: "",
    transporter: "",
    source: "",
    systemDate: new Date().toISOString().slice(0, 10),
    billNumber: "",
    billDate: new Date().toISOString().slice(0, 10),
    from: "",
    to: "",
  });
  const [generating, setGenerating] = useState(false);
  const [journalPreviewOpen, setJournalPreviewOpen] = useState(false);
  const [journalPostStatus, setJournalPostStatus] = useState<"pending" | "success" | "error">("pending");
  const [journalPostError, setJournalPostError] = useState<string | null>(null);
  const [journalPreviewAmounts, setJournalPreviewAmounts] = useState<{ freight: number; loading: number } | null>(null);
  const [postedJournalEntryId, setPostedJournalEntryId] = useState<string | null>(null);
  const [postedJournalLines, setPostedJournalLines] = useState<any[] | null>(null);

  async function loadMasters() {
    const [transporterResult, sourceResult] = await Promise.all([
      supabase.from("ltms_transporters").select("id,transporter_name").order("transporter_name"),
      (supabase as any)
        .from("ltms_transporter_sources")
        .select("id,source_name,transporter_id,branch_id,liability_ledger_id,freight_expenditure_ledger_id,loading_expenditure_ledger_id,liability_ledger:ledger_accounts!liability_ledger_id(account_name),freight_expenditure_ledger:ledger_accounts!freight_expenditure_ledger_id(account_name),loading_expenditure_ledger:ledger_accounts!loading_expenditure_ledger_id(account_name)")
        .eq("is_active", true)
        .order("source_name"),
    ]);
    if (transporterResult.error)
      toast.error(`Could not load transporters: ${transporterResult.error.message}`);
    else setTransporters((transporterResult.data ?? []) as Transporter[]);
    if (sourceResult.error)
      toast.error(`Could not load transporter sources: ${sourceResult.error.message}`);
    else setSources((sourceResult.data ?? []) as TransporterSource[]);
  }
  async function loadBills() {
    if (!listFilters.from || !listFilters.to || listFilters.from > listFilters.to)
      return toast.error("Enter a valid system date range");
    setLoading(true);
    try {
      let query = (supabase as any)
        .from("ltms_transporter_bills")
        .select(
          "id,system_number,system_date,transporter_bill_number,transporter_bill_date,period_from,period_to,total_freight,total_loading,journal_entry_id,deleted_at,branch:branches(branch_name),transporter:ltms_transporters(transporter_name),transporter_source:ltms_transporter_sources(source_name)",
        )
        .gte("system_date", listFilters.from)
        .lte("system_date", listFilters.to)
        .order("system_date", { ascending: false });
      if (listFilters.branch !== "all") query = query.eq("branch_id", listFilters.branch);
      if (listFilters.transporter !== "all")
        query = query.eq("transporter_id", listFilters.transporter);
      if (listFilters.source !== "all")
        query = query.eq("transporter_source_id", listFilters.source);
      query = showDeleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
      setBills(await fetchAll<Bill>(() => query));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load transporter bills");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadMasters();
  }, []);
  useEffect(() => {
    void loadBills(); /* filters intentionally drive the request */
    // loadBills intentionally follows the filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    listFilters.branch,
    listFilters.transporter,
    listFilters.source,
    listFilters.from,
    listFilters.to,
    showDeleted,
  ]);
  useEffect(() => {
    if (!viewing) {
      setViewItems([]);
      return;
    }
    setViewItemsLoading(true);
    void fetchAll<BillItem>(() =>
      (supabase as any)
        .from("ltms_transporter_bill_items")
        .select(
          "id,consignment_id,consignment_number,consignment_date,from_pin_code,to_pin_code,calculated_freight,freight_deduction,additional_freight,final_freight,calculated_loading,loading_deduction,additional_loading,final_loading",
        )
        .eq("bill_id", viewing.id)
        .order("consignment_date", { ascending: false }),
    )
      .then(setViewItems)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Could not load billed consignments"),
      )
      .finally(() => setViewItemsLoading(false));
  }, [viewing]);
  useEffect(() => {
    if (!form.branch || !form.transporter) return;
    setForm((current) => ({ ...current, source: "" }));
  }, [form.branch, form.transporter]);

  const formSources = useMemo(
    () =>
      sources.filter(
        (source) =>
          source.transporter_id === form.transporter &&
          (!form.branch || !source.branch_id || source.branch_id === form.branch),
      ),
    [sources, form.transporter, form.branch],
  );
  const listSources = useMemo(
    () =>
      sources.filter(
        (source) =>
          listFilters.transporter === "all" || source.transporter_id === listFilters.transporter,
      ),
    [sources, listFilters.transporter],
  );
  const updateForm = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function loadCandidates() {
    if (!form.branch || !form.transporter || !form.source || !form.billNumber.trim())
      return toast.error("Branch, transporter, source and transporter bill number are required");
    if (
      (form.from && !form.to) ||
      (!form.from && form.to) ||
      (form.from && form.to && form.from > form.to)
    )
      return toast.error("Enter both optional duration dates in the correct order");
    setPickerLoading(true);
    try {
      let query = (supabase as any)
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,transporter_id,transporter_source_id,movement_mode,consignment_date,transport_mode,from_pin_code,to_pin_code,to_details,transporter:ltms_transporters(transporter_name,pin_code),transporter_source:ltms_transporter_sources(source_name),transporter_bill_id,freight_deduction,additional_freight,loading_deduction,additional_loading",
        )
        .eq("branch_id", form.branch)
        .eq("transporter_id", form.transporter)
        .eq("transporter_source_id", form.source)
        .is("transporter_bill_id", null)
        .order("consignment_date", { ascending: false });
      if (form.from) query = query.gte("consignment_date", form.from);
      if (form.to) query = query.lte("consignment_date", form.to);
      const rows = await fetchAll<Consignment>(() => query);
      const ids = rows.map((row) => row.id);
      if (!ids.length) {
        setCandidates([]);
        setSelectedCandidateIds([]);
        setPickerOpen(true);
        return;
      }
      const transporterIds = [
        ...new Set(rows.map((row) => row.transporter_id).filter(Boolean)),
      ] as string[];
      const [packages, entries] = await Promise.all([
        fetchAll<PackageRow>(() =>
          (supabase as any)
            .from("consignment_package_information")
            .select("consignment_id,quantity,weight_kg")
            .in("consignment_id", ids),
        ),
        fetchAll<Entry>(() =>
          (supabase as any)
            .from("ltms_transporter_entries")
            .select(
              "id,transporter_id,source_id,mode,from_location_id,to_location_id,from_pin_code,to_pin_code,freight_route_range_type,freight_route_ranges,loading_route_range_type,loading_route_ranges",
            )
            .in("transporter_id", transporterIds),
        ),
      ]);
      const packageTotals = new Map<string, { quantity: number; weight: number }>();
      packages.forEach((item) => {
        const current = packageTotals.get(item.consignment_id) ?? { quantity: 0, weight: 0 };
        current.quantity += num(item.quantity);
        current.weight += num(item.weight_kg);
        packageTotals.set(item.consignment_id, current);
      });
      const contract = {
        id: form.transporter,
        contract_name: rows[0]?.transporter?.transporter_name ?? "Transporter",
      };
      setCandidates(
        rows.map((row) => {
          const pins = routePins(row);
          const pack = packageTotals.get(row.id) ?? { quantity: 0, weight: 0 };
          const entry = findEntry(entries, row, form.source);
          const charges = manifestCharges(contract, entry, {
            from_location_id: null,
            to_location_id: null,
            from_pin_code: pins.from,
            to_pin_code: pins.to,
            weight_kg: String(pack.weight),
            quantity: String(pack.quantity),
          });
          const freightDeduction = num(row.freight_deduction);
          const additionalFreight = num(row.additional_freight);
          const loadingDeduction = num(row.loading_deduction);
          const additionalLoading = num(row.additional_loading);
          return {
            ...row,
            from_pin_code: pins.from,
            to_pin_code: pins.to,
            total_quantity: pack.quantity,
            total_weight: pack.weight,
            calculated_freight: charges.freight,
            calculated_loading: charges.loading,
            freight_deduction: freightDeduction,
            additional_freight: additionalFreight,
            loading_deduction: loadingDeduction,
            additional_loading: additionalLoading,
            final_freight: Math.max(0, charges.freight - freightDeduction + additionalFreight),
            final_loading: Math.max(0, charges.loading - loadingDeduction + additionalLoading),
          };
        }),
      );
      setSelectedCandidateIds([]);
      setPickerOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load transporter consignments",
      );
    } finally {
      setPickerLoading(false);
    }
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
  async function generate() {
    if (
      !form.branch ||
      !form.transporter ||
      !form.source ||
      !form.billNumber.trim() ||
      !form.billDate ||
      !lines.length
    )
      return toast.error("Complete bill details and select at least one consignment");
    if (totals.freight + totals.loading <= 0)
      return toast.error("Adjusted final Freight and Loading total must be greater than zero before posting the journal entry");
    setJournalPreviewAmounts({ freight: totals.freight, loading: totals.loading });
    setJournalPostError(null);
    setJournalPostStatus("pending");
    setPostedJournalEntryId(null);
    setPostedJournalLines(null);
    setJournalPreviewOpen(true);
    setGenerating(true);
    const { data: generatedBillId, error } = await (supabase as any).rpc("generate_ltms_transporter_bill", {
      p_branch_id: form.branch,
      p_transporter_id: form.transporter,
      p_transporter_source_id: form.source,
      p_system_date: form.systemDate,
      p_transporter_bill_number: form.billNumber.trim(),
      p_transporter_bill_date: form.billDate,
      p_period_from: form.from || null,
      p_period_to: form.to || null,
      p_created_by: user?.id ?? null,
      p_items: lines.map((line) => ({
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
    });
    setGenerating(false);
    if (error) {
      setJournalPostStatus("error");
      setJournalPostError(error.message);
      return toast.error(`Could not generate transporter bill: ${error.message}`);
    }
    const { data: savedBill, error: savedBillError } = await (supabase as any)
      .from("ltms_transporter_bills")
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
      .select("line_no,ledger_account_id,line_description,debit,credit,ledger_account:ledger_accounts(account_name,ledger_type,account_kind)")
      .eq("journal_entry_id", savedBill.journal_entry_id)
      .order("line_no");
    if (savedLinesError || !savedLines?.length) {
      setJournalPostStatus("error");
      setJournalPostError(savedLinesError?.message ?? "The journal entry was linked but has no saved journal lines.");
      return toast.error("Bill created, but saved journal lines could not be verified");
    }
    setPostedJournalEntryId(savedBill.journal_entry_id);
    setPostedJournalLines(savedLines);
    setJournalPostStatus("success");
    toast.success("Transporter bill generated and journal entry verified.");
    setLines([]);
    setForm((current) => ({ ...current, billNumber: "" }));
    setScreen("list");
    await loadBills();
  }
  async function deleteBill(bill: Bill) {
    if (bill.deleted_at) return;
    const { error } = await (supabase as any).rpc("soft_delete_ltms_transporter_bill", {
      p_bill_id: bill.id,
      p_deleted_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("Transporter bill moved to deleted history");
    await loadBills();
  }
  const selectedBillingSource = formSources.find((source) => source.id === form.source);
  const previewTotals = journalPreviewAmounts ?? totals;
  const previewLines = [
    { key: "freight", label: "Freight expenditure (debit)", account: selectedBillingSource?.freight_expenditure_ledger, id: selectedBillingSource?.freight_expenditure_ledger_id, amount: previewTotals.freight, side: "debit" },
    { key: "loading", label: "Loading expenditure (debit)", account: selectedBillingSource?.loading_expenditure_ledger, id: selectedBillingSource?.loading_expenditure_ledger_id, amount: previewTotals.loading, side: "debit" },
    { key: "source", label: "Transporter source payable (credit)", account: selectedBillingSource?.liability_ledger, id: selectedBillingSource?.liability_ledger_id, amount: previewTotals.freight + previewTotals.loading, side: "credit" },
  ].filter((line) => line.amount > 0);
  const displayedJournalLines = postedJournalLines ?? previewLines;
  const journalDebit = displayedJournalLines.reduce((sum, line) => sum + ((line.side ?? (num(line.debit) > 0 ? "debit" : "credit")) === "debit" ? num(line.amount ?? line.debit) : 0), 0);
  const journalCredit = displayedJournalLines.reduce((sum, line) => sum + ((line.side ?? (num(line.debit) > 0 ? "debit" : "credit")) === "credit" ? num(line.amount ?? line.credit) : 0), 0);
  const journalBalanced = Math.abs(journalDebit - journalCredit) < 0.005;

  const visibleBills = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? bills.filter((bill) =>
          [
            bill.system_number,
            bill.transporter_bill_number,
            bill.branch?.branch_name,
            bill.transporter?.transporter_name,
            bill.transporter_source?.source_name,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query),
        )
      : bills;
  }, [bills, search]);

  return (
    <div className="space-y-6">
      {screen === "list" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Transporter Bill History</h2>
              <p className="text-xs text-muted-foreground">
                System numbers are automatic; transporter bill numbers are entered manually.
                Generated bills are immutable.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setScreen("create")}>
                <FilePlus2 className="size-4" /> Create Transporter Bill
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
                placeholder="Search bill, transporter or source"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select
              value={listFilters.branch}
              onValueChange={(value) =>
                setListFilters((current) => ({ ...current, branch: value }))
              }
            >
              <SelectTrigger className="h-9 w-44">
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
              value={listFilters.transporter}
              onValueChange={(value) =>
                setListFilters((current) => ({ ...current, transporter: value, source: "all" }))
              }
            >
              <SelectTrigger className="h-9 w-48">
                <SelectValue placeholder="All transporters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All transporters</SelectItem>
                {transporters.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.transporter_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={listFilters.source}
              onValueChange={(value) =>
                setListFilters((current) => ({ ...current, source: value }))
              }
            >
              <SelectTrigger className="h-9 w-52">
                <SelectValue placeholder="All transporter sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All transporter sources</SelectItem>
                {listSources.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.source_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-9 w-40"
              type="date"
              value={listFilters.from}
              onChange={(event) =>
                setListFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
            <Input
              className="h-9 w-40"
              type="date"
              value={listFilters.to}
              onChange={(event) =>
                setListFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3">System No.</th>
                  <th className="px-3 py-3">System Date</th>
                  <th className="px-3 py-3">Transporter Bill No.</th>
                  <th className="px-3 py-3">Bill Date</th>
                  <th className="px-3 py-3">Branch</th>
                  <th className="px-3 py-3">Transporter / Source</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleBills.length ? (
                  visibleBills.map((bill) => (
                    <tr key={bill.id} className="hover:bg-muted/20">
                      <td className="px-3 py-3 font-medium">
                        {bill.system_number}
                        {bill.deleted_at && (
                          <span className="ml-2 text-xs text-destructive">Deleted</span>
                        )}
                      </td>
                      <td className="px-3 py-3">{bill.system_date}</td>
                      <td className="px-3 py-3">{bill.transporter_bill_number}</td>
                      <td className="px-3 py-3">{bill.transporter_bill_date}</td>
                      <td className="px-3 py-3">{bill.branch?.branch_name ?? "—"}</td>
                      <td className="px-3 py-3">
                        {bill.transporter?.transporter_name ?? "—"} /{" "}
                        {bill.transporter_source?.source_name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-right">{money(bill.total_freight)}</td>
                      <td className="px-3 py-3 text-right">{money(bill.total_loading)}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setViewing(bill)}>
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
                      {loading ? "Loading bills…" : "No transporter bills found."}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <FilePlus2 className="size-4 text-primary" /> Create Transporter Bill
              </h2>
              <p className="text-xs text-muted-foreground">
                Duration is optional. Only consignments without a transporter bill can be selected.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setScreen("list")}>
              Back to bills
            </Button>
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
              Transporter
              <Select
                value={form.transporter}
                onValueChange={(value) => updateForm("transporter", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select transporter" />
                </SelectTrigger>
                <SelectContent>
                  {transporters.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.transporter_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Transporter Source
              <Select value={form.source} onValueChange={(value) => updateForm("source", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select transporter source" />
                </SelectTrigger>
                <SelectContent>
                  {formSources.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.source_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              System Date
              <Input
                type="date"
                value={form.systemDate}
                onChange={(event) => updateForm("systemDate", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Transporter Bill Number
              <Input
                value={form.billNumber}
                onChange={(event) => updateForm("billNumber", event.target.value)}
                placeholder="Enter transporter bill no."
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Transporter Bill Date
              <Input
                type="date"
                value={form.billDate}
                onChange={(event) => updateForm("billDate", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Duration From (optional)
              <Input
                type="date"
                value={form.from}
                onChange={(event) => updateForm("from", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Duration To (optional)
              <Input
                type="date"
                value={form.to}
                onChange={(event) => updateForm("to", event.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => void loadCandidates()}
              disabled={pickerLoading}
            >
              {pickerLoading ? <RefreshCw className="animate-spin" /> : <PackageSearch />} Load
              consignments
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1250px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3">Consignment</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Route</th>
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
          <div className="flex justify-end">
            <Button onClick={() => void generate()} disabled={generating || !lines.length}>
              {generating ? "Generating…" : "Generate Transporter Bill"}
            </Button>
          </div>
        </section>
      )}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Select unbilled transporter consignments</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
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
                  <th className="px-3 py-3">Route</th>
                  <th className="px-3 py-3 text-right">Freight</th>
                  <th className="px-3 py-3 text-right">Loading</th>
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
                        {row.from_pin_code || "—"} → {row.to_pin_code || "—"}
                      </td>
                      <td className="px-3 py-3 text-right">{money(row.final_freight)}</td>
                      <td className="px-3 py-3 text-right">{money(row.final_loading)}</td>
                    </tr>
                  ))}
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
      <Dialog open={journalPreviewOpen} onOpenChange={(open) => !generating && setJournalPreviewOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Transporter Bill Journal Entry Preview</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><span><strong>Basis:</strong> adjusted final freight/loading only</span><span><strong>Total:</strong> {money(previewTotals.freight + previewTotals.loading)}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">Freight and Loading are posted as expenditure debits; the mapped transporter source ledger is credited.</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-sm"><thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Journal line</th><th className="px-3 py-2">Mapped account</th><th className="px-3 py-2">Account kind</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr></thead><tbody className="divide-y divide-border">{displayedJournalLines.map((line: any, index: number) => { const account = line.account ?? line.ledger_account; const debit = num(line.amount ?? line.debit); const credit = num(line.amount ?? line.credit); const isDebit = line.side ? line.side === "debit" : debit > 0; return <tr key={line.key ?? `${line.line_no}-${index}`}><td className="px-3 py-2">{line.label ?? line.line_description ?? `Line ${line.line_no}`}</td><td className="px-3 py-2 font-medium">{account?.account_name ?? (line.id || line.ledger_account_id ? `Mapped ID ${line.id ?? line.ledger_account_id}` : "NOT MAPPED")}</td><td className="px-3 py-2">{account ? `${account.ledger_type} / ${account.account_kind}` : "—"}</td><td className="px-3 py-2 text-right">{isDebit ? money(debit) : "—"}</td><td className="px-3 py-2 text-right">{!isDebit ? money(credit) : "—"}</td></tr>; })}</tbody><tfoot className="border-t-2 border-border bg-muted/30 font-semibold"><tr><td colSpan={3} className="px-3 py-2">Totals {journalBalanced ? "(balanced)" : "(NOT BALANCED)"}</td><td className="px-3 py-2 text-right">{money(journalDebit)}</td><td className="px-3 py-2 text-right">{money(journalCredit)}</td></tr></tfoot></table></div>
            {generating && <p className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">Posting this exact entry now… Please wait.</p>}
            {postedJournalEntryId && <p className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">Verified from saved journal entry <strong>{postedJournalEntryId}</strong>. The lines above are the actual posted voucher.</p>}
            {journalPostStatus === "success" && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">Journal entry passed and the transporter bill was generated successfully.</p>}
            {journalPostError && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">Journal entry was not passed:
{journalPostError}</pre>}
          </div>
          <DialogFooter><Button variant="outline" disabled={generating} onClick={() => setJournalPreviewOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewing(null);
            setConsignmentViewing(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transporter Bill {viewing?.transporter_bill_number}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-5">
              <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">System No. / Date</span>
                  <p className="font-medium">
                    {viewing.system_number} / {viewing.system_date}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Transporter Bill No. / Date</span>
                  <p className="font-medium">
                    {viewing.transporter_bill_number} / {viewing.transporter_bill_date}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Branch</span>
                  <p>{viewing.branch?.branch_name ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Transporter</span>
                  <p>{viewing.transporter?.transporter_name ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Transporter Source</span>
                  <p>{viewing.transporter_source?.source_name ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration</span>
                  <p>
                    {viewing.period_from && viewing.period_to
                      ? `${viewing.period_from} → ${viewing.period_to}`
                      : "All dates"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Bill totals</span>
                  <p className="font-semibold">
                    {money(viewing.total_freight)} freight · {money(viewing.total_loading)} loading
                  </p>
                </div>
              </div>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    Billed consignments ({viewItems.length})
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Open any row for complete consignment details
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[1000px] text-sm">
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
