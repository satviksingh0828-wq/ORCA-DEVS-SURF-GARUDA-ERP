/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  PackagePlus,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
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

const db = supabase as any;
type AdditionalIncomeMode = "approval" | "source" | "both" | "none";
type PackageLine = { packageTypeId: string; sourceId: string; quantity: string; weightKg: string };
type FormState = {
  branchId: string;
  sourceIds: string[];
  receiptDate: string;
  unloadingDate: string;
  unloadingAmountReceived: string;
  additionalIncomeMode: AdditionalIncomeMode;
  approvalAmount: string;
};

type PackageType = {
  id: string;
  branch_id: string;
  package_type: string;
  basis: "quantity" | "weight";
};
type Source = { id: string; branch_id: string | null; contract_name: string };
type Row = any;

const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const isoToday = today.toISOString().slice(0, 10);
const blankForm: FormState = {
  branchId: "",
  sourceIds: [],
  receiptDate: isoToday,
  unloadingDate: isoToday,
  unloadingAmountReceived: "0",
  additionalIncomeMode: "none",
  approvalAmount: "",
};

function money(value: unknown) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function newPackageLine(sourceIds: string[]): PackageLine {
  return {
    packageTypeId: "",
    sourceId: sourceIds.length === 1 ? sourceIds[0] : "",
    quantity: "",
    weightKg: "",
  };
}

