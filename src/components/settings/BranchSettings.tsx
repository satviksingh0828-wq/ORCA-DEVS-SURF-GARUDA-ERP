import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "./CompanySettings";
import { CsvIO } from "@/components/CsvIO";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BRANCH_TYPES = [
  "Head Office",
  "Regional Office",
  "Branch Office",
  "Depot",
  "Warehouse",
  "Yard",
];

type Branch = Record<string, string> & { id?: string };

const EMPTY: Branch = {
  branch_name: "",
  branch_type: "",
  trip_series_prefix: "TR",
  lr_series_prefix: "LR",
  address_line1: "",
  address_line2: "",
  area_locality: "",
  landmark: "",
  city: "",
  district: "",
  state: "",
  country: "",
  pin_code: "",
  branch_phone: "",
  branch_email: "",
  mobile_number: "",
  email_address: "",
  manager_name: "",
  manager_designation: "",
  manager_mobile: "",
  manager_email: "",
  gstin: "",
  pan: "",
  state_code: "",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface-card p-6">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function BranchSettings() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("branches")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast.error("Could not load branches");
    setBranches((data as Branch[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const set = (k: string) => (v: string) => setEditing((f) => (f ? { ...f, [k]: v } : f));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const tripPrefix = (editing.trip_series_prefix ?? "").trim().toUpperCase();
    const lrPrefix = (editing.lr_series_prefix ?? "").trim().toUpperCase();
    if (!tripPrefix || !lrPrefix) {
      toast.error("Trip Series Prefix and LR Series Prefix are mandatory");
      return;
    }
    if (![tripPrefix, lrPrefix].every((prefix) => /^[A-Z0-9]{1,10}$/.test(prefix))) {
      toast.error("Prefixes must contain only letters or numbers (maximum 10 characters)");
      return;
    }
    setSaving(true);
    const { id, created_at: _c, updated_at: _u, ...rest } = editing;
    const payload = { ...rest, trip_series_prefix: tripPrefix, lr_series_prefix: lrPrefix } as never;
    const res = id
      ? await supabase.from("branches").update(payload).eq("id", id)
      : await supabase.from("branches").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(id ? "Branch updated" : "Branch created");
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("branches").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Branch removed");
    load();
  }

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="animate-fade-up space-y-5">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
            <ArrowLeft className="size-4" />
            Back to list
          </Button>
          <h2 className="text-lg font-semibold tracking-tight">
            {editing.id ? "Edit branch" : "New branch"}
          </h2>
        </div>

        <Section title="Branch details">
          <Field
            label="Branch Name"
            required
            value={editing.branch_name}
            onChange={set("branch_name")}
          />
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Branch Type</Label>
            <Select
              value={editing.branch_type || undefined}
              onValueChange={(v) => setEditing((f) => (f ? { ...f, branch_type: v } : f))}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {BRANCH_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Trip Series Prefix
            </Label>
            <input
              className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 uppercase"
              maxLength={10}
              placeholder="e.g. MUM, DEL, HO"
              value={editing.trip_series_prefix ?? ""}
              onChange={(e) =>
                setEditing((f) =>
                  f ? { ...f, trip_series_prefix: e.target.value.toUpperCase() } : f,
                )
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Mandatory prefix for branch trip numbers, followed by year and a six-digit sequence.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-medium text-muted-foreground">LR Series Prefix *</Label>
            <input
              className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm uppercase"
              maxLength={10}
              placeholder="e.g. LR, MUM"
              value={editing.lr_series_prefix ?? ""}
              onChange={(e) => setEditing((f) => f ? { ...f, lr_series_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") } : f)}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Mandatory prefix for branch LR numbers, followed by year and a six-digit sequence.
            </p>
          </div>
        </Section>

        <Section title="Address">
          <Field
            label="Address Line 1"
            full
            value={editing.address_line1}
            onChange={set("address_line1")}
          />
          <Field
            label="Address Line 2"
            full
            value={editing.address_line2}
            onChange={set("address_line2")}
          />
          <Field
            label="Area / Locality"
            value={editing.area_locality}
            onChange={set("area_locality")}
          />
          <Field label="Landmark" value={editing.landmark} onChange={set("landmark")} />
          <Field label="City" value={editing.city} onChange={set("city")} />
          <Field label="District" value={editing.district} onChange={set("district")} />
          <Field label="State" value={editing.state} onChange={set("state")} />
          <Field label="Country" value={editing.country} onChange={set("country")} />
          <Field label="PIN Code" value={editing.pin_code} onChange={set("pin_code")} />
        </Section>

        <Section title="Contact">
          <Field label="Branch Phone" value={editing.branch_phone} onChange={set("branch_phone")} />
          <Field
            label="Branch Email"
            type="email"
            value={editing.branch_email ?? ""}
            onChange={set("branch_email")}
          />
          <Field
            label="Mobile Number"
            value={editing.mobile_number}
            onChange={set("mobile_number")}
          />
          <Field
            label="Email Address"
            type="email"
            value={editing.email_address}
            onChange={set("email_address")}
          />
        </Section>

        <Section title="Branch manager">
          <Field label="Manager Name" value={editing.manager_name} onChange={set("manager_name")} />
          <Field
            label="Designation"
            value={editing.manager_designation}
            onChange={set("manager_designation")}
          />
          <Field label="Mobile" value={editing.manager_mobile} onChange={set("manager_mobile")} />
          <Field
            label="Email"
            type="email"
            value={editing.manager_email}
            onChange={set("manager_email")}
          />
        </Section>

        <Section title="Tax registration">
          <Field label="GSTIN" value={editing.gstin} onChange={set("gstin")} />
          <Field label="PAN (if separate)" value={editing.pan} onChange={set("pan")} />
          <Field label="State Code" value={editing.state_code} onChange={set("state_code")} />
        </Section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="h-10">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : "Save branch"}
          </Button>
        </div>
      </form>
    );
  }

  const BRANCH_COLUMNS = Object.keys(EMPTY);

  async function onImport(rows: Record<string, string>[]) {
    const payload = rows
      .filter((r) => (r.branch_name || "").trim() !== "")
      .map((r) => {
        const o: Record<string, string> = {};
        for (const k of BRANCH_COLUMNS) o[k] = r[k] ?? "";
        return o;
      });
    if (payload.length === 0) return { inserted: 0, failed: rows.length };
    const { error, count } = await supabase
      .from("branches")
      .insert(payload as never, { count: "exact" });
    if (error) {
      toast.error(error.message);
      return { inserted: 0, failed: payload.length };
    }
    await load();
    return { inserted: count ?? payload.length, failed: rows.length - payload.length };
  }

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Branches</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Offices, depots, warehouses and yards linked to your company.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvIO
            entityLabel="Branches"
            filename="branches"
            columns={BRANCH_COLUMNS}
            rows={branches as Record<string, unknown>[]}
            onImport={onImport}
          />
          <Button onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="size-4" />
            New branch
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : branches.length === 0 ? (
        <div className="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Building2 className="size-6" />
          </span>
          <p className="mt-4 text-sm font-medium">No branches yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first branch to get started.
          </p>
          <Button className="mt-5" onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="size-4" />
            New branch
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {branches.map((b, i) => (
            <li
              key={b.id}
              style={{ animationDelay: `${i * 45}ms` }}
              className="surface-card animate-fade-up flex items-center gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-lift)]"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Building2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{b.branch_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[b.branch_type, b.city, b.state].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(b)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => b.id && remove(b.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
