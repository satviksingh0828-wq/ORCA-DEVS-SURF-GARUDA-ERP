import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Package, Pencil, Plus, Trash2 } from "lucide-react";
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

type PackageType = {
  id: string;
  branch_id: string;
  package_type: string;
  basis: "quantity" | "weight";
  charge_mode: "fixed" | "rate";
};
type RateKind = "loading" | "unloading";
type Slab = {
  id: string;
  package_rate_type_id: string;
  rate_kind: RateKind;
  from_value: number;
  to_value: number | null;
  amount: number;
};
const blankSlab = { id: "", from_value: "0", to_value: "", amount: "" };

export function PackageRates() {
  const { user } = useSession();
  const branches = useBranches();
  const [types, setTypes] = useState<PackageType[]>([]);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [branchId, setBranchId] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [typeForm, setTypeForm] = useState({
    package_type: "",
    basis: "quantity",
    charge_mode: "rate",
  });
  const [renameValue, setRenameValue] = useState("");
  const [slabForms, setSlabForms] = useState<Record<RateKind, typeof blankSlab>>({
    loading: { ...blankSlab },
    unloading: { ...blankSlab },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const admin = isAdminLike(user?.role);
  const allowed = user?.role === "basic" ? (user.branchIds ?? []) : null;
  const db = supabase as any;
  const branchTypes = useMemo(
    () => types.filter((t) => t.branch_id === branchId),
    [types, branchId],
  );
  const selectedType = types.find((t) => t.id === selectedTypeId) ?? null;

  async function load() {
    setLoading(true);
    let typeQuery = db.from("package_rate_types").select("*").order("package_type");
    const slabQuery = db
      .from("package_rate_entries")
      .select("id,package_rate_type_id,rate_kind,from_value,to_value,amount")
      .not("package_rate_type_id", "is", null)
      .order("from_value");
    if (allowed !== null) {
      const ids = allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"];
      typeQuery = typeQuery.in("branch_id", ids);
    }
    const [{ data: typeData, error: typeError }, { data: slabData, error: slabError }] =
      await Promise.all([typeQuery, slabQuery]);
    if (typeError) toast.error(typeError.message);
    else setTypes((typeData ?? []) as PackageType[]);
    if (slabError) toast.error(slabError.message);
    else setSlabs((slabData ?? []) as Slab[]);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [user?.id, branches.length]);
  useEffect(() => {
    if (branchId && !branchTypes.some((t) => t.id === selectedTypeId)) setSelectedTypeId("");
  }, [branchId, branchTypes, selectedTypeId]);

  async function createType(e: React.FormEvent) {
    e.preventDefault();
    if (!admin) return toast.error("Only administrators can manage Package Rates");
    if (!branchId) return toast.error("Select a branch first");
    if (!typeForm.package_type.trim()) return toast.error("Package type is required");
    setSaving(true);
    const { data, error } = await db
      .from("package_rate_types")
      .insert({
        branch_id: branchId,
        package_type: typeForm.package_type.trim(),
        basis: typeForm.basis,
        charge_mode: typeForm.charge_mode,
      })
      .select()
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setTypes((current) => [...current, data as PackageType]);
    setSelectedTypeId(data.id);
    setTypeForm({ package_type: "", basis: "quantity", charge_mode: "rate" });
    toast.success("Package type created. Add its slabs below.");
  }
  async function renameType(e: React.FormEvent) {
    e.preventDefault();
    if (!admin || !selectedType) return;
    const nextName = renameValue.trim();
    if (!nextName) return toast.error("Package type name is required");
    if (nextName === selectedType.package_type) return toast.error("Enter a new package type name");
    setSaving(true);
    const typeResult = await db
      .from("package_rate_types")
      .update({ package_type: nextName, updated_at: new Date().toISOString() })
      .eq("id", selectedType.id);
    if (!typeResult.error) {
      const slabResult = await db
        .from("package_rate_entries")
        .update({ package_type: nextName, updated_at: new Date().toISOString() })
        .eq("package_rate_type_id", selectedType.id);
      const packageResult = await db
        .from("consignment_package_information")
        .update({ package_type: nextName })
        .eq("package_rate_type_id", selectedType.id);
      if (slabResult.error || packageResult.error) {
        setSaving(false);
        return toast.error(
          slabResult.error?.message ??
            packageResult.error?.message ??
            "Could not update linked package names",
        );
      }
    }
    setSaving(false);
    if (typeResult.error) return toast.error(typeResult.error.message);
    setTypes((current) =>
      current.map((type) =>
        type.id === selectedType.id ? { ...type, package_type: nextName } : type,
      ),
    );
    setRenameValue("");
    toast.success("Package type renamed and linked consignments updated");
  }
  function editSlab(row: Slab) {
    setSlabForms((current) => ({
      ...current,
      [row.rate_kind]: {
        id: row.id,
        from_value: String(row.from_value),
        to_value: row.to_value == null ? "" : String(row.to_value),
        amount: String(row.amount),
      },
    }));
  }
  async function saveSlab(e: React.FormEvent, rateKind: RateKind) {
    e.preventDefault();
    if (!admin || !selectedType) return;
    const slabForm = slabForms[rateKind];
    if (slabForm.from_value === "" || slabForm.amount === "")
      return toast.error("From value and rate/amount are required");
    const from = Number(slabForm.from_value);
    const to = slabForm.to_value === "" ? null : Number(slabForm.to_value);
    const amount = Number(slabForm.amount);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(amount) ||
      from < 0 ||
      amount < 0 ||
      (to !== null && (!Number.isFinite(to) || to < from))
    )
      return toast.error("Enter a valid slab range and amount");
    setSaving(true);
    const payload = {
      package_rate_type_id: selectedType.id,
      rate_kind: rateKind,
      branch_id: selectedType.branch_id,
      package_type: selectedType.package_type,
      basis: selectedType.basis,
      charge_mode: selectedType.charge_mode,
      from_value: from,
      to_value: to,
      amount,
      updated_at: new Date().toISOString(),
    };
    const result = slabForm.id
      ? await db.from("package_rate_entries").update(payload).eq("id", slabForm.id)
      : await db.from("package_rate_entries").insert(payload);
    setSaving(false);
    if (result.error) return toast.error(result.error.message);
    setSlabForms((current) => ({ ...current, [rateKind]: { ...blankSlab } }));
    toast.success(
      slabForm.id
        ? `${rateKind === "loading" ? "Loading" : "Unloading"} slab updated`
        : `${rateKind === "loading" ? "Loading" : "Unloading"} slab added`,
    );
    await load();
  }
  async function removeSlab(id: string) {
    if (!admin || !window.confirm("Delete this slab?")) return;
    const { error } = await db.from("package_rate_entries").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Slab deleted");
      await load();
    }
  }
  async function removeType(type: PackageType) {
    if (!admin || !window.confirm(`Delete package type ${type.package_type} and all its slabs?`))
      return;
    const { error } = await db.from("package_rate_types").delete().eq("id", type.id);
    if (error) toast.error(error.message);
    else {
      setSelectedTypeId("");
      toast.success("Package type deleted");
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
            Select a branch first. Create package types inside that branch, then open a package type
            to add multiple slabs.
          </p>
        </div>
      </div>
      <section className="space-y-4 rounded-xl border border-border p-4">
        <div className="max-w-md space-y-1.5">
          <Label>1. Select Branch *</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue placeholder="Select branch first" />
            </SelectTrigger>
            <SelectContent>
              {branches
                .filter((b) => allowed === null || allowed.includes(b.id))
                .map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.branch_name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        {admin && branchId && (
          <form
            onSubmit={createType}
            className="grid gap-3 border-t border-border pt-4 md:grid-cols-4"
          >
            <div className="space-y-1.5">
              <Label>2. Create Package Type *</Label>
              <Input
                value={typeForm.package_type}
                onChange={(e) => setTypeForm((f) => ({ ...f, package_type: e.target.value }))}
                placeholder="Box, Bag, Pallet…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select
                value={typeForm.basis}
                onValueChange={(v) => setTypeForm((f) => ({ ...f, basis: v }))}
              >
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
                value={typeForm.charge_mode}
                onValueChange={(v) => setTypeForm((f) => ({ ...f, charge_mode: v }))}
              >
                <SelectTrigger />
                <SelectContent>
                  <SelectItem value="fixed">Fixed ₹</SelectItem>
                  <SelectItem value="rate">Rate × units</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving}>
                <Plus className="size-4" />
                Create Package Type
              </Button>
            </div>
          </form>
        )}
      </section>
      {branchId && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Package types in selected branch</h4>
            <span className="text-xs text-muted-foreground">{branchTypes.length} type(s)</span>
          </div>
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : branchTypes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No package types in this branch yet.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {branchTypes.map((type) => (
                <div
                  key={type.id}
                  className={`rounded-xl border p-4 ${selectedTypeId === type.id ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h5 className="font-semibold">{type.package_type}</h5>
                      <p className="text-xs text-muted-foreground">
                        {type.basis === "weight" ? "Weight-wise (KG)" : "Quantity-wise"} ·{" "}
                        {type.charge_mode === "fixed" ? "Fixed ₹" : "Rate × units"}
                      </p>
                    </div>
                    {admin && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedTypeId(type.id);
                            setRenameValue(type.package_type);
                          }}
                          title="Rename package type"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void removeType(type)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <Button
                    className="mt-3 w-full"
                    variant={selectedTypeId === type.id ? "default" : "outline"}
                    onClick={() => {
                      setSelectedTypeId(type.id);
                      setSlabForms({ loading: { ...blankSlab }, unloading: { ...blankSlab } });
                    }}
                  >
                    {selectedTypeId === type.id ? "Package Type Open" : "Open Package Type"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {selectedType && (
        <section className="space-y-4 rounded-xl border border-primary/30 bg-primary/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedTypeId("")}>
                <ArrowLeft className="size-4" />
                Back to package types
              </Button>
              <h4 className="mt-2 text-lg font-semibold">{selectedType.package_type}</h4>
              <p className="text-sm text-muted-foreground">
                {selectedType.basis === "weight" ? "Weight-wise (KG)" : "Quantity-wise"} ·{" "}
                {selectedType.charge_mode === "fixed" ? "Fixed ₹" : "Rate per unit (₹)"}
              </p>
            </div>
          </div>
          {admin && (
            <form
              onSubmit={renameType}
              className="flex flex-wrap items-end gap-2 border-b border-border pb-4"
            >
              <div className="min-w-[260px] flex-1 space-y-1.5">
                <Label>Rename Package Type</Label>
                <Input
                  value={renameValue || selectedType.package_type}
                  onChange={(e) => setRenameValue(e.target.value)}
                  placeholder="Package type name"
                />
              </div>
              <Button type="submit" variant="outline" disabled={saving}>
                <Pencil className="size-4" /> Rename
              </Button>
            </form>
          )}
          {(["loading", "unloading"] as RateKind[]).map((rateKind) => {
            const rateSlabs = slabs.filter(
              (slab) =>
                slab.package_rate_type_id === selectedType.id && slab.rate_kind === rateKind,
            );
            const slabForm = slabForms[rateKind];
            const rateLabel = rateKind === "loading" ? "Loading Rate" : "Unloading Rate";
            return (
              <div key={rateKind} className="space-y-4 rounded-lg border border-border/80 p-4">
                <div>
                  <h5 className="font-semibold">{rateLabel}</h5>
                  <p className="text-xs text-muted-foreground">
                    {rateKind === "loading"
                      ? "Existing loading slabs remain unchanged and continue to be used as before."
                      : "Add unloading slabs separately from the existing loading slabs."}
                  </p>
                </div>
                {admin && (
                  <form
                    onSubmit={(event) => void saveSlab(event, rateKind)}
                    className="grid gap-3 border-y border-border py-4 md:grid-cols-4"
                  >
                    <div className="space-y-1.5">
                      <Label>From (inclusive) *</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={slabForm.from_value}
                        onChange={(e) =>
                          setSlabForms((current) => ({
                            ...current,
                            [rateKind]: { ...current[rateKind], from_value: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>To (inclusive)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={slabForm.to_value}
                        onChange={(e) =>
                          setSlabForms((current) => ({
                            ...current,
                            [rateKind]: { ...current[rateKind], to_value: e.target.value },
                          }))
                        }
                        placeholder="Blank = open ended"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {selectedType.charge_mode === "fixed"
                          ? "Fixed Amount (₹) *"
                          : "Rate per unit (₹) *"}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={slabForm.amount}
                        onChange={(e) =>
                          setSlabForms((current) => ({
                            ...current,
                            [rateKind]: { ...current[rateKind], amount: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <Button type="submit" disabled={saving}>
                        {slabForm.id ? <Pencil className="size-4" /> : <Plus className="size-4" />}
                        {slabForm.id ? "Update Slab" : "Add Slab"}
                      </Button>
                      {slabForm.id && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setSlabForms((current) => ({
                              ...current,
                              [rateKind]: { ...blankSlab },
                            }))
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                )}
                {rateSlabs.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No {rateKind} slabs yet. Add the first slab above.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          {[
                            "From (inclusive)",
                            "To (inclusive)",
                            selectedType.charge_mode === "fixed"
                              ? "Fixed Amount (₹)"
                              : "Rate per unit (₹)",
                            "Actions",
                          ].map((h) => (
                            <th key={h} className="px-3 py-2">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rateSlabs.map((slab) => (
                          <tr key={slab.id} className="border-t border-border">
                            <td className="px-3 py-2">{slab.from_value}</td>
                            <td className="px-3 py-2">{slab.to_value ?? "∞"}</td>
                            <td className="px-3 py-2">
                              ₹
                              {Number(slab.amount).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" onClick={() => editSlab(slab)}>
                                  <Pencil className="size-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void removeSlab(slab.id)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
