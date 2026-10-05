/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, Package, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { num } from "@/lib/trip-calc";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ChargeType = "loading" | "unloading";
type Entry = {
  id: string;
  chargeType: ChargeType;
  referenceNumber: string;
  referenceDate: string | null;
  branchName?: string | null;
  packageType: string;
  calculated: number;
  deduction: number;
  addition: number;
};
type Bill = {
  id: string;
  bill_number: string;
  bill_date: string;
  period_from: string | null;
  period_to: string | null;
  total_loading: number | string;
  total_unloading: number | string;
  additional_pay_amount: number | string;
  additional_pay_note: string | null;
  deduction_amount: number | string;
  deduction_note: string | null;
  grand_total: number | string;
  journal_entry_id?: string | null;
  branch?: { branch_name?: string | null } | null;
};
type BillItem = Entry & {
  id: string;
  calculated_amount: number | string;
  final_amount: number | string;
};

const isoToday = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toISOString()
  .slice(0, 10);
const money = (value: number | string | null | undefined) =>
  `₹${num(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function chargeForPackage(
  item: any,
  types: Map<string, any>,
  entries: any[],
  rateKind: ChargeType,
) {
  const type = types.get(item.package_rate_type_id);
  if (!type) return 0;
  const measure = type.basis === "weight" ? num(item.weight_kg) : num(item.quantity);
  const slab = entries
    .filter((entry) => entry.package_rate_type_id === type.id && entry.rate_kind === rateKind)
    .sort((a, b) => num(b.from_value) - num(a.from_value))
    .find(
      (entry) =>
        num(entry.from_value) <= measure &&
        (entry.to_value == null || measure <= num(entry.to_value)),
    );
  if (!slab || measure <= 0) return 0;
  return type.charge_mode === "rate" ? num(slab.amount) * measure : num(slab.amount);
}

export function WorkmenBilling() {
  const db = supabase as any;
  const { user } = useSession();
  const branches = useBranches();
  const [screen, setScreen] = useState<"list" | "create" | "view">("list");
  const [branchId, setBranchId] = useState("");
  const [billDate, setBillDate] = useState(isoToday);
  const [periodFrom, setPeriodFrom] = useState(monthStart);
  const [periodTo, setPeriodTo] = useState(isoToday);
  const [activeType, setActiveType] = useState<ChargeType>("loading");
  const [loadingCandidates, setLoadingCandidates] = useState<Entry[]>([]);
  const [unloadingCandidates, setUnloadingCandidates] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry[]>([]);
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [viewing, setViewing] = useState<Bill | null>(null);
  const [viewItems, setViewItems] = useState<BillItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [listBranch, setListBranch] = useState("all");
  const [listDateFrom, setListDateFrom] = useState("");
  const [listDateTo, setListDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [additionalPayAmount, setAdditionalPayAmount] = useState("0");
  const [additionalPayNote, setAdditionalPayNote] = useState("");
  const [deductionAmount, setDeductionAmount] = useState("0");
  const [deductionNote, setDeductionNote] = useState("");

  const selectedLoading = selected.filter((item) => item.chargeType === "loading");
  const selectedUnloading = selected.filter((item) => item.chargeType === "unloading");
  const candidates = activeType === "loading" ? loadingCandidates : unloadingCandidates;
  const visibleCandidates = candidates.filter((item) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      `${item.referenceNumber} ${item.packageType} ${item.branchName ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  });
  const totals = useMemo(() => {
    const loading = selectedLoading.reduce(
      (sum, item) => sum + Math.max(0, item.calculated - item.deduction + item.addition),
      0,
    );
    const unloading = selectedUnloading.reduce(
      (sum, item) => sum + Math.max(0, item.calculated - item.deduction + item.addition),
      0,
    );
    const additionalPay = Math.max(0, num(additionalPayAmount));
    const deduction = Math.max(0, num(deductionAmount));
    return {
      loading,
      unloading,
      additionalPay,
      deduction,
      grand: Math.max(0, loading + unloading + additionalPay - deduction),
    };
  }, [selectedLoading, selectedUnloading, additionalPayAmount, deductionAmount]);

  async function loadCandidates() {
    if (!branchId) return;
    setPickerLoading(true);
    try {
      const [typesResult, entriesResult, consignments, receipts] = await Promise.all([
        db
          .from("package_rate_types")
          .select("id,package_type,basis,charge_mode")
          .eq("branch_id", branchId),
        db
          .from("package_rate_entries")
          .select("package_rate_type_id,from_value,to_value,amount,rate_kind")
          .eq("branch_id", branchId),
        fetchAll<any>(() =>
          db
            .from("consignments")
            .select(
              "id,consignment_number,consignment_date,branch:branches(branch_name),consignment_package_information(package_rate_type_id,package_type,quantity,weight_kg)",
            )
            .eq("branch_id", branchId)
            .is("workmen_loading_bill_id", null)
            .gte("consignment_date", periodFrom)
            .lte("consignment_date", periodTo)
            .order("consignment_date", { ascending: false }),
        ),
        fetchAll<any>(() =>
          db
            .from("stock_inward_receipts")
            .select(
              "id,receipt_number,receipt_date,branch:branches(branch_name),stock_inward_packages(package_rate_type_id,package_type,quantity,weight_kg)",
            )
            .eq("branch_id", branchId)
            .is("workmen_unloading_bill_id", null)
            .gte("receipt_date", periodFrom)
            .lte("receipt_date", periodTo)
            .order("receipt_date", { ascending: false }),
        ),
      ]);
      if (typesResult.error) throw new Error(typesResult.error.message);
      if (entriesResult.error) throw new Error(entriesResult.error.message);
      const types = new Map((typesResult.data ?? []).map((item: any) => [item.id, item]));
      const entries = entriesResult.data ?? [];
      setLoadingCandidates(
        (consignments ?? []).map((row: any) => {
          const packages = row.consignment_package_information ?? [];
          return {
            id: row.id,
            chargeType: "loading" as const,
            referenceNumber: row.consignment_number,
            referenceDate: row.consignment_date,
            branchName: row.branch?.branch_name,
            packageType:
              [...new Set(packages.map((item: any) => item.package_type).filter(Boolean))].join(
                ", ",
              ) || "—",
            calculated: packages.reduce(
              (sum: number, item: any) => sum + chargeForPackage(item, types, entries, "loading"),
              0,
            ),
            deduction: 0,
            addition: 0,
          };
        }),
      );
      setUnloadingCandidates(
        (receipts ?? []).map((row: any) => {
          const packages = row.stock_inward_packages ?? [];
          return {
            id: row.id,
            chargeType: "unloading" as const,
            referenceNumber: row.receipt_number ?? row.id,
            referenceDate: row.receipt_date,
            branchName: row.branch?.branch_name,
            packageType:
              [...new Set(packages.map((item: any) => item.package_type).filter(Boolean))].join(
                ", ",
              ) || "—",
            calculated: packages.reduce(
              (sum: number, item: any) => sum + chargeForPackage(item, types, entries, "unloading"),
              0,
            ),
            deduction: 0,
            addition: 0,
          };
        }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load Workmen Billing entries",
      );
    } finally {
      setPickerLoading(false);
    }
  }

  async function loadBills() {
    let query = db
      .from("workmen_bills")
      .select(
        "id,bill_number,bill_date,period_from,period_to,total_loading,total_unloading,additional_pay_amount,additional_pay_note,deduction_amount,deduction_note,grand_total,journal_entry_id,branch:branches(branch_name)",
      )
      .is("deleted_at", null)
      .order("bill_date", { ascending: false });
    if (listBranch !== "all") query = query.eq("branch_id", listBranch);
    if (listDateFrom) query = query.gte("bill_date", listDateFrom);
    if (listDateTo) query = query.lte("bill_date", listDateTo);
    const { data, error } = await query;
    if (error) return toast.error(`Could not load Workmen Bills: ${error.message}`);
    setBills((data ?? []) as Bill[]);
  }

  async function viewBill(bill: Bill) {
    setViewing(bill);
    const { data, error } = await db
      .from("workmen_bill_items")
      .select(
        "id,charge_type,reference_number,reference_date,package_type,calculated_amount,final_amount",
      )
      .eq("bill_id", bill.id)
      .order("charge_type")
      .order("reference_date", { ascending: false });
    if (error) return toast.error(`Could not load bill entries: ${error.message}`);
    setViewItems(
      (data ?? []).map((item: any) => ({
        ...item,
        chargeType: item.charge_type,
        referenceNumber: item.reference_number,
        referenceDate: item.reference_date,
        packageType: item.package_type ?? "—",
        calculated: num(item.calculated_amount),
        deduction: 0,
        addition: 0,
      })),
    );
    setScreen("view");
  }

  async function deleteBill(bill: Bill) {
    if (
      !window.confirm(
        `Delete Workmen Bill ${bill.bill_number}? Linked loading and unloading entries will become available for billing again.`,
      )
    )
      return;
    setLoading(true);
    const { error } = await db.rpc("delete_workmen_bill", { p_bill_id: bill.id });
    setLoading(false);
    if (error) return toast.error(`Could not delete Workmen Bill: ${error.message}`);
    toast.success(`Workmen Bill ${bill.bill_number} deleted`);
    if (viewing?.id === bill.id) {
      setViewing(null);
      setViewItems([]);
      setScreen("list");
    }
    await loadBills();
  }

  useEffect(() => {
    void loadBills();
    // loadBills intentionally follows the list filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listBranch, listDateFrom, listDateTo]);
  useEffect(() => {
    if (screen === "create" && branchId) void loadCandidates();
    // loadCandidates intentionally follows the create form filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, branchId, periodFrom, periodTo]);

  function openCreate() {
    setScreen("create");
    setSelected([]);
    setAdditionalPayAmount("0");
    setAdditionalPayNote("");
    setDeductionAmount("0");
    setDeductionNote("");
  }
  function openPicker(type: ChargeType) {
    setActiveType(type);
    setCandidateIds([]);
    setSearch("");
    setPickerOpen(true);
    if (branchId) void loadCandidates();
  }
  function addSelectedCandidates() {
    const selectedEntries = candidates.filter((item) => candidateIds.includes(item.id));
    setSelected((current) => [
      ...current,
      ...selectedEntries.filter(
        (entry) =>
          !current.some((item) => item.id === entry.id && item.chargeType === entry.chargeType),
      ),
    ]);
    setPickerOpen(false);
    setCandidateIds([]);
  }
  function removeEntry(entry: Entry) {
    setSelected((items) =>
      items.filter((item) => !(item.id === entry.id && item.chargeType === entry.chargeType)),
    );
  }
  function updateAdjustment(entry: Entry, key: "deduction" | "addition", value: string) {
    setSelected((items) =>
      items.map((item) =>
        item.id === entry.id && item.chargeType === entry.chargeType
          ? { ...item, [key]: num(value) }
          : item,
      ),
    );
  }
  async function createBill(event: React.FormEvent) {
    event.preventDefault();
    if (!branchId) return toast.error("Select a branch");
    if (!selected.length) return toast.error("Add at least one loading or unloading entry");
    if (periodFrom > periodTo) return toast.error("Billing period is invalid");
    setSaving(true);
    const { data, error } = await db.rpc("create_workmen_bill", {
      p_branch_id: branchId,
      p_bill_date: billDate,
      p_period_from: periodFrom,
      p_period_to: periodTo,
      p_created_by: user?.id ?? null,
      p_additional_pay_amount: totals.additionalPay,
      p_additional_pay_note: additionalPayNote.trim() || null,
      p_deduction_amount: totals.deduction,
      p_deduction_note: deductionNote.trim() || null,
      p_items: selected.map((item) => ({
        charge_type: item.chargeType,
        consignment_id: item.chargeType === "loading" ? item.id : null,
        stock_inward_receipt_id: item.chargeType === "unloading" ? item.id : null,
        package_type: item.packageType,
        calculated_amount: item.calculated,
        deduction: item.deduction,
        addition: item.addition,
        final_amount: Math.max(0, item.calculated - item.deduction + item.addition),
      })),
    });
    setSaving(false);
    if (error) return toast.error(`Could not create Workmen Bill: ${error.message}`);
    toast.success("Workmen Bill created and journal entry posted");
    setScreen("list");
    setSelected([]);
    await Promise.all([loadCandidates(), loadBills()]);
    if (data) toast.info(`Bill ${data} is ready`);
  }

  if (screen === "list") {
    return (
      <div className="space-y-5">
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Workmen Bill History</h2>
              <p className="text-xs text-muted-foreground">
                Loading and unloading workmen charges generated from the Workmen Charges report.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={openCreate}>
                <FilePlus2 className="size-4" /> Create Workmen Bill
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadBills()}
                disabled={loading}
              >
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>Branch</Label>
              <Select value={listBranch} onValueChange={setListBranch}>
                <SelectTrigger>
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
            <div>
              <Label>Bill Date From</Label>
              <Input
                type="date"
                value={listDateFrom}
                onChange={(e) => setListDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>Bill Date To</Label>
              <Input
                type="date"
                value={listDateTo}
                onChange={(e) => setListDateTo(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Bill Number</th>
                  <th className="px-3 py-3">Bill Date</th>
                  <th className="px-3 py-3">Branch</th>
                  <th className="px-3 py-3 text-right">Loading</th>
                  <th className="px-3 py-3 text-right">Unloading</th>
                  <th className="px-3 py-3 text-right">Additional Pay</th>
                  <th className="px-3 py-3 text-right">Deduction</th>
                  <th className="px-3 py-3 text-right">Net Total</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <tr key={bill.id} className="border-t border-border">
                    <td className="px-3 py-3 font-medium">
                      {bill.bill_number}
                      {bill.journal_entry_id && (
                        <p className="text-xs font-normal text-muted-foreground">Journal posted</p>
                      )}
                    </td>
                    <td className="px-3 py-3">{bill.bill_date}</td>
                    <td className="px-3 py-3">{bill.branch?.branch_name ?? "—"}</td>
                    <td className="px-3 py-3 text-right">{money(bill.total_loading)}</td>
                    <td className="px-3 py-3 text-right">{money(bill.total_unloading)}</td>
                    <td className="px-3 py-3 text-right">{money(bill.additional_pay_amount)}</td>
                    <td className="px-3 py-3 text-right">{money(bill.deduction_amount)}</td>
                    <td className="px-3 py-3 text-right font-semibold">
                      {money(bill.grand_total)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => void viewBill(bill)}>
                          <Eye className="size-3.5" /> View
                        </Button>
                        {!bill.journal_entry_id && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void deleteBill(bill)}
                            disabled={loading}
                          >
                            <Trash2 className="size-3.5" /> Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!bills.length && (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                      No Workmen Bills found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (screen === "view" && viewing) {
    return (
      <section className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Workmen Bill {viewing.bill_number}</h2>
            <p className="text-xs text-muted-foreground">
              Bill details and billed loading/unloading references
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setScreen("list")}>
              Back to bills
            </Button>
            {!viewing.journal_entry_id && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void deleteBill(viewing)}
                disabled={loading}
              >
                <Trash2 className="size-3.5" /> Delete Bill
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-muted-foreground">Branch</p>
            <p className="font-medium">{viewing.branch?.branch_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Bill Date</p>
            <p className="font-medium">{viewing.bill_date}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Period</p>
            <p className="font-medium">
              {viewing.period_from ?? "—"} to {viewing.period_to ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Net Total</p>
            <p className="font-semibold">{money(viewing.grand_total)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Journal Entry</p>
            <p className="break-all font-medium">
              {viewing.journal_entry_id ?? "Not posted (legacy bill)"}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Charge Type</th>
                <th className="px-3 py-3">Reference</th>
                <th className="px-3 py-3">Package Type</th>
                <th className="px-3 py-3">Reference Date</th>
                <th className="px-3 py-3 text-right">Calculated</th>
                <th className="px-3 py-3 text-right">Final Amount</th>
              </tr>
            </thead>
            <tbody>
              {viewItems.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-3 py-3 capitalize">{item.chargeType}</td>
                  <td className="px-3 py-3 font-semibold">{item.referenceNumber}</td>
                  <td className="px-3 py-3">{item.packageType}</td>
                  <td className="px-3 py-3">{item.referenceDate ?? "—"}</td>
                  <td className="px-3 py-3 text-right">{money(item.calculated_amount)}</td>
                  <td className="px-3 py-3 text-right font-semibold">{money(item.final_amount)}</td>
                </tr>
              ))}
              {!viewItems.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    No bill entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Additional Pay</p>
            <p>{money(viewing.additional_pay_amount)}</p>
            <p className="mt-1 text-muted-foreground">{viewing.additional_pay_note || "No note"}</p>
          </div>
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Deduction</p>
            <p>{money(viewing.deduction_amount)}</p>
            <p className="mt-1 text-muted-foreground">{viewing.deduction_note || "No note"}</p>
          </div>
        </div>
      </section>
    );
  }

  const renderAddedRows = (type: ChargeType, rows: Entry[]) => (
    <section className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{type === "loading" ? "Loading" : "Unloading"} Entries</h3>
          <p className="text-xs text-muted-foreground">
            {rows.length} selected ·{" "}
            {money(
              rows.reduce(
                (sum, item) => sum + Math.max(0, item.calculated - item.deduction + item.addition),
                0,
              ),
            )}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => openPicker(type)}>
          <Plus className="size-3.5" /> Add {type}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Package Type</th>
              <th className="px-3 py-2 text-right">Calculated</th>
              <th className="px-3 py-2 text-right">Deduction</th>
              <th className="px-3 py-2 text-right">Addition</th>
              <th className="px-3 py-2 text-right">Final</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const final = Math.max(0, entry.calculated - entry.deduction + entry.addition);
              return (
                <tr key={entry.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    {entry.referenceNumber}
                    <div className="text-xs text-muted-foreground">
                      {entry.referenceDate ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2">{entry.packageType}</td>
                  <td className="px-3 py-2 text-right">{money(entry.calculated)}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      className="ml-auto h-8 w-28"
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.deduction}
                      onChange={(e) => updateAdjustment(entry, "deduction", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      className="ml-auto h-8 w-28"
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.addition}
                      onChange={(e) => updateAdjustment(entry, "addition", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{money(final)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeEntry(entry)}
                      title={`Remove ${entry.referenceNumber}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No {type} entries added. Use Add {type} to load entries in a popup.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FilePlus2 className="size-4 text-primary" /> Create Workmen Bill
            </h2>
            <p className="text-xs text-muted-foreground">
              Add loading and unloading entries from the Workmen Charges report. Loading entries are
              locked after billing; Stock Inward entries remain editable/deletable.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setScreen("list")}>
            Back to bills
          </Button>
        </div>
        <form onSubmit={createBill} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label>Branch *</Label>
              <Select value={branchId} onValueChange={setBranchId}>
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
            </div>
            <div>
              <Label>Bill date *</Label>
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div>
              <Label>Period from *</Label>
              <Input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>Period to *</Label>
              <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
            </div>
          </div>
          {renderAddedRows("loading", selectedLoading)}
          {renderAddedRows("unloading", selectedUnloading)}
          <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <h3 className="mb-3 font-semibold">Bill-level adjustments</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                <Label>Additional Pay Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={additionalPayAmount}
                  onChange={(e) => setAdditionalPayAmount(e.target.value)}
                  placeholder="0.00"
                />
                <Label>Additional Pay Note</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={additionalPayNote}
                  onChange={(e) => setAdditionalPayNote(e.target.value)}
                  placeholder="Reason or note for additional pay"
                />
              </div>
              <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                <Label>Deduction Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={deductionAmount}
                  onChange={(e) => setDeductionAmount(e.target.value)}
                  placeholder="0.00"
                />
                <Label>Deduction Note</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={deductionNote}
                  onChange={(e) => setDeductionNote(e.target.value)}
                  placeholder="Reason or note for deduction"
                />
              </div>
            </div>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>
                Loading <strong>{money(totals.loading)}</strong>
              </span>
              <span>
                Unloading <strong>{money(totals.unloading)}</strong>
              </span>
              <span>
                Additional Pay <strong>{money(totals.additionalPay)}</strong>
              </span>
              <span>
                Deduction <strong>{money(totals.deduction)}</strong>
              </span>
              <span>
                Net Total <strong>{money(totals.grand)}</strong>
              </span>
            </div>
            <Button type="submit" disabled={saving || !selected.length}>
              {saving ? "Generating…" : "Generate Workmen Bill"}
            </Button>
          </div>
        </form>
      </section>
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Select {activeType} entries</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={`Search ${activeType} entries`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void loadCandidates()}
              disabled={pickerLoading}
            >
              <RefreshCw className={`size-4 ${pickerLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-3" />
                  <th className="px-3 py-3">Reference</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Package Type</th>
                  <th className="px-3 py-3 text-right">Calculated Charge</th>
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map((entry) => (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={candidateIds.includes(entry.id)}
                        onChange={(e) =>
                          setCandidateIds((ids) =>
                            e.target.checked
                              ? [...ids, entry.id]
                              : ids.filter((id) => id !== entry.id),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-3 font-medium">{entry.referenceNumber}</td>
                    <td className="px-3 py-3">{entry.referenceDate ?? "—"}</td>
                    <td className="px-3 py-3">{entry.packageType}</td>
                    <td className="px-3 py-3 text-right">{money(entry.calculated)}</td>
                  </tr>
                ))}
                {!visibleCandidates.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      No {activeType} entries available for this period.
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
            <Button onClick={addSelectedCandidates} disabled={!candidateIds.length}>
              <Plus className="size-3.5" /> Add selected ({candidateIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
