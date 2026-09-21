/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Link2, Plus, Search, Truck, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { toast } from "sonner";

type Shipment = {
  id: string;
  branch_id: string;
  eway_bill_number: string;
  eway_bill_date: string;
  supplier_gstin: string;
  supplier_trade_name: string;
  supplier_legal_name: string;
  supplier_address: string;
  supplier_place: string;
  supplier_state: string;
  supplier_pin_code: string;
  recipient_gstin: string;
  recipient_trade_name: string;
  recipient_legal_name: string;
  recipient_address: string;
  recipient_place: string;
  recipient_state: string;
  recipient_pin_code: string;
  dispatch_from_address: string;
  dispatch_from_place: string;
  dispatch_from_state: string;
  dispatch_from_pin_code: string;
  ship_to_address: string;
  ship_to_place: string;
  ship_to_state: string;
  ship_to_pin_code: string;
  transporter_id: string;
  approximate_distance_km: number;
  lr_number?: string | null;
};
type Source = { id: string; contract_name: string; branch_id: string; status?: string };
type View = { kind: "list" } | { kind: "create" };

const db = supabase as any;
const same = (a: unknown, b: unknown) =>
  String(a ?? "")
    .trim()
    .toUpperCase() ===
  String(b ?? "")
    .trim()
    .toUpperCase();
const newNumber = () => String(Math.floor(1000000000 + Math.random() * 9000000000));

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="min-h-9 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        {String(value || "—")}
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}
function ShipmentDetails({ shipment }: { shipment: Shipment }) {
  return (
    <div className="space-y-4">
      <Section title="Supplier / Consignor (Bill From)">
        <Field label="GSTIN / URP" value={shipment.supplier_gstin} />
        <Field label="Trade Name" value={shipment.supplier_trade_name} />
        <Field label="Legal Name" value={shipment.supplier_legal_name} />
        <Field label="Address" value={shipment.supplier_address} />
        <Field label="Place" value={shipment.supplier_place} />
        <Field label="State" value={shipment.supplier_state} />
        <Field label="PIN Code" value={shipment.supplier_pin_code} />
      </Section>
      <Section title="Recipient / Consignee (Bill To)">
        <Field label="GSTIN / URP" value={shipment.recipient_gstin} />
        <Field label="Trade Name" value={shipment.recipient_trade_name} />
        <Field label="Legal Name" value={shipment.recipient_legal_name} />
        <Field label="Address" value={shipment.recipient_address} />
        <Field label="Place" value={shipment.recipient_place} />
        <Field label="State" value={shipment.recipient_state} />
        <Field label="PIN Code" value={shipment.recipient_pin_code} />
      </Section>
      <Section title="Dispatch From">
        <Field label="Address" value={shipment.dispatch_from_address} />
        <Field label="Place" value={shipment.dispatch_from_place} />
        <Field label="State" value={shipment.dispatch_from_state} />
        <Field label="PIN Code" value={shipment.dispatch_from_pin_code} />
      </Section>
      <Section title="Ship To">
        <Field label="Address" value={shipment.ship_to_address} />
        <Field label="Place" value={shipment.ship_to_place} />
        <Field label="State" value={shipment.ship_to_state} />
        <Field label="PIN Code" value={shipment.ship_to_pin_code} />
      </Section>
      <Section title="Transport Details">
        <Field label="Transporter ID / GSTIN" value={shipment.transporter_id} />
        <Field label="Approximate Distance (KM)" value={shipment.approximate_distance_km} />
      </Section>
    </div>
  );
}

