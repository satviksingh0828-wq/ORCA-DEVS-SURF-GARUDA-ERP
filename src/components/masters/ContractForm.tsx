import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { logAction } from "@/lib/log-actions";
import { BranchSelect } from "@/components/BranchSelect";

export type ContractRow = {
  id?: string;
  contract_name: string;
  branch_id?: string | null;
  source_asset_ledger_id?: string | null;
  freight_income_ledger_id?: string | null;
  loading_income_ledger_id?: string | null;
  // Contract period & status
  start_date?: string;
  end_date?: string;
  status?: string; // 'active' | 'inactive'
  // Fixed recurring charges
  fixed_monthly_charge?: number | string;
  fixed_monthly_charge_note?: string;
  fixed_yearly_charge?: number | string;
  fixed_yearly_charge_note?: string;
  // Company details
  company_name?: string;
  legal_business_name?: string;
  company_type?: string;
  industry?: string;
  pan?: string;
  gstin?: string;
  cin?: string;
  msme_udyam?: string;
  tan?: string;
  iec?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  country?: string;
  pin_code?: string;
  mobile_number?: string;
  telephone_number?: string;
  email?: string;
  website?: string;
};

type FixedIncomeLine = {
  id?: string;
  frequency: "monthly" | "yearly";
  income_name: string;
  amount: string;
  income_ledger_id: string;
  note: string;
};

type UnloadingChargeSlab = {
  id?: string;
  basis: "quantity" | "weight";
  from_value: string;
  to_value: string;
  charge_mode: "fixed" | "rate";
  amount: string;
};

export const EMPTY_CONTRACT: ContractRow = {
  contract_name: "",
  branch_id: null,
  source_asset_ledger_id: null,
  freight_income_ledger_id: null,
  loading_income_ledger_id: null,
  start_date: "",
  end_date: "",
  status: "active",
  fixed_monthly_charge: "",
  fixed_monthly_charge_note: "",
  fixed_yearly_charge: "",
  fixed_yearly_charge_note: "",
  company_name: "",
  legal_business_name: "",
  company_type: "",
  industry: "",
  pan: "",
  gstin: "",
  cin: "",
  msme_udyam: "",
  tan: "",
  iec: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  country: "",
  pin_code: "",
  mobile_number: "",
  telephone_number: "",
  email: "",
  website: "",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface-card p-6">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  full,
  type,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  full?: boolean;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        value={value}
        required={required}
        type={type ?? "text"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
      />
    </div>
  );
}