export function StockInward() {
  const { user } = useSession();
  const branches = useBranches();
  const [sources, setSources] = useState<Source[]>([]);
  const [packageTypes, setPackageTypes] = useState<PackageType[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    from: firstOfMonth,
    to: isoToday,
    branch: "all",
    source: "all",
  });
  const [form, setForm] = useState<FormState>(blankForm);
  const [packageLines, setPackageLines] = useState<PackageLine[]>([]);

  const visibleBranches = useMemo(() => {
    const accessibleBranchIds = user?.role === "basic" ? (user.branchIds ?? []) : null;
    return branches.filter(
      (branch) => accessibleBranchIds === null || accessibleBranchIds.includes(branch.id),
    );
  }, [branches, user?.branchIds, user?.role]);
  const formSources = useMemo(
    () => sources.filter((source) => !source.branch_id || source.branch_id === form.branchId),
    [sources, form.branchId],
  );
  const formPackageTypes = useMemo(
    () => packageTypes.filter((item) => item.branch_id === form.branchId),
    [packageTypes, form.branchId],
  );
  const filterSources = useMemo(
    () =>
      sources.filter(
        (source) =>
          filters.branch === "all" || !source.branch_id || source.branch_id === filters.branch,
      ),
    [sources, filters.branch],
  );

  async function loadMasters() {
    const [sourceResult, typeResult, entryResult] = await Promise.all([
      db
        .from("contracts")
        .select("id,branch_id,contract_name")
        .eq("status", "active")
        .order("contract_name"),
      db
        .from("package_rate_types")
        .select("id,branch_id,package_type,basis")
        .eq("is_active", true)
        .order("package_type"),
      db.from("package_rate_entries").select("package_rate_type_id").eq("rate_kind", "unloading"),
    ]);
    if (sourceResult.error) toast.error(`Could not load sources: ${sourceResult.error.message}`);
    else setSources((sourceResult.data ?? []) as Source[]);
    if (typeResult.error) toast.error(`Could not load package types: ${typeResult.error.message}`);
    else {
      const unloadingIds = new Set(
        (entryResult.data ?? []).map((item: any) => item.package_rate_type_id),
      );
      setPackageTypes(
        (typeResult.data ?? []).filter((item: PackageType) =>
          unloadingIds.has(item.id),
        ) as PackageType[],
      );
    }
  }

  const loadRows = useCallback(async () => {
    setLoading(true);
    let query = db
      .from("stock_inward_receipts")
      .select(
        "id,receipt_date,unloading_date,unloading_amount_received,additional_income_mode,approval_amount,created_at,branch:branches(branch_name),stock_inward_sources(source_id,source:contracts(contract_name)),stock_inward_packages(id,package_type,quantity,weight_kg,source_id,source:contracts(contract_name))",
      )
      .gte("receipt_date", filters.from)
      .lte("receipt_date", filters.to)
      .order("receipt_date", { ascending: false });
    if (filters.branch !== "all") query = query.eq("branch_id", filters.branch);
    if (filters.source !== "all")
      query = query.eq("stock_inward_sources.source_id", filters.source);
    const { data, error } = await query;
    if (error) toast.error(`Could not load Stock Inward: ${error.message}`);
    else setRows(data ?? []);
    setLoading(false);
  }, [filters.branch, filters.from, filters.source, filters.to]);

  useEffect(() => {
    void loadMasters();
  }, []);
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function resetForm() {
    setForm({ ...blankForm, branchId: visibleBranches.length === 1 ? visibleBranches[0].id : "" });
    setPackageLines([]);
  }

  function toggleSource(sourceId: string) {
    setForm((current) => {
      const sourceIds = current.sourceIds.includes(sourceId)
        ? current.sourceIds.filter((id) => id !== sourceId)
        : [...current.sourceIds, sourceId];
      setPackageLines((lines) =>
        lines.map((line) => ({
          ...line,
          sourceId: sourceIds.length === 1 ? sourceIds[0] : line.sourceId,
        })),
      );
      return { ...current, sourceIds };
    });
  }

  function updateLine(index: number, patch: Partial<PackageLine>) {
    setPackageLines((lines) =>
      lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  }

  async function createReceipt(event: React.FormEvent) {
    event.preventDefault();
    if (!form.branchId || !form.sourceIds.length || !form.receiptDate || !form.unloadingDate)
      return toast.error(
        "Branch, at least one source, receipt date and unloading date are required",
      );
    if (!packageLines.length) return toast.error("Add at least one package type");
    if (
      packageLines.some(
        (line) =>
          !line.packageTypeId ||
          !line.sourceId ||
          (!Number(line.quantity) && !Number(line.weightKg)),
      )
    )
      return toast.error("Each package line needs a type, source and quantity or weight");
    if (packageLines.some((line) => Number(line.quantity) > 0 && Number(line.weightKg) > 0))
      return toast.error("Enter either quantity or weight for each package type, not both");
    if (["approval", "both"].includes(form.additionalIncomeMode) && !Number(form.approvalAmount))
      return toast.error("Approval amount is required for the selected additional income option");

    setSaving(true);
    const { data: receipt, error: receiptError } = await db
      .from("stock_inward_receipts")
      .insert({
        branch_id: form.branchId,
        receipt_date: form.receiptDate,
        unloading_date: form.unloadingDate,
        unloading_amount_received: Number(form.unloadingAmountReceived || 0),
        additional_income_mode: form.additionalIncomeMode,
        approval_amount: ["approval", "both"].includes(form.additionalIncomeMode)
          ? Number(form.approvalAmount)
          : null,
      })
      .select("id")
      .single();
    if (receiptError) {
      setSaving(false);
      return toast.error(receiptError.message);
    }

    const sourceResult = await db
      .from("stock_inward_sources")
      .insert(form.sourceIds.map((sourceId) => ({ receipt_id: receipt.id, source_id: sourceId })));
    const packageResult = await db.from("stock_inward_packages").insert(
      packageLines.map((line) => ({
        receipt_id: receipt.id,
        package_rate_type_id: line.packageTypeId,
        source_id: line.sourceId,
        quantity: Number(line.quantity || 0) || null,
        weight_kg: Number(line.weightKg || 0) || null,
      })),
    );
    if (sourceResult.error || packageResult.error) {
      await db.from("stock_inward_receipts").delete().eq("id", receipt.id);
      setSaving(false);
      return toast.error(
        sourceResult.error?.message ??
          packageResult.error?.message ??
          "Could not save package lines",
      );
    }
    setSaving(false);
    toast.success("Stock Inward receipt created");
    setShowCreate(false);
    resetForm();
    await loadRows();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4">
        <div>
          <h2 className="font-semibold">Stock Inward</h2>
          <p className="text-sm text-muted-foreground">
            Receive stock against one or more sources and record unloading details.
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setShowCreate(true);
          }}
        >
          <PackagePlus className="size-4" /> Create Stock Inward
        </Button>
      </div>

      <section className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-4">
        <div>
          <Label>Receipt date from</Label>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </div>
        <div>
          <Label>Receipt date to</Label>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
        <div>
          <Label>Branch</Label>
          <Select
            value={filters.branch}
            onValueChange={(branch) => setFilters((f) => ({ ...f, branch, source: "all" }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {visibleBranches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Source</Label>
          <Select
            value={filters.source}
            onValueChange={(source) => setFilters((f) => ({ ...f, source }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {filterSources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.contract_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {showCreate && (
        <section className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
          <form onSubmit={createReceipt} className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">New Stock Inward</h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowCreate(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Branch *</Label>
                <Select
                  value={form.branchId}
                  onValueChange={(branchId) => setForm((f) => ({ ...f, branchId, sourceIds: [] }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleBranches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Receipt date *</Label>
                <Input
                  type="date"
                  value={form.receiptDate}
                  onChange={(e) => setForm((f) => ({ ...f, receiptDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>Unloading date *</Label>
                <Input
                  type="date"
                  value={form.unloadingDate}
                  onChange={(e) => setForm((f) => ({ ...f, unloadingDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>
                Sources *{" "}
                <span className="font-normal text-muted-foreground">(select one or many)</span>
              </Label>
              {!form.branchId ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a branch to see its sources.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {formSources.map((source) => (
                    <label
                      key={source.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${form.sourceIds.includes(source.id) ? "border-primary bg-primary/10" : "border-border"}`}
                    >
                      <input
                        type="checkbox"
                        checked={form.sourceIds.includes(source.id)}
                        onChange={() => toggleSource(source.id)}
                      />
                      {source.contract_name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3 rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">Package details</h4>
                  <p className="text-xs text-muted-foreground">
                    Only package types with an unloading rate are shown.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPackageLines((lines) => [...lines, newPackageLine(form.sourceIds)])
                  }
                >
                  <Plus className="size-4" /> Add package type
                </Button>
              </div>
              {!packageLines.length && (
                <p className="py-3 text-sm text-muted-foreground">No package type added yet.</p>
              )}
              {packageLines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-2 border-t border-border pt-3 md:grid-cols-[1.3fr_1.3fr_1fr_1fr_auto]"
                >
                  <div>
                    <Label>Package type *</Label>
                    <Select
                      value={line.packageTypeId}
                      onValueChange={(value) => updateLine(index, { packageTypeId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select unloading type" />
                      </SelectTrigger>
                      <SelectContent>
                        {formPackageTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.package_type} ({type.basis})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Source *</Label>
                    <Select
                      value={line.sourceId}
                      onValueChange={(value) => updateLine(index, { sourceId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        {form.sourceIds.map((sourceId) => {
                          const source = sources.find((item) => item.id === sourceId);
                          return (
                            <SelectItem key={sourceId} value={sourceId}>
                              {source?.contract_name ?? sourceId}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(index, { quantity: e.target.value, weightKg: "" })
                      }
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label>Weight (KG)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.weightKg}
                      onChange={(e) =>
                        updateLine(index, { weightKg: e.target.value, quantity: "" })
                      }
                      placeholder="0"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-5"
                    onClick={() =>
                      setPackageLines((lines) =>
                        lines.filter((_, lineIndex) => lineIndex !== index),
                      )
                    }
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Unloading Amount Received</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unloadingAmountReceived}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, unloadingAmountReceived: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Additional Income</Label>
                <Select
                  value={form.additionalIncomeMode}
                  onValueChange={(value: AdditionalIncomeMode) =>
                    setForm((f) => ({
                      ...f,
                      additionalIncomeMode: value,
                      approvalAmount: ["approval", "both"].includes(value) ? f.approvalAmount : "",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approval">As per Approval</SelectItem>
                    <SelectItem value="source">As per Source</SelectItem>
                    <SelectItem value="both">Both Approval and Source</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {["approval", "both"].includes(form.additionalIncomeMode) && (
                <div>
                  <Label>Approval Amount *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.approvalAmount}
                    onChange={(e) => setForm((f) => ({ ...f, approvalAmount: e.target.value }))}
                    placeholder="Enter approval amount"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Stock Inward"}
              </Button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-3">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading Stock Inward…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No Stock Inward receipts found for the selected filters.
          </div>
        ) : (
          rows.map((row) => {
            const sourcesInRow = row.stock_inward_sources ?? [];
            const packages = row.stock_inward_packages ?? [];
            const open = expandedId === row.id;
            return (
              <article
                key={row.id}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <button
                  type="button"
                  className="grid w-full gap-2 p-4 text-left md:grid-cols-[1fr_1fr_1.4fr_1fr_auto] md:items-center"
                  onClick={() => setExpandedId(open ? null : row.id)}
                >
                  <span className="font-semibold">
                    {new Date(row.receipt_date).toLocaleDateString("en-GB")}
                  </span>
                  <span>{row.branch?.branch_name ?? "—"}</span>
                  <span className="text-sm text-muted-foreground">
                    {sourcesInRow
                      .map((item: any) => item.source?.contract_name)
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </span>
                  <span className="text-sm">₹ {money(row.unloading_amount_received)}</span>
                  {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                {open && (
                  <div className="grid gap-4 border-t border-border p-4 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground">Unloading date</p>
                      <p>{new Date(row.unloading_date).toLocaleDateString("en-GB")}</p>
                      <p className="mt-3 text-muted-foreground">Additional income</p>
                      <p>
                        {row.additional_income_mode === "none"
                          ? "None"
                          : row.additional_income_mode}
                        {row.approval_amount != null ? ` — ₹ ${money(row.approval_amount)}` : ""}
                      </p>
                    </div>
                    <div>
                      <p className="mb-2 text-muted-foreground">Packages</p>
                      <div className="space-y-2">
                        {packages.map((item: any) => (
                          <div
                            key={item.id}
                            className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                          >
                            <span>
                              {item.package_type}{" "}
                              <span className="text-muted-foreground">
                                ({item.source?.contract_name ?? "—"})
                              </span>
                            </span>
                            <span>
                              {item.quantity != null
                                ? `${item.quantity} qty`
                                : `${item.weight_kg} KG`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
