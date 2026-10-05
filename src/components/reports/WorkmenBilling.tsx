/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { FilePlus2, Package, RefreshCw, Search, Trash2 } from "lucide-react";
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
  branch?: { branch_name?: string | null } | null;
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
  const [branchId, setBranchId] = useState("");
  const [billDate, setBillDate] = useState(isoToday);
  const [periodFrom, setPeriodFrom] = useState(monthStart);
  const [periodTo, setPeriodTo] = useState(isoToday);
  const [activeType, setActiveType] = useState<ChargeType>("loading");
  const [loadingCandidates, setLoadingCandidates] = useState<Entry[]>([]);
  const [unloadingCandidates, setUnloadingCandidates] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedLoading = selected.filter((item) => item.chargeType === "loading");
  const selectedUnloading = selected.filter((item) => item.chargeType === "unloading");
  const visibleCandidates = (
    activeType === "loading" ? loadingCandidates : unloadingCandidates
  ).filter((item) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      `${item.referenceNumber} ${item.packageType} ${item.branchName ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  });
  const totals = useMemo(
    () => ({
      loading: selectedLoading.reduce(
        (sum, item) => sum + Math.max(0, item.calculated - item.deduction + item.addition),
        0,
      ),
      unloading: selectedUnloading.reduce(
        (sum, item) => sum + Math.max(0, item.calculated - item.deduction + item.addition),
        0,
      ),
    }),
    [selectedLoading, selectedUnloading],
  );

  async function loadCandidates() {
    if (!branchId) return;
    setLoading(true);
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
      const loading = (consignments ?? []).map((row: any) => {
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
      });
      const unloading = (receipts ?? []).map((row: any) => {
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
      });
      setLoadingCandidates(loading);
      setUnloadingCandidates(unloading);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load Workmen Billing entries",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadBills() {
    let query = db
      .from("workmen_bills")
      .select(
        "id,bill_number,bill_date,period_from,period_to,total_loading,total_unloading,branch:branches(branch_name)",
      )
      .is("deleted_at", null)
      .order("bill_date", { ascending: false });
    if (branchId) query = query.eq("branch_id", branchId);
    const { data, error } = await query;
    if (error) return toast.error(`Could not load Workmen Bills: ${error.message}`);
    setBills((data ?? []) as Bill[]);
  }

  useEffect(() => {
    void loadBills();
    // loadBills intentionally follows the selected branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);
  useEffect(() => {
    if (branchId) void loadCandidates();
    // loadCandidates intentionally follows the billing filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, periodFrom, periodTo]);

  function addEntry(entry: Entry) {
    if (selected.some((item) => item.id === entry.id && item.chargeType === entry.chargeType))
      return;
    setSelected((items) => [...items, entry]);
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
    toast.success("Workmen Bill created");
    setSelected([]);
    await Promise.all([loadCandidates(), loadBills()]);
    if (data) toast.info(`Bill ${data} is ready`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4">
        <div>
          <h2 className="font-semibold">Workmen Billing</h2>
          <p className="text-sm text-muted-foreground">
            Create one bill from Loading and Unloading charges used in the Workmen Charges report.
          </p>
        </div>
        <Button onClick={() => void loadCandidates()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh entries
        </Button>
      </div>
      <form onSubmit={createBill} className="space-y-4 rounded-xl border border-border bg-card p-4">
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
            <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </div>
          <div>
            <Label>Period to *</Label>
            <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-y border-border py-3">
          <Button
            type="button"
            variant={activeType === "loading" ? "default" : "outline"}
            onClick={() => setActiveType("loading")}
          >
            <Package className="size-4" /> Loading ({selectedLoading.length})
          </Button>
          <Button
            type="button"
            variant={activeType === "unloading" ? "default" : "outline"}
            onClick={() => setActiveType("unloading")}
          >
            <Package className="size-4" /> Unloading ({selectedUnloading.length})
          </Button>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search entries"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border">
            <div className="border-b border-border bg-muted/30 px-3 py-2 font-medium">
              Available {activeType} entries
            </div>
            <div className="max-h-72 overflow-auto">
              {visibleCandidates.map((entry) => (
                <div
                  key={`${entry.chargeType}-${entry.id}`}
                  className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{entry.referenceNumber}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.packageType} · {entry.referenceDate ?? "—"}
                    </p>
                  </div>
                  <span className="text-sm font-medium">{money(entry.calculated)}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => addEntry(entry)}>
                    Add
                  </Button>
                </div>
              ))}
              {!visibleCandidates.length && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No available {activeType} entries for this period.
                </p>
              )}
            </div>
          </section>
          <section className="rounded-lg border border-primary/30">
            <div className="border-b border-primary/20 bg-primary/5 px-3 py-2 font-medium">
              Added to this bill
            </div>
            <div className="max-h-72 overflow-auto">
              {selected.map((entry) => (
                <div
                  key={`${entry.chargeType}-${entry.id}`}
                  className="grid gap-2 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[1fr_auto_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {entry.referenceNumber}{" "}
                      <span className="text-xs uppercase text-muted-foreground">
                        {entry.chargeType}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{entry.packageType}</p>
                  </div>
                  <Input
                    className="h-8 w-24"
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="Deduction"
                    value={entry.deduction}
                    onChange={(e) => updateAdjustment(entry, "deduction", e.target.value)}
                  />
                  <Input
                    className="h-8 w-24"
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label="Addition"
                    value={entry.addition}
                    onChange={(e) => updateAdjustment(entry, "addition", e.target.value)}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeEntry(entry)}
                    title={`Remove ${entry.referenceNumber}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {!selected.length && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Add rows from either list. Loading rows are locked after save; unloading rows
                  remain editable/deletable in Stock Inward.
                </p>
              )}
            </div>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Loading {money(totals.loading)} · Unloading {money(totals.unloading)}
          </span>
          <Button type="submit" disabled={saving || !selected.length}>
            <FilePlus2 className="size-4" /> {saving ? "Creating…" : "Create Workmen Bill"}
          </Button>
        </div>
      </form>
      <section className="space-y-3">
        <h3 className="font-semibold">Workmen Bills</h3>
        {bills.map((bill) => (
          <article
            key={bill.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{bill.bill_number}</p>
              <p className="text-xs text-muted-foreground">
                {bill.branch?.branch_name ?? "—"} · {bill.bill_date} · {bill.period_from ?? "—"} to{" "}
                {bill.period_to ?? "—"}
              </p>
            </div>
            <span className="text-sm">Loading {money(bill.total_loading)}</span>
            <span className="text-sm">Unloading {money(bill.total_unloading)}</span>
          </article>
        ))}
        {!bills.length && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No Workmen Bills created yet.
          </p>
        )}
      </section>
    </div>
  );
}