export function ContractForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: ContractRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ContractRow>({ ...initial });
  const [saving, setSaving] = useState(false);
  const [showCompany, setShowCompany] = useState(!!initial.company_name);
  const [assetLedgers, setAssetLedgers] = useState<Array<{ id: string; account_name: string }>>([]);
  const [incomeLedgers, setIncomeLedgers] = useState<Array<{ id: string; account_name: string }>>(
    [],
  );
  const [incomeLines, setIncomeLines] = useState<FixedIncomeLine[]>([]);
  const [unloadingSlabs, setUnloadingSlabs] = useState<UnloadingChargeSlab[]>([]);

  useEffect(() => {
    async function loadAssetLedgers() {
      if (!form.branch_id) {
        setAssetLedgers([]);
        return;
      }
      const db = supabase as any;
      const { data } = await db
        .from("ledger_accounts")
        .select("id,account_name")
        .eq("branch_id", form.branch_id)
        .eq("ledger_type", "asset")
        .eq("is_active", true)
        .order("account_name");
      setAssetLedgers((data ?? []) as Array<{ id: string; account_name: string }>);
      const { data: incomeData } = await db
        .from("ledger_accounts")
        .select("id,account_name")
        .eq("branch_id", form.branch_id)
        .eq("ledger_type", "income")
        .eq("is_active", true)
        .order("account_name");
      setIncomeLedgers((incomeData ?? []) as Array<{ id: string; account_name: string }>);
    }
    void loadAssetLedgers();
  }, [form.branch_id]);

  useEffect(() => {
    async function loadLines() {
      if (!initial.id) {
        setIncomeLines([]);
        return;
      }
      const db = supabase as any;
      const { data } = await db
        .from("fixed_income_lines")
        .select("id,frequency,income_name,amount,income_ledger_id,note")
        .eq("contract_id", initial.id)
        .eq("is_active", true)
        .order("created_at");
      setIncomeLines(
        (data ?? []).map((line: FixedIncomeLine) => ({
          ...line,
          amount: String(line.amount ?? ""),
        })),
      );
      const { data: unloadingData } = await db
        .from("source_unloading_charge_slabs")
        .select("id,basis,from_value,to_value,charge_mode,amount")
        .eq("contract_id", initial.id)
        .order("package_type");
      setUnloadingSlabs(
        (unloadingData ?? []).map((slab: UnloadingChargeSlab) => ({
          ...slab,
          from_value: String(slab.from_value ?? ""),
          to_value: slab.to_value == null ? "" : String(slab.to_value),
          amount: String(slab.amount ?? ""),
        })),
      );
    }
    void loadLines();
  }, [initial.id]);

  const isInactive = form.status === "inactive";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInactive) return; // safety guard — UI shouldn't submit on inactive
    setSaving(true);
    const { id, ...rest } = form;
    const payload = {
      ...rest,
      start_date: rest.start_date?.trim() || null,
      end_date: rest.end_date?.trim() || null,
      fixed_monthly_charge:
        rest.fixed_monthly_charge === "" || rest.fixed_monthly_charge == null
          ? 0
          : Number(rest.fixed_monthly_charge),
      fixed_yearly_charge:
        rest.fixed_yearly_charge === "" || rest.fixed_yearly_charge == null
          ? 0
          : Number(rest.fixed_yearly_charge),
    } as never;
    const res = id
      ? await supabase.from("contracts").update(payload).eq("id", id)
      : await (supabase as any).from("contracts").insert(payload).select("id").single();
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    const contractId = id ?? (res.data as { id: string } | null)?.id;
    if (!contractId) return toast.error("Could not identify the saved source");
    const db = supabase as any;
    const { error: deleteLinesError } = await db
      .from("fixed_income_lines")
      .delete()
      .eq("contract_id", contractId);
    if (deleteLinesError) return toast.error(deleteLinesError.message);
    const linePayload = incomeLines
      .filter((line) => line.income_name.trim() && Number(line.amount) > 0 && line.income_ledger_id)
      .map((line) => ({
        contract_id: contractId,
        frequency: line.frequency,
        income_name: line.income_name.trim(),
        amount: Number(line.amount),
        income_ledger_id: line.income_ledger_id,
        note: line.note.trim(),
      }));
    if (linePayload.length > 0) {
      const { error: insertLinesError } = await db.from("fixed_income_lines").insert(linePayload);
      if (insertLinesError) return toast.error(insertLinesError.message);
    }
    const { error: deleteUnloadingError } = await db
      .from("source_unloading_charge_slabs")
      .delete()
      .eq("contract_id", contractId);
    if (deleteUnloadingError) return toast.error(deleteUnloadingError.message);
    const unloadingPayload = unloadingSlabs
      .filter((slab) => slab.from_value !== "" && Number(slab.amount) >= 0)
      .map((slab) => ({
        contract_id: contractId,
        package_type: null,
        basis: slab.basis,
        from_value: Number(slab.from_value),
        to_value: slab.to_value === "" ? null : Number(slab.to_value),
        charge_mode: slab.charge_mode,
        amount: Number(slab.amount),
      }));
    if (unloadingPayload.length > 0) {
      const { error: insertUnloadingError } = await db
        .from("source_unloading_charge_slabs")
        .insert(unloadingPayload);
      if (insertUnloadingError) return toast.error(insertUnloadingError.message);
    }
    const isNew = !id;
    logAction(isNew ? "created" : "updated", "contract", {
      entityId: id ?? "",
      entityLabel: form.contract_name,
    });
    toast.success(id ? "Source updated" : "Source created");
    onSaved();
  }

  const patch = (p: Partial<ContractRow>) => setForm((f) => ({ ...f, ...p }));

  // When manually switching to inactive, append -old-{start}-{end} suffix to name
  function handleStatusChange(v: string) {
    if (v === "inactive" && form.status !== "inactive") {
      const base = form.contract_name.replace(/-old(-[\d-]*)*$/, "").trimEnd();
      const parts = [base, "old", form.start_date, form.end_date].filter(Boolean);
      const newName = parts.join("-");
      patch({ status: "inactive", contract_name: newName });
    } else {
      patch({ status: v });
    }
  }

  return (
    <form onSubmit={onSubmit} className="animate-fade-up space-y-5">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="size-4" />
          Back to sources
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">
          {form.id
            ? isInactive
              ? "View source (inactive)"
              : "Edit / rename source"
            : "New source"}
        </h2>
        {isInactive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Lock className="size-3" /> Read-only
          </span>
        )}
      </div>

      {isInactive && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
          This source is <strong>inactive</strong> — its data is shown for reference only and cannot
          be edited. To reactivate it, change the status to Active below and save.
        </div>
      )}

      <Section title="Source">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <TextField
            label="Source Name"
            required
            full
            value={form.contract_name}
            onChange={(v) => patch({ contract_name: v })}
            disabled={isInactive}
          />
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Source Account <span className="text-destructive">*</span>
            </Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.source_asset_ledger_id ?? ""}
              onChange={(e) => patch({ source_asset_ledger_id: e.target.value || null })}
              disabled={isInactive || !form.branch_id}
              required
            >
              <option value="">Select asset account</option>
              {assetLedgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.account_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Freight Account (Income) <span className="text-destructive">*</span>
            </Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.freight_income_ledger_id ?? ""}
              onChange={(e) => patch({ freight_income_ledger_id: e.target.value || null })}
              disabled={isInactive || !form.branch_id}
              required
            >
              <option value="">Select freight income account</option>
              {incomeLedgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.account_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Loading Account (Income) <span className="text-destructive">*</span>
            </Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.loading_income_ledger_id ?? ""}
              onChange={(e) => patch({ loading_income_ledger_id: e.target.value || null })}
              disabled={isInactive || !form.branch_id}
              required
            >
              <option value="">Select loading income account</option>
              {incomeLedgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.account_name}
                </option>
              ))}
            </select>
          </div>
          <BranchSelect
            value={form.branch_id}
            onChange={(branch_id) => patch({ branch_id })}
            label="Source Branch"
            disabled={isInactive}
          />
        </div>
      </Section>

      <Section title="Contract period &amp; status">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Start Date</Label>
            <Input
              className="h-10"
              type="date"
              value={form.start_date ?? ""}
              onChange={(e) => patch({ start_date: e.target.value })}
              disabled={isInactive}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              End Date{" "}
              <span className="text-muted-foreground/60">
                (optional — leave blank for no expiry)
              </span>
            </Label>
            <Input
              className="h-10"
              type="date"
              value={form.end_date ?? ""}
              onChange={(e) => patch({ end_date: e.target.value })}
              disabled={isInactive}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Status</Label>
            <Select value={form.status ?? "active"} onValueChange={handleStatusChange}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {form.end_date
                ? "Auto-set to Inactive when End Date is reached."
                : "Active until manually set to Inactive or an End Date is added."}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Fixed recurring charges">
        <p className="mb-4 text-xs text-muted-foreground">
          Optional fixed charges billed on this contract. Yearly charges are automatically divided
          by 12 to calculate monthly cost in Fixed Incomes reports.
        </p>
        <div className="mb-5 space-y-3">
          {incomeLines.map((line, index) => (
            <div
              key={line.id ?? index}
              className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-6"
            >
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={line.frequency}
                onChange={(e) =>
                  setIncomeLines((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, frequency: e.target.value as "monthly" | "yearly" }
                        : row,
                    ),
                  )
                }
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              <Input
                className="h-10"
                placeholder="Income name"
                value={line.income_name}
                onChange={(e) =>
                  setIncomeLines((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, income_name: e.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                className="h-10"
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                value={line.amount}
                onChange={(e) =>
                  setIncomeLines((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, amount: e.target.value } : row)),
                  )
                }
              />
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={line.income_ledger_id}
                onChange={(e) =>
                  setIncomeLines((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, income_ledger_id: e.target.value } : row,
                    ),
                  )
                }
              >
                <option value="">Select income account</option>
                {incomeLedgers.map((ledger) => (
                  <option key={ledger.id} value={ledger.id}>
                    {ledger.account_name}
                  </option>
                ))}
              </select>
              <Input
                className="h-10"
                placeholder="Optional note"
                value={line.note}
                onChange={(e) =>
                  setIncomeLines((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, note: e.target.value } : row)),
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setIncomeLines((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setIncomeLines((rows) => [
                ...rows,
                {
                  frequency: "monthly",
                  income_name: "",
                  amount: "",
                  income_ledger_id: "",
                  note: "",
                },
              ])
            }
          >
            Add fixed income
          </Button>
        </div>
      </Section>

      <Section title="Unloading charges slab">
        <p className="mb-4 text-xs text-muted-foreground">
          Select one measurement basis, then add slabs. Unloading slabs do not use package type or
          route fields.
        </p>
        <div className="mb-4 flex max-w-sm items-center gap-2">
          <Label className="whitespace-nowrap">Basis</Label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={unloadingSlabs[0]?.basis ?? "quantity"}
            disabled={isInactive}
            onChange={(e) =>
              setUnloadingSlabs((rows) =>
                rows.map((row) => ({ ...row, basis: e.target.value as "quantity" | "weight" })),
              )
            }
          >
            <option value="quantity">Quantity-wise</option>
            <option value="weight">Weight-wise (KG)</option>
          </select>
        </div>
        <div className="space-y-3">
          {unloadingSlabs.map((slab, index) => (
            <div
              key={slab.id ?? index}
              className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
            >
              <Input
                className="h-10"
                type="number"
                min="0"
                step="0.001"
                placeholder="From"
                value={slab.from_value}
                disabled={isInactive}
                onChange={(e) =>
                  setUnloadingSlabs((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, from_value: e.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                className="h-10"
                type="number"
                min="0"
                step="0.001"
                placeholder="To (optional)"
                value={slab.to_value}
                disabled={isInactive}
                onChange={(e) =>
                  setUnloadingSlabs((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, to_value: e.target.value } : row,
                    ),
                  )
                }
              />
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={slab.charge_mode}
                disabled={isInactive}
                onChange={(e) =>
                  setUnloadingSlabs((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, charge_mode: e.target.value as "fixed" | "rate" }
                        : row,
                    ),
                  )
                }
              >
                <option value="fixed">Fixed ₹</option>
                <option value="rate">Rate × units</option>
              </select>
              <Input
                className="h-10"
                type="number"
                min="0"
                step="0.01"
                placeholder="Value"
                value={slab.amount}
                disabled={isInactive}
                onChange={(e) =>
                  setUnloadingSlabs((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, amount: e.target.value } : row)),
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={isInactive}
                onClick={() => setUnloadingSlabs((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={isInactive}
            onClick={() =>
              setUnloadingSlabs((rows) => [
                ...rows,
                {
                  basis: unloadingSlabs[0]?.basis ?? "quantity",
                  from_value: "",
                  to_value: "",
                  charge_mode: "fixed",
                  amount: "",
                },
              ])
            }
          >
            Add slab
          </Button>
        </div>
      </Section>
      <section className="surface-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Contracting company details</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional — details of the company you are contracting with.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCompany((s) => !s)}
          >
            {showCompany ? "Hide" : "Show"}
          </Button>
        </div>
        {showCompany ? (
          <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <TextField
              label="Company Name"
              full
              value={form.company_name ?? ""}
              onChange={(v) => patch({ company_name: v })}
              disabled={isInactive}
            />
            <TextField
              label="Legal Business Name"
              value={form.legal_business_name ?? ""}
              onChange={(v) => patch({ legal_business_name: v })}
              disabled={isInactive}
            />
            <TextField
              label="Company Type"
              value={form.company_type ?? ""}
              onChange={(v) => patch({ company_type: v })}
              disabled={isInactive}
            />
            <TextField
              label="Industry"
              value={form.industry ?? ""}
              onChange={(v) => patch({ industry: v })}
              disabled={isInactive}
            />
            <TextField
              label="PAN"
              value={form.pan ?? ""}
              onChange={(v) => patch({ pan: v })}
              disabled={isInactive}
            />
            <TextField
              label="GSTIN"
              value={form.gstin ?? ""}
              onChange={(v) => patch({ gstin: v })}
              disabled={isInactive}
            />
            <TextField
              label="CIN"
              value={form.cin ?? ""}
              onChange={(v) => patch({ cin: v })}
              disabled={isInactive}
            />
            <TextField
              label="MSME / Udyam"
              value={form.msme_udyam ?? ""}
              onChange={(v) => patch({ msme_udyam: v })}
              disabled={isInactive}
            />
            <TextField
              label="TAN"
              value={form.tan ?? ""}
              onChange={(v) => patch({ tan: v })}
              disabled={isInactive}
            />
            <TextField
              label="IEC"
              value={form.iec ?? ""}
              onChange={(v) => patch({ iec: v })}
              disabled={isInactive}
            />
            <TextField
              label="Address Line 1"
              full
              value={form.address_line1 ?? ""}
              onChange={(v) => patch({ address_line1: v })}
              disabled={isInactive}
            />
            <TextField
              label="Address Line 2"
              full
              value={form.address_line2 ?? ""}
              onChange={(v) => patch({ address_line2: v })}
              disabled={isInactive}
            />
            <TextField
              label="City"
              value={form.city ?? ""}
              onChange={(v) => patch({ city: v })}
              disabled={isInactive}
            />
            <TextField
              label="State"
              value={form.state ?? ""}
              onChange={(v) => patch({ state: v })}
              disabled={isInactive}
            />
            <TextField
              label="Country"
              value={form.country ?? ""}
              onChange={(v) => patch({ country: v })}
              disabled={isInactive}
            />
            <TextField
              label="PIN Code"
              value={form.pin_code ?? ""}
              onChange={(v) => patch({ pin_code: v })}
              disabled={isInactive}
            />
            <TextField
              label="Mobile"
              value={form.mobile_number ?? ""}
              onChange={(v) => patch({ mobile_number: v })}
              disabled={isInactive}
            />
            <TextField
              label="Telephone"
              value={form.telephone_number ?? ""}
              onChange={(v) => patch({ telephone_number: v })}
              disabled={isInactive}
            />
            <TextField
              label="Email"
              type="email"
              value={form.email ?? ""}
              onChange={(v) => patch({ email: v })}
              disabled={isInactive}
            />
            <TextField
              label="Website"
              value={form.website ?? ""}
              onChange={(v) => patch({ website: v })}
              disabled={isInactive}
            />
          </div>
        ) : null}
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {isInactive ? "Close" : "Cancel"}
        </Button>
        {!isInactive && (
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : "Save source"}
          </Button>
        )}
        {isInactive && (
          <Button type="button" onClick={() => patch({ status: "active" })}>
            Reactivate
          </Button>
        )}
      </div>
    </form>
  );
}