export function LorryReceiptList() {
  const { user } = useSession();
  const branches = useBranches();
  const [view, setView] = useState<View>({ kind: "list" });
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [saving, setSaving] = useState(false);
  const allowed = useMemo(
    () => (user?.role === "basic" ? (user.branchIds ?? []) : null),
    [user?.branchIds, user?.role],
  );
  const visibleBranches = useMemo(
    () => (allowed === null ? branches : branches.filter((b) => allowed.includes(b.id))),
    [allowed, branches],
  );
  const branchName = (id: string) => branches.find((b) => b.id === id)?.branch_name ?? "—";

  async function load() {
    setLoading(true);
    try {
      let query = db
        .from("lorry_receipts")
        .select(
          "*, source:contracts(contract_name), lorry_receipt_shipments:lr_shipments(shipment:shipments(*))",
        )
        .order("created_at", { ascending: false });
      if (allowed !== null)
        query = query.in(
          "branch_id",
          allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"],
        );
      const { data, error } = await query;
      if (error) throw error;
      setRows((data ?? []) as Array<Record<string, any>>);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load LR records");
    }
    setLoading(false);
  }
  const allowedKey = allowed?.join(",") ?? "all";
  useEffect(() => {
    void load();
    // load intentionally captures the current database client and branch scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedKey]);

  if (view.kind === "create")
    return (
      <LorryReceiptForm
        branches={visibleBranches}
        user={user}
        onCancel={() => setView({ kind: "list" })}
        onSaved={() => {
          setView({ kind: "list" });
          void load();
        }}
      />
    );

  const filtered = rows.filter((row) => {
    const text =
      `${row.lr_number} ${row.lorry_receipt_shipments?.map((x: any) => `${x.shipment?.eway_bill_number ?? ""} ${x.shipment?.supplier_pin_code ?? ""} ${x.shipment?.ship_to_pin_code ?? ""}`).join(" ")}`.toLowerCase();
    return (
      (branchFilter === "all" || row.branch_id === branchFilter) &&
      (!month || String(row.created_at ?? "").slice(0, 7) === month) &&
      (!search.trim() || text.includes(search.trim().toLowerCase()))
    );
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Lorry Receipts (LR)</h2>
          <p className="text-sm text-muted-foreground">
            Combine one or more compatible E-Way Bill shipments into one LR.
          </p>
        </div>
        <Button onClick={() => setView({ kind: "create" })}>
          <Plus className="mr-2 size-4" />
          Create LR
        </Button>
      </div>
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-3">
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {visibleBranches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.branch_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-44"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search LR, shipment or PIN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">LR Number</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Shipments</th>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No LR records found.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const ss = (row.lorry_receipt_shipments ?? [])
                  .map((x: any) => x.shipment)
                  .filter(Boolean) as Shipment[];
                const base = ss[0];
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3 font-semibold">{row.lr_number}</td>
                    <td className="px-4 py-3">{branchName(row.branch_id)}</td>
                    <td className="px-4 py-3">{row.source?.contract_name || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">
                        {ss.length} shipment{ss.length === 1 ? "" : "s"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {base
                        ? `${base.dispatch_from_pin_code || "—"} → ${base.ship_to_pin_code || "—"}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">{String(row.created_at ?? "").slice(0, 10)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LorryReceiptForm({
  branches,
  user,
  onCancel,
  onSaved,
}: {
  branches: Array<{ id: string; branch_name: string }>;
  user: any;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [branchId, setBranchId] = useState("");
  const [lrNumber] = useState(newNumber());
  const [sourceId, setSourceId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selected, setSelected] = useState<Shipment[]>([]);
  const [baseId, setBaseId] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!branchId) {
      setSources([]);
      setShipments([]);
      return;
    }
    void (async () => {
      const [s, sh] = await Promise.all([
        db
          .from("contracts")
          .select("id,contract_name,branch_id,status")
          .eq("branch_id", branchId)
          .order("contract_name"),
        db
          .from("shipments")
          .select("*")
          .eq("branch_id", branchId)
          .order("eway_bill_date", { ascending: false }),
      ]);
      if (s.error || sh.error)
        toast.error(s.error?.message ?? sh.error?.message ?? "Could not load LR options");
      setSources((s.data ?? []) as Source[]);
      setShipments((sh.data ?? []) as Shipment[]);
    })();
  }, [branchId]);
  const base = selected.find((s) => s.id === baseId) ?? selected[0];
  const available = shipments.filter((s) => !selected.some((x) => x.id === s.id));
  function addShipment(shipment: Shipment) {
    if (
      selected.length &&
      base &&
      (!same(base.supplier_gstin, shipment.supplier_gstin) ||
        !same(base.recipient_gstin, shipment.recipient_gstin) ||
        !same(base.dispatch_from_pin_code, shipment.dispatch_from_pin_code) ||
        !same(base.ship_to_pin_code, shipment.ship_to_pin_code))
    )
      return toast.error(
        "This shipment cannot be added: consignor GSTIN, consignee GSTIN, dispatch PIN and ship-to PIN must match the base shipment.",
      );
    setSelected((old) => [...old, shipment]);
    setBaseId((old) => old || shipment.id);
    setShowPicker(false);
  }
  function removeShipment(id: string) {
    setSelected((old) => old.filter((s) => s.id !== id));
    if (baseId === id) setBaseId(selected.find((s) => s.id !== id)?.id ?? "");
  }
  async function save() {
    if (!branchId || !sourceId || !base || selected.length === 0)
      return toast.error("Branch, source and at least one shipment are required");
    setSaving(true);
    try {
      const { data: lr, error } = await db
        .from("lorry_receipts")
        .insert({
          branch_id: branchId,
          lr_number: lrNumber,
          source_id: sourceId,
          base_shipment_id: base.id,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error || !lr) throw error ?? new Error("Could not create LR");
      const { error: linkError } = await db
        .from("lr_shipments")
        .insert(selected.map((s) => ({ lr_id: lr.id, shipment_id: s.id })));
      if (linkError) {
        await db.from("lorry_receipts").delete().eq("id", lr.id);
        throw linkError;
      }
      toast.success(
        `LR ${lrNumber} created with ${selected.length} shipment${selected.length === 1 ? "" : "s"}`,
      );
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create LR");
    }
    setSaving(false);
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          <h2 className="text-xl font-semibold">Create Lorry Receipt</h2>
          <p className="text-sm text-muted-foreground">
            Attach one or more compatible shipments to this LR.
          </p>
        </div>
      </div>
      <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Branch *</Label>
          <Select
            value={branchId}
            onValueChange={(v) => {
              setBranchId(v);
              setSelected([]);
              setBaseId("");
            }}
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
          <Label>LR Number *</Label>
          <Input value={lrNumber} readOnly />
        </div>
        <div className="space-y-1.5">
          <Label>Source / Contract *</Label>
          <Select value={sourceId} onValueChange={setSourceId} disabled={!branchId}>
            <SelectTrigger>
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              {sources
                .filter((s) => s.status !== "inactive")
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.contract_name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {base ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm">
            <Truck className="size-4 text-primary" />
            <span>
              Base shipment: <strong>{base.eway_bill_number}</strong>. Other shipments must match
              its party GSTINs and route PIN codes.
            </span>
          </div>
          <ShipmentDetails shipment={base} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          Select a shipment to auto-fill LR details.
        </div>
      )}
      <section className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Attached Shipments</h3>
            <p className="text-xs text-muted-foreground">
              Shipment number is the E-Way Bill number. Route is shown from PIN to PIN.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowPicker((v) => !v)}
            disabled={!branchId}
          >
            <Plus className="mr-1 size-4" />
            Add Shipment
          </Button>
        </div>
        {selected.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">
            No shipments attached yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Shipment / E-Way Bill</th>
                  <th className="px-2 py-2">Supplier GSTIN</th>
                  <th className="px-2 py-2">Consignee GSTIN</th>
                  <th className="px-2 py-2">Route</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {selected.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-2 py-2 font-medium">{s.eway_bill_number}</td>
                    <td className="px-2 py-2">{s.supplier_gstin || "URP"}</td>
                    <td className="px-2 py-2">{s.recipient_gstin || "URP"}</td>
                    <td className="px-2 py-2">
                      {s.dispatch_from_pin_code || "—"} → {s.ship_to_pin_code || "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="ghost" size="icon" onClick={() => removeShipment(s.id)}>
                        <X className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showPicker && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-sm font-medium">Select compatible shipment</p>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unlinked shipments available for this branch.
              </p>
            ) : (
              available.slice(0, 50).map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => addShipment(s)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span>
                    <strong>{s.eway_bill_number}</strong>
                    <span className="ml-3 text-muted-foreground">
                      {s.dispatch_from_pin_code || "—"} → {s.ship_to_pin_code || "—"}
                    </span>
                  </span>
                  <Link2 className="size-4 text-primary" />
                </button>
              ))
            )}
          </div>
        )}
      </section>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Create LR"}
        </Button>
      </div>
    </div>
  );
}
