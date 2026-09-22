import { useState } from "react";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocationPinPair } from "@/components/LocationPinPair";
import type { RouteRange } from "@/lib/contract-ranges";
import type { ContractRow } from "./ContractForm";

export type EntryRow = {
  id?: string;
  contract_id: string;
  mode: "ROAD" | "RAIL" | "AIR" | "SHIP";
  from_location_id: string | null;
  to_location_id: string | null;
  from_pin_code: string;
  to_pin_code: string;
  /** "weight" or "quantity" — applies to all freight range slabs on this route */
  freight_route_range_type: "weight" | "quantity";
  /** Ordered list of freight slabs; start is inclusive lower bound */
  freight_route_ranges: RouteRange[];
  /** "weight" or "quantity" — applies to all loading range slabs on this route */
  loading_route_range_type: "weight" | "quantity";
  /** Ordered list of loading slabs */
  loading_route_ranges: RouteRange[];
  per_manifest_amount: string;
  per_manifest_note: string;
};

export function emptyEntry(contract_id: string): EntryRow {
  return {
    contract_id,
    mode: "ROAD",
    from_location_id: null,
    to_location_id: null,
    from_pin_code: "",
    to_pin_code: "",
    freight_route_range_type: "weight",
    freight_route_ranges: [],
    loading_route_range_type: "weight",
    loading_route_ranges: [],
    per_manifest_amount: "",
    per_manifest_note: "",
  };
}

