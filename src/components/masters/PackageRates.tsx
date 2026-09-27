import { useEffect, useMemo, useState } from "react";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
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

type Entry = {
  id: string;
  branch_id: string;
  package_type: string;
  basis: "quantity" | "weight";
  charge_mode: "fixed" | "rate";
  from_value: number;
  to_value: number | null;
  amount: number;
};
const blank = {
  id: "",
  branch_id: "",
  package_type: "",
  basis: "quantity",
  charge_mode: "rate",
  from_value: "0",
  to_value: "",
  amount: "",
};
export function PackageRates() {
  const { user } = useSession();
  const branches = useBranches();
  const [rows, setRows] = useState<Entry[]>([]);
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const admin = isAdminLike(user?.role);
  const allowed = user?.role === "basic" ? (user.branchIds ?? []) : null;
  const branchName = (id: string) => branches.find((b) => b.id === id)?.branch_name ?? "—";
  async function load() {
    setLoading(true);
    let query = (supabase as any)
      .from("package_rate_entries")
      .select("*")
      .order("branch_id")
      .order("package_type")
      .order("basis")
      .order("from_value");
    if (allowed !== null)
      query = query.in(
        "branch_id",
        allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"],
      );
    const { data, error } = await query;
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Entry[]);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [user?.id, branches.length]);
  const packageTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.package_type))).sort(),
    [rows],
  );
  function edit(row: Entry) {
    setForm({
      id: row.id,
      branch_id: row.branch_id,
      package_type: row.package_type,
      basis: row.basis,
      charge_mode: row.charge_mode,
      from_value: String(row.from_value),
      to_value: row.to_value == null ? "" : String(row.to_value),
      amount: String(row.amount),
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!admin) return toast.error("Only administrators can manage Package Rates");
    if (
      !form.branch_id ||
      !form.package_type.trim() ||
      form.amount === "" ||
      form.from_value === ""
    )
      return toast.error("Branch, package type, From value and amount are required");
    const payload = {
      branch_id: form.branch_id,
      package_type: form.package_type.trim(),
      basis: form.basis,
      charge_mode: form.charge_mode,
      from_value: Number(form.from_value),
      to_value: form.to_value === "" ? null : Number(form.to_value),
      amount: Number(form.amount),
      updated_at: new Date().toISOString(),
    };
    if (
      !Number.isFinite(payload.from_value) ||
      !Number.isFinite(payload.amount) ||
      payload.from_value < 0 ||
      payload.amount < 0 ||
      (payload.to_value !== null &&
        (!Number.isFinite(payload.to_value) || payload.to_value < payload.from_value))
    )
      return toast.error("Enter a valid slab range and amount");
    setSaving(true);
    const db = supabase as any;
    const result = form.id
      ? await db.from("package_rate_entries").update(payload).eq("id", form.id)
      : await db.from("package_rate_entries").insert(payload);
    setSaving(false);
    if (result.error) return toast.error(result.error.message);
    toast.success(form.id ? "Package Rate updated" : "Package Rate slab added");
    setForm(blank);
    await load();
  }
  async function remove(id: string) {
    if (!admin || !window.confirm("Delete this Package Rate slab?")) return;
    const { error } = await (supabase as any).from("package_rate_entries").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Slab deleted");
      await load();
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-4">
        <Package className="mt-0.5 size-5 text-primary" />
        <div>
          <h3 className="font-semibold">Package Rate</h3>
          <p className="text-sm text-muted-foreground">
            Create a package type and define branch-wise quantity or weight slabs. Fixed means a
            flat charge; Rate × multiplies the amount by the selected quantity or weight.
          </p>
        </div>
      </div>
      {admin && (
        <form
          onSubmit={save}
          className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-4"
        >
          <div className="space-y-1.5">
            <Label>Branch *</Label>
            <Select
              value={form.branch_id}
              onValueChange={(v) => setForm((f) => ({ ...f, branch_id: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Package Type *</Label>
            <Input
              list="package-types"
              value={form.package_type}
              onChange={(e) => setForm((f) => ({ ...f, package_type: e.target.value }))}
              placeholder="Box, Bag, Pallet…"
            />
            <datalist id="package-types">
              {packageTypes.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={form.basis} onValueChange={(v) => setForm((f) => ({ ...f, basis: v }))}>
              <SelectTrigger />
              <SelectContent>
                <SelectItem value="quantity">Quantity-wise</SelectItem>
                <SelectItem value="weight">Weight-wise (KG)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Charge Type</Label>
            <Select
              value={form.charge_mode}
              onValueChange={(v) => setForm((f) => ({ ...f, charge_mode: v }))}
            >
              <SelectTrigger />
              <SelectContent>
                <SelectItem value="fixed">Fixed ₹</SelectItem>
                <SelectItem value="rate">Rate × units</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>From (inclusive) *</Label>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={form.from_value}
              onChange={(e) => setForm((f) => ({ ...f, from_value: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>To (inclusive)</Label>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={form.to_value}
              onChange={(e) => setForm((f) => ({ ...f, to_value: e.target.value }))}
              placeholder="Blank = open ended"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {form.charge_mode === "fixed" ? "Fixed Amount (₹)" : "Rate per unit (₹)"} *
            </Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={saving}>
              {form.id ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              {saving ? "Saving…" : form.id ? "Update slab" : "Add slab"}
            </Button>
            {form.id && (
              <Button type="button" variant="outline" onClick={() => setForm(blank)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {loading ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Loading Package Rates…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {[
                  "Branch",
                  "Package Type",
                  "Method",
                  "Charge",
                  "From",
                  "To",
                  "Amount",
                  "Actions",
                ].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    No Package Rate slabs created.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">{branchName(r.branch_id)}</td>
                    <td className="px-3 py-2 font-medium">{r.package_type}</td>
                    <td className="px-3 py-2">
                      {r.basis === "weight" ? "Weight-wise" : "Quantity-wise"}
                    </td>
                    <td className="px-3 py-2">
                      {r.charge_mode === "fixed" ? "Fixed ₹" : "Rate × units"}
                    </td>
                    <td className="px-3 py-2">{r.from_value}</td>
                    <td className="px-3 py-2">{r.to_value ?? "∞"}</td>
                    <td className="px-3 py-2">
                      ₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {admin && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => edit(r)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void remove(r.id)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
