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

export const EMPTY_CONTRACT: ContractRow = {
  contract_name: "",
  branch_id: null,
  source_asset_ledger_id: null,
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
    }
    void loadAssetLedgers();
  }, [form.branch_id]);

  const isInactive = form.status === "inactive";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInactive) return; // safety guard — UI shouldn't submit on inactive
    setSaving(true);
    const { id, ...rest } = form;
    const payload = rest as never;
    const res = id
      ? await supabase.from("contracts").update(payload).eq("id", id)
      : await supabase.from("contracts").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
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
          {form.id ? (isInactive ? "View source (inactive)" : "Edit source") : "New source"}
        </h2>
        {isInactive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <Lock className="size-3" /> Read-only
          </span>
        )}
      </div>

      {isInactive && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
          This source is <strong>inactive</strong> — its data is shown for reference only and cannot be edited.
          To reactivate it, change the status to Active below and save.
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
                <option key={ledger.id} value={ledger.id}>{ledger.account_name}</option>
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
              <span className="text-muted-foreground/60">(optional — leave blank for no expiry)</span>
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
            <Select
              value={form.status ?? "active"}
              onValueChange={handleStatusChange}
            >
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
          Optional fixed charges billed on this contract. Yearly charges are automatically
          divided by 12 to calculate monthly cost in Fixed Incomes reports.
        </p>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Fixed Monthly Charge (₹)
            </Label>
            <Input
              className="h-10"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={String(form.fixed_monthly_charge ?? "")}
              onChange={(e) => patch({ fixed_monthly_charge: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Monthly Charge Note
            </Label>
            <Input
              className="h-10"
              placeholder="e.g. Software license fee"
              value={form.fixed_monthly_charge_note ?? ""}
              onChange={(e) => patch({ fixed_monthly_charge_note: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Fixed Yearly Charge (₹)
            </Label>
            <Input
              className="h-10"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={String(form.fixed_yearly_charge ?? "")}
              onChange={(e) => patch({ fixed_yearly_charge: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Yearly Charge Note
            </Label>
            <Input
              className="h-10"
              placeholder="e.g. Annual maintenance contract"
              value={form.fixed_yearly_charge_note ?? ""}
              onChange={(e) => patch({ fixed_yearly_charge_note: e.target.value })}
            />
          </div>
        </div>
      </Section>

      <section className="surface-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">
              Contracting company details
            </h3>
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
            <TextField label="Company Name" full value={form.company_name ?? ""} onChange={(v) => patch({ company_name: v })} disabled={isInactive} />
            <TextField label="Legal Business Name" value={form.legal_business_name ?? ""} onChange={(v) => patch({ legal_business_name: v })} disabled={isInactive} />
            <TextField label="Company Type" value={form.company_type ?? ""} onChange={(v) => patch({ company_type: v })} disabled={isInactive} />
            <TextField label="Industry" value={form.industry ?? ""} onChange={(v) => patch({ industry: v })} disabled={isInactive} />
            <TextField label="PAN" value={form.pan ?? ""} onChange={(v) => patch({ pan: v })} disabled={isInactive} />
            <TextField label="GSTIN" value={form.gstin ?? ""} onChange={(v) => patch({ gstin: v })} disabled={isInactive} />
            <TextField label="CIN" value={form.cin ?? ""} onChange={(v) => patch({ cin: v })} disabled={isInactive} />
            <TextField label="MSME / Udyam" value={form.msme_udyam ?? ""} onChange={(v) => patch({ msme_udyam: v })} disabled={isInactive} />
            <TextField label="TAN" value={form.tan ?? ""} onChange={(v) => patch({ tan: v })} disabled={isInactive} />
            <TextField label="IEC" value={form.iec ?? ""} onChange={(v) => patch({ iec: v })} disabled={isInactive} />
            <TextField label="Address Line 1" full value={form.address_line1 ?? ""} onChange={(v) => patch({ address_line1: v })} disabled={isInactive} />
            <TextField label="Address Line 2" full value={form.address_line2 ?? ""} onChange={(v) => patch({ address_line2: v })} disabled={isInactive} />
            <TextField label="City" value={form.city ?? ""} onChange={(v) => patch({ city: v })} disabled={isInactive} />
            <TextField label="State" value={form.state ?? ""} onChange={(v) => patch({ state: v })} disabled={isInactive} />
            <TextField label="Country" value={form.country ?? ""} onChange={(v) => patch({ country: v })} disabled={isInactive} />
            <TextField label="PIN Code" value={form.pin_code ?? ""} onChange={(v) => patch({ pin_code: v })} disabled={isInactive} />
            <TextField label="Mobile" value={form.mobile_number ?? ""} onChange={(v) => patch({ mobile_number: v })} disabled={isInactive} />
            <TextField label="Telephone" value={form.telephone_number ?? ""} onChange={(v) => patch({ telephone_number: v })} disabled={isInactive} />
            <TextField label="Email" type="email" value={form.email ?? ""} onChange={(v) => patch({ email: v })} disabled={isInactive} />
            <TextField label="Website" value={form.website ?? ""} onChange={(v) => patch({ website: v })} disabled={isInactive} />
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
          <Button
            type="button"
            onClick={() => patch({ status: "active" })}
          >
            Reactivate
          </Button>
        )}
      </div>
    </form>
  );
}