/** Editable list of per-route slabs for one charge type (freight or loading). */
function RouteRangeEditor({
  sectionLabel,
  rangeType,
  ranges,
  onRangeTypeChange,
  onRangesChange,
}: {
  sectionLabel: string;
  rangeType: "weight" | "quantity";
  ranges: RouteRange[];
  onRangeTypeChange: (t: "weight" | "quantity") => void;
  onRangesChange: (r: RouteRange[]) => void;
}) {
  const unit = rangeType === "weight" ? "kg" : "qty";

  function update(i: number, patch: Partial<RouteRange>) {
    const next = ranges.slice();
    next[i] = { ...next[i], ...patch };
    onRangesChange(next);
  }

  function addRange() {
    const last = ranges[ranges.length - 1];
    // Suggest next start = last end + 1 (or last start + 1) so user sees a sensible default
    const nextStart = last
      ? last.end && last.end.trim() !== ""
        ? String(Number(last.end) + 1)
        : String(Number(last.start || "0") + 1)
      : "0";
    onRangesChange([...ranges, { start: nextStart, end: "", working: "rate", value: "" }]);
  }

  function removeRange(i: number) {
    onRangesChange(ranges.filter((_, j) => j !== i));
  }

  // Helper: parse a slab start string to a number for sorting
  return (
    <section className="surface-card p-6">
      <h3 className="text-sm font-semibold tracking-tight">{sectionLabel}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Both boundaries are inclusive.</span>{" "}
        Enter the From (≥) and To (≤) values for each slab.{" "}
        Leave <span className="font-medium text-foreground">To</span> blank for the last
        open-ended slab (∞).{" "}
        <span className="font-medium text-foreground">Rate ×</span> multiplies charge by actual
        units.{" "}
        <span className="font-medium text-amber-700 dark:text-amber-300">Fixed ₹</span> is a
        flat amount regardless of units.
      </p>

      <div className="mt-4 space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Range type</Label>
        <Select
          value={rangeType}
          onValueChange={(v) => onRangeTypeChange(v as "weight" | "quantity")}
        >
          <SelectTrigger className="h-10 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weight">Weight (kg)</SelectItem>
            <SelectItem value="quantity">Quantity</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {ranges.length > 0 && (
        <div className="mt-4 space-y-2">
          {/* 5 cols: From | To | Working | Value | Delete */}
          <div className="grid grid-cols-[1fr_1fr_96px_1fr_36px] gap-x-2 text-xs font-medium text-muted-foreground">
            <span>From ({unit}) ≥</span>
            <span>To ({unit}) ≤</span>
            <span className="text-center">Working</span>
            <span>Value</span>
            <span />
          </div>
          {ranges.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_96px_1fr_36px] items-center gap-x-2">
              <Input
                className="h-10"
                type="number"
                placeholder="e.g. 0"
                value={r.start}
                onChange={(e) => update(i, { start: e.target.value })}
              />
              {/* Editable upper bound — blank = open-ended (∞) */}
              <Input
                className="h-10"
                type="number"
                placeholder="∞ (open)"
                value={r.end ?? ""}
                onChange={(e) => update(i, { end: e.target.value })}
              />
              <button
                type="button"
                title={
                  r.working === "fixed"
                    ? "Fixed ₹: flat charge, NOT multiplied by units. Click to switch to Rate ×."
                    : "Rate ×: charge × actual units. Click to switch to Fixed ₹."
                }
                onClick={() => update(i, { working: r.working === "fixed" ? "rate" : "fixed" })}
                className={`h-10 rounded-md border px-2 text-xs font-semibold transition-colors ${
                  r.working === "fixed"
                    ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-300"
                    : "border-border bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.working === "fixed" ? "Fixed ₹" : "Rate ×"}
              </button>
              <Input
                className="h-10"
                type="number"
                placeholder={r.working === "fixed" ? "Flat ₹" : `Per ${unit}`}
                value={r.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="size-10 p-0"
                onClick={() => removeRange(i)}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={addRange}>
        <Plus className="size-4" />
        Add range
      </Button>
    </section>
  );
}

export function ContractEntryForm({
  contract,
  initial,
  onCancel,
  onSaved,
}: {
  contract: ContractRow;
  initial: EntryRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EntryRow>({ mode: "ROAD", ...initial });
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<EntryRow>) => setForm((f) => ({ ...f, ...p }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { id, ...rest } = form;
    const payload = rest as never;
    const res = id
      ? await supabase.from("contract_entries").update(payload).eq("id", id)
      : await supabase.from("contract_entries").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(id ? "Entry updated" : "Entry added");
    onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="animate-fade-up space-y-5">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="size-4" />
          Back to entries
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">
          {form.id ? "Edit entry" : "New entry"}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            — {contract.contract_name}
          </span>
        </h2>
      </div>

      <section className="surface-card p-6">
        <h3 className="text-sm font-semibold tracking-tight">Route</h3>
        <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Transport Mode *</Label>
            <Select value={form.mode ?? "ROAD"} onValueChange={(mode) => patch({ mode: mode as EntryRow["mode"] })}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ROAD">Road</SelectItem>
                <SelectItem value="RAIL">Rail</SelectItem>
                <SelectItem value="AIR">Air</SelectItem>
                <SelectItem value="SHIP">Ship</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <LocationPinPair
            label="From"
            locationId={form.from_location_id}
            pinCode={form.from_pin_code}
            onChange={(n) =>
              patch({ from_location_id: n.location_id, from_pin_code: n.pin_code })
            }
          />
          <LocationPinPair
            label="To"
            locationId={form.to_location_id}
            pinCode={form.to_pin_code}
            onChange={(n) =>
              patch({ to_location_id: n.location_id, to_pin_code: n.pin_code })
            }
          />
        </div>
      </section>

      <RouteRangeEditor
        sectionLabel="Freight ranges"
        rangeType={form.freight_route_range_type}
        ranges={form.freight_route_ranges}
        onRangeTypeChange={(t) => patch({ freight_route_range_type: t })}
        onRangesChange={(r) => patch({ freight_route_ranges: r })}
      />

      <RouteRangeEditor
        sectionLabel="Loading ranges"
        rangeType={form.loading_route_range_type}
        ranges={form.loading_route_ranges}
        onRangeTypeChange={(t) => patch({ loading_route_range_type: t })}
        onRangesChange={(r) => patch({ loading_route_ranges: r })}
      />

      <section className="surface-card p-6">
        <h3 className="text-sm font-semibold tracking-tight">Per manifest charge</h3>
        <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Amount</Label>
            <Input
              type="number"
              className="h-10"
              value={form.per_manifest_amount}
              onChange={(e) => patch({ per_manifest_amount: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs font-medium text-muted-foreground">Note</Label>
            <Textarea
              rows={2}
              value={form.per_manifest_note}
              onChange={(e) => patch({ per_manifest_note: e.target.value })}
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving…" : "Save entry"}
        </Button>
      </div>
    </form>
  );
}
