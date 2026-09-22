/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, Link2, Pencil, Plus, Search, Trash2, Truck, X } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { toast } from "sonner";
import { findEntry, manifestCharges, num, type EntryLite } from "@/lib/trip-calc";

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
type TransportMode = "ROAD" | "RAIL" | "AIR" | "SHIP";
type Transporter = { id: string; transporter_name: string };
type View = { kind: "list" } | { kind: "create" };

const blankShipment: Shipment = {
  id: "",
  branch_id: "",
  eway_bill_number: "",
  eway_bill_date: "",
  supplier_gstin: "",
  supplier_trade_name: "",
  supplier_legal_name: "",
  supplier_address: "",
  supplier_place: "",
  supplier_state: "",
  supplier_pin_code: "",
  recipient_gstin: "",
  recipient_trade_name: "",
  recipient_legal_name: "",
  recipient_address: "",
  recipient_place: "",
  recipient_state: "",
  recipient_pin_code: "",
  dispatch_from_address: "",
  dispatch_from_place: "",
  dispatch_from_state: "",
  dispatch_from_pin_code: "",
  ship_to_address: "",
  ship_to_place: "",
  ship_to_state: "",
  ship_to_pin_code: "",
  transporter_id: "",
  approximate_distance_km: 0,
};

type NewShipmentItem = { description: string; hsn_code: string; quantity: string; weight_kg: string; unit: string; taxable_value: string; total_invoice_value: string };
type NewShipmentForm = Omit<Shipment, "id" | "branch_id" | "approximate_distance_km"> & { branch_id: string; approximate_distance_km: string; document_type: string; document_number: string; document_date: string; eway_bill_status: string; valid_from: string; valid_until: string; supply_type: string; sub_type: string };
const blankNewShipment = (branchId: string): NewShipmentForm => ({
  branch_id: branchId, eway_bill_number: "", eway_bill_date: new Date().toISOString().slice(0, 10), eway_bill_status: "Active", valid_from: "", valid_until: "", supply_type: "Outward", sub_type: "Supply", document_type: "Tax Invoice", document_number: "", document_date: new Date().toISOString().slice(0, 10), supplier_gstin: "URP", supplier_trade_name: "", supplier_legal_name: "", supplier_address: "", supplier_place: "", supplier_state: "", supplier_pin_code: "", recipient_gstin: "URP", recipient_trade_name: "", recipient_legal_name: "", recipient_address: "", recipient_place: "", recipient_state: "", recipient_pin_code: "", dispatch_from_address: "", dispatch_from_place: "", dispatch_from_state: "", dispatch_from_pin_code: "", ship_to_address: "", ship_to_place: "", ship_to_state: "", ship_to_pin_code: "", transporter_id: "", approximate_distance_km: "", total_taxable_value: 0, total_invoice_value: 0, item_count: 0, created_at: "", lr_number: null,
});

function lrIncome(sourceId: string, mode: TransportMode, shipments: Array<Record<string, any>>, entries: EntryLite[]) {
  if (!sourceId || shipments.length === 0) return 0;
  return shipments.reduce((total, shipment) => {
    const items = (shipment.shipment_items ?? []) as Array<Record<string, any>>;
    const weight = items.reduce((sum, item) => sum + num(item.weight_kg), 0);
    const quantity = items.reduce((sum, item) => sum + num(item.quantity), 0);
    const entry = findEntry(
      entries.filter((candidate) => candidate.contract_id === sourceId && ((candidate as any).mode ?? "ROAD") === mode),
      {
        from_location_id: null,
        to_location_id: null,
        from_pin_code: String(shipment.dispatch_from_pin_code ?? ""),
        to_pin_code: String(shipment.ship_to_pin_code ?? ""),
        weight_kg: String(weight),
        quantity: String(quantity),
      },
    );
    return total + (entry ? (() => {
      const charges = manifestCharges({ id: sourceId, contract_name: "" }, entry, {
        from_location_id: null,
        to_location_id: null,
        from_pin_code: String(shipment.dispatch_from_pin_code ?? ""),
        to_pin_code: String(shipment.ship_to_pin_code ?? ""),
        weight_kg: String(weight),
        quantity: String(quantity),
      });
      return charges.freight + charges.loading + charges.fixed;
    })() : 0);
  }, 0);
}

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
function EntryField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
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
function LrTotals({ shipments }: { shipments: Array<Record<string, any>> }) {
  const items = shipments.flatMap((shipment) => (shipment.shipment_items ?? []) as Array<Record<string, any>>);
  const totalTaxable = items.reduce((sum, item) => sum + Number(item.taxable_value ?? 0), 0);
  const totalInvoice = items.reduce((sum, item) => sum + Number(item.total_invoice_value ?? 0), 0);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  const totalWeight = items.reduce((sum, item) => sum + Number(item.weight_kg ?? 0), 0);
  const money = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 });

  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="mb-3 font-semibold">LR Totals — All Connected Shipments</h3>
      <div className="flex flex-wrap justify-end gap-5 border-t border-border pt-3 text-sm">
        <span>Taxable total: <strong>{money(totalTaxable)}</strong></span>
        <span>Invoice total: <strong>{money(totalInvoice)}</strong></span>
        <span>Total quantity: <strong>{number(totalQuantity)}</strong></span>
        <span>Total Weight (in kg): <strong>{number(totalWeight)} kg</strong></span>
      </div>
    </section>
  );
}

export function LorryReceiptList() {
  const { user } = useSession();
  const branches = useBranches();
  const [view, setView] = useState<View>({ kind: "list" });
  const [viewingRow, setViewingRow] = useState<Record<string, any> | null>(null);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [assignment, setAssignment] = useState("all");
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
          "*, source:contracts(contract_name), trip_link:trip_lorry_receipts(trip:trips(trip_code)), lorry_receipt_shipments:lr_shipments(shipment:shipments(*, shipment_items(*)))",
        )
        .order("created_at", { ascending: false });
      if (allowed !== null)
        query = query.in(
          "branch_id",
          allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"],
        );
      const { data, error } = await query;
      if (error) throw error;
      setRows(((data ?? []) as Array<Record<string, any>>).map((row) => ({ ...row, trip_number: row.trip_link?.trip?.trip_code ?? null })));
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
  async function deleteLr(row: Record<string, any>) {
    const { data: activeLink, error: linkCheckError } = await db
      .from("trip_lorry_receipts")
      .select("trip:trips(trip_code)")
      .eq("lr_id", row.id)
      .maybeSingle();
    if (linkCheckError) return toast.error(linkCheckError.message);
    if (activeLink) {
      const tripCode = activeLink.trip?.trip_code ?? "the linked Trip";
      return toast.error(`LR ${row.lr_number} cannot be deleted while linked to ${tripCode}. Delete the Trip or remove the LR link first.`);
    }
    if (!window.confirm(`Delete LR ${row.lr_number}? Its shipments will be disconnected but not deleted.`)) return;
    const { error: unlinkError } = await db.from("lr_shipments").delete().eq("lr_id", row.id);
    if (unlinkError) return toast.error(unlinkError.message);
    const { error } = await db.from("lorry_receipts").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success(`LR ${row.lr_number} deleted; shipments were disconnected`);
    setViewingRow(null);
    await load();
  }
  function editLr(row: Record<string, any>) {
    if (row.trip_number) return toast.error(`LR ${row.lr_number} cannot be edited while linked to ${row.trip_number}`);
    setEditingRow(row);
  }

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
  if (editingRow)
    return (
      <LorryReceiptEditForm
        row={editingRow}
        branches={visibleBranches}
        onCancel={() => setEditingRow(null)}
        onSaved={() => {
          setEditingRow(null);
          void load();
        }}
      />
    );
  if (viewingRow)
    return (
      <LorryReceiptView
        row={viewingRow}
        branchName={branchName}
        onBack={() => setViewingRow(null)}
        onDelete={() => void deleteLr(viewingRow)}
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
        <Select value={assignment} onValueChange={setAssignment}><SelectTrigger className="w-40"><SelectValue placeholder="Assignment" /></SelectTrigger><SelectContent><SelectItem value="all">All LR</SelectItem><SelectItem value="assigned">Assigned</SelectItem><SelectItem value="unsigned">Unsigned</SelectItem></SelectContent></Select>
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
              <th className="px-4 py-3">Trip Number</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
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
                    <td className="px-4 py-3">{row.trip_number ?? "Unsigned"}</td>
                    <td className="px-4 py-3">{String(row.created_at ?? "").slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setViewingRow(row)}>
                          <Eye className="mr-1 size-4" /> View
                        </Button>
                        <Button variant="outline" size="sm" disabled={Boolean(row.trip_number)} title={row.trip_number ? `Locked while linked to ${row.trip_number}` : "Edit LR"} onClick={() => editLr(row)}>
                          <Pencil className="mr-1 size-4" /> Edit
                        </Button>
                        <Button variant="destructive" size="sm" disabled={Boolean(row.trip_number)} title={row.trip_number ? `Locked while linked to ${row.trip_number}` : "Delete LR"} onClick={() => void deleteLr(row)}>
                          <Trash2 className="mr-1 size-4" /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Dialog open={viewingRow !== null} onOpenChange={(open) => !open && setViewingRow(null)}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Lorry Receipt Details — {viewingRow?.lr_number}</DialogTitle></DialogHeader>
          {viewingRow && (
            <div className="space-y-4 py-2">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="LR Number" value={viewingRow.lr_number} />
                <Field label="Branch" value={branchName(viewingRow.branch_id)} />
                <Field label="Source / Contract" value={viewingRow.source?.contract_name || "—"} />
                <Field label="Created" value={String(viewingRow.created_at ?? "").slice(0, 10)} />
                <Field label="Shipment Count" value={(viewingRow.lorry_receipt_shipments ?? []).length} />
              </div>
              <section className="rounded-xl border border-border p-4">
                <h3 className="mb-3 font-semibold">Attached Shipments</h3>
                <div className="space-y-2 text-sm">
                  {(viewingRow.lorry_receipt_shipments ?? []).map((link: any) => (
                    <div key={link.shipment?.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <strong>{link.shipment?.eway_bill_number}</strong>
                      <span>{link.shipment?.dispatch_from_pin_code || "—"} → {link.shipment?.ship_to_pin_code || "—"}</span>
                    </div>
                  ))}
                </div>
              </section>
              <ShipmentDetails
                shipment={
                  ((viewingRow.lorry_receipt_shipments ?? []).map((x: any) => x.shipment).filter(Boolean)[0] as Shipment | undefined) ?? blankShipment
                }
              />
              <LrTotals
                shipments={(viewingRow.lorry_receipt_shipments ?? []).map((x: any) => x.shipment).filter(Boolean)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LorryReceiptView({
  row,
  branchName,
  onBack,
  onDelete,
}: {
  row: Record<string, any>;
  branchName: (id: string) => string;
  onBack: () => void;
  onDelete: () => void;
}) {
  const shipments = (row.lorry_receipt_shipments ?? [])
    .map((x: any) => x.shipment)
    .filter(Boolean) as Shipment[];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="size-5" /></Button>
        <div><h2 className="text-xl font-semibold">Lorry Receipt Details — {row.lr_number}</h2><p className="text-sm text-muted-foreground">View all LR and attached shipment details.</p></div>
        <Button variant="destructive" disabled={Boolean(row.trip_number)} title={row.trip_number ? `Locked while linked to ${row.trip_number}` : "Delete LR"} onClick={onDelete}><Trash2 className="mr-2 size-4" /> {row.trip_number ? "LR Locked" : "Delete LR"}</Button>
      </div>
      <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-4">
        <Field label="LR Number" value={row.lr_number} />
        <Field label="Branch" value={branchName(row.branch_id)} />
        <Field label="Source / Contract" value={row.source?.contract_name || "—"} />
        <Field label="Created" value={String(row.created_at ?? "").slice(0, 10)} />
        <Field label="Trip" value={row.trip_number || "Not linked"} />
      </div>
      <section className="order-first space-y-3 rounded-xl border border-border p-4">
        <div><h3 className="font-semibold">Attached Shipments</h3><p className="text-xs text-muted-foreground">Shipment number is the E-Way Bill number. Route is shown from PIN to PIN.</p></div>
        {shipments.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">No shipments attached yet.</p> : <div className="space-y-2 text-sm">{shipments.map((s) => <div key={s.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><strong>{s.eway_bill_number}</strong><span>{s.dispatch_from_pin_code || "—"} → {s.ship_to_pin_code || "—"}</span></div>)}</div>}
      </section>
      <ShipmentDetails shipment={shipments[0] ?? blankShipment} />
      <LrTotals shipments={shipments} />
    </div>
  );
}

function CreateAndAddShipment({
  branchId,
  branches,
  onCreated,
  onClose,
}: {
  branchId: string;
  branches: Array<{ id: string; branch_name: string }>;
  onCreated: (shipment: Shipment) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<NewShipmentForm>(() => blankNewShipment(branchId));
  const [item, setItem] = useState<NewShipmentItem>({ description: "", hsn_code: "", quantity: "1", weight_kg: "", unit: "NOS", taxable_value: "", total_invoice_value: "" });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof NewShipmentForm, value: string) => setForm((old) => ({ ...old, [key]: value }));
  async function save() {
    if (!/^[0-9]{12}$/.test(form.eway_bill_number) || !form.branch_id || !form.document_number || !form.document_date || !item.description.trim() || !item.hsn_code.trim()) return toast.error("Enter a valid 12-digit E-Way Bill, document details and one item");
    setSaving(true);
    try {
      const { item_count: _itemCount, created_at: _createdAt, lr_number: _lrNumber, total_taxable_value: _oldTaxable, total_invoice_value: _oldInvoice, ...shipmentFields } = form;
      const payload = { ...shipmentFields, approximate_distance_km: Number(form.approximate_distance_km || 0), total_taxable_value: Number(item.taxable_value || 0), total_invoice_value: Number(item.total_invoice_value || 0), created_by: null };
      const { data: created, error } = await db.from("shipments").insert(payload).select("*").single();
      if (error || !created) throw error ?? new Error("Could not create shipment");
      const { error: itemError } = await db.from("shipment_items").insert({ shipment_id: created.id, item_no: 1, ...item, quantity: Number(item.quantity || 0), weight_kg: Number(item.weight_kg || 0), taxable_value: Number(item.taxable_value || 0), total_invoice_value: Number(item.total_invoice_value || 0), gst_rate: 0, cgst: 0, sgst_utgst: 0, igst: 0, cess: 0, other_tax_charges: 0 });
      if (itemError) { await db.from("shipments").delete().eq("id", created.id); throw itemError; }
      toast.success("Shipment created and added to LR");
      onCreated({ ...created, item_count: 1, lr_number: null, shipment_items: [{ ...item, quantity: Number(item.quantity || 0), weight_kg: Number(item.weight_kg || 0), taxable_value: Number(item.taxable_value || 0), total_invoice_value: Number(item.total_invoice_value || 0) }] } as Shipment);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create shipment"); }
    setSaving(false);
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>Create and Add Shipment</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5"><Label>Branch</Label><Input value={branches.find((b) => b.id === branchId)?.branch_name ?? "—"} readOnly /></div>
            <EntryField label="E-Way Bill Number *" value={form.eway_bill_number} onChange={(v) => set("eway_bill_number", v.replace(/\D/g, "").slice(0, 12))} />
            <EntryField label="E-Way Bill Date *" type="date" value={form.eway_bill_date} onChange={(v) => set("eway_bill_date", v)} />
            <EntryField label="Document Number *" value={form.document_number} onChange={(v) => set("document_number", v)} />
            <EntryField label="Document Date *" type="date" value={form.document_date} onChange={(v) => set("document_date", v)} />
            <EntryField label="Supplier GSTIN" value={form.supplier_gstin} onChange={(v) => set("supplier_gstin", v.toUpperCase())} />
            <EntryField label="Recipient GSTIN" value={form.recipient_gstin} onChange={(v) => set("recipient_gstin", v.toUpperCase())} />
            <EntryField label="Dispatch From PIN" value={form.dispatch_from_pin_code} onChange={(v) => set("dispatch_from_pin_code", v)} />
            <EntryField label="Ship To PIN" value={form.ship_to_pin_code} onChange={(v) => set("ship_to_pin_code", v)} />
            <EntryField label="Transporter ID / GSTIN" value={form.transporter_id} onChange={(v) => set("transporter_id", v.toUpperCase())} />
            <EntryField label="Approximate Distance (KM)" type="number" value={form.approximate_distance_km} onChange={(v) => set("approximate_distance_km", v)} />
          </div>
          <section className="rounded-xl border border-border p-4"><h3 className="mb-3 font-semibold">Supplier / Consignor</h3><div className="grid gap-3 md:grid-cols-3"><EntryField label="Trade Name" value={form.supplier_trade_name} onChange={(v) => set("supplier_trade_name", v)} /><EntryField label="Legal Name" value={form.supplier_legal_name} onChange={(v) => set("supplier_legal_name", v)} /><EntryField label="Address" value={form.supplier_address} onChange={(v) => set("supplier_address", v)} /><EntryField label="Place" value={form.supplier_place} onChange={(v) => set("supplier_place", v)} /><EntryField label="State" value={form.supplier_state} onChange={(v) => set("supplier_state", v)} /></div></section>
          <section className="rounded-xl border border-border p-4"><h3 className="mb-3 font-semibold">Recipient / Consignee</h3><div className="grid gap-3 md:grid-cols-3"><EntryField label="Trade Name" value={form.recipient_trade_name} onChange={(v) => set("recipient_trade_name", v)} /><EntryField label="Legal Name" value={form.recipient_legal_name} onChange={(v) => set("recipient_legal_name", v)} /><EntryField label="Address" value={form.recipient_address} onChange={(v) => set("recipient_address", v)} /><EntryField label="Place" value={form.recipient_place} onChange={(v) => set("recipient_place", v)} /><EntryField label="State" value={form.recipient_state} onChange={(v) => set("recipient_state", v)} /></div></section>
          <section className="rounded-xl border border-border p-4"><h3 className="mb-3 font-semibold">Goods / Invoice Details</h3><div className="grid gap-3 md:grid-cols-2"><EntryField label="Product / Item Description *" value={item.description} onChange={(v) => setItem((old) => ({ ...old, description: v }))} /><EntryField label="HSN Code *" value={item.hsn_code} onChange={(v) => setItem((old) => ({ ...old, hsn_code: v }))} /><EntryField label="Quantity" type="number" value={item.quantity} onChange={(v) => setItem((old) => ({ ...old, quantity: v }))} /><EntryField label="Weight (KG)" type="number" value={item.weight_kg} onChange={(v) => setItem((old) => ({ ...old, weight_kg: v }))} /><EntryField label="Unit" value={item.unit} onChange={(v) => setItem((old) => ({ ...old, unit: v }))} /><EntryField label="Taxable Value" type="number" value={item.taxable_value} onChange={(v) => setItem((old) => ({ ...old, taxable_value: v }))} /><EntryField label="Total Invoice Value" type="number" value={item.total_invoice_value} onChange={(v) => setItem((old) => ({ ...old, total_invoice_value: v }))} /></div><div className="mt-3 flex flex-wrap justify-end gap-5 border-t border-border pt-3 text-sm"><span>Total quantity: <strong>{Number(item.quantity || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</strong></span><span>Total Weight (in kg): <strong>{Number(item.weight_kg || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg</strong></span><span>Taxable total: <strong>₹{Number(item.taxable_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span><span>Invoice total: <strong>₹{Number(item.total_invoice_value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span></div></section>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Create and Add"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LorryReceiptEditForm({
  row,
  branches,
  onCancel,
  onSaved,
}: {
  row: Record<string, any>;
  branches: Array<{ id: string; branch_name: string }>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [sourceId, setSourceId] = useState(String(row.source_id ?? ""));
  const [mode, setMode] = useState<TransportMode>((row.mode ?? "ROAD") as TransportMode);
  const [transporterId, setTransporterId] = useState(String(row.transporter_id ?? ""));
  const [sources, setSources] = useState<Source[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [entries, setEntries] = useState<EntryLite[]>([]);
  const initialSelected = ((row.lorry_receipt_shipments ?? []).map((x: any) => x.shipment).filter(Boolean) as Shipment[]);
  const [selected, setSelected] = useState<Shipment[]>(initialSelected);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [baseId, setBaseId] = useState(String(row.base_shipment_id ?? initialSelected[0]?.id ?? ""));
  const [showPicker, setShowPicker] = useState(false);
  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipmentDate, setShipmentDate] = useState("");
  const [showCreateShipment, setShowCreateShipment] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void (async () => {
      const [s, sh, t, e] = await Promise.all([
        db.from("contracts").select("id,contract_name,branch_id,status").eq("branch_id", row.branch_id).order("contract_name"),
        db.from("shipments").select("*, shipment_items(*)").eq("branch_id", row.branch_id).order("eway_bill_date", { ascending: false }),
        db.from("transporters").select("id,transporter_name").order("transporter_name"),
        db.from("contract_entries").select("*").eq("contract_id", row.source_id),
      ]);
      const { data: links } = await db.from("lr_shipments").select("shipment_id, lr:lorry_receipts(lr_number)");
      const lrByShipment = new Map(((links ?? []) as Array<Record<string, any>>).map((link) => [String(link.shipment_id), link.lr?.lr_number ?? null]));
      setSources((s.data ?? []) as Source[]);
      setTransporters((t.data ?? []) as Transporter[]);
      setEntries((e.data ?? []) as EntryLite[]);
      setShipments(((sh.data ?? []) as Shipment[]).map((shipment) => ({ ...shipment, lr_number: lrByShipment.get(shipment.id) ?? null })));
    })();
  }, [row.branch_id]);
  const base = selected.find((s) => s.id === baseId) ?? selected[0];
  const available = shipments.filter((s) => !selected.some((x) => x.id === s.id) && !s.lr_number && (!shipmentSearch.trim() || s.eway_bill_number.includes(shipmentSearch.trim())) && (!shipmentDate || s.eway_bill_date === shipmentDate));
  function addShipment(shipment: Shipment) {
    if (base && (!same(base.supplier_gstin, shipment.supplier_gstin) || !same(base.recipient_gstin, shipment.recipient_gstin) || !same(base.dispatch_from_pin_code, shipment.dispatch_from_pin_code) || !same(base.ship_to_pin_code, shipment.ship_to_pin_code)))
      return toast.error("This shipment does not match the LR base shipment");
    setSelected((old) => [...old, shipment]);
    setBaseId((old) => old || shipment.id);
    setShowPicker(false);
  }
  function removeShipment(id: string) {
    const next = selected.filter((s) => s.id !== id);
    setSelected(next);
    if (baseId === id) setBaseId(next[0]?.id ?? "");
  }
  async function save() {
    if (row.trip_number) return toast.error(`LR ${row.lr_number} cannot be edited while linked to ${row.trip_number}`);
    if (!base || selected.length === 0) return toast.error("At least one shipment is required");
    setSaving(true);
    try {
      const calculatedIncome = lrIncome(sourceId, mode, selected as any[], entries);
      const { error } = await db.from("lorry_receipts").update({ source_id: sourceId || null, base_shipment_id: base.id, mode, transporter_id: transporterId || null, calculated_income: calculatedIncome }).eq("id", row.id);
      if (error) throw error;
      const { error: deleteError } = await db.from("lr_shipments").delete().eq("lr_id", row.id);
      if (deleteError) throw deleteError;
      const { error: linkError } = await db.from("lr_shipments").insert(selected.map((s) => ({ lr_id: row.id, shipment_id: s.id })));
      if (linkError) throw linkError;
      toast.success("LR updated");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update LR");
    }
    setSaving(false);
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4"><Button variant="ghost" size="icon" onClick={onCancel}><ArrowLeft className="size-5" /></Button><div><h2 className="text-xl font-semibold">Edit Lorry Receipt</h2><p className="text-sm text-muted-foreground">Update LR metadata and assign or unassign shipments.</p></div></div>
      <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-3">
        <Field label="LR Number" value={row.lr_number} />
        <Field label="Branch" value={branches.find((b) => b.id === row.branch_id)?.branch_name ?? "—"} />
        <div className="space-y-1.5"><Label>Source / Contract</Label><Select value={sourceId} onValueChange={setSourceId}><SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger><SelectContent>{sources.filter((s) => s.status !== "inactive").map((s) => <SelectItem key={s.id} value={s.id}>{s.contract_name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="flex flex-col">
      <div className="order-last"><ShipmentDetails shipment={base ?? blankShipment} /></div>
      <div className="order-last"><LrTotals shipments={selected} /></div>
      <section className="order-first space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Attached Shipments</h3><p className="text-xs text-muted-foreground">Shipment number is the E-Way Bill number. Route is shown from PIN to PIN.</p></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setShowPicker((v) => !v)}><Plus className="mr-1 size-4" /> Add Shipment</Button><Button type="button" onClick={() => setShowCreateShipment(true)} disabled={!row.branch_id}><Plus className="mr-1 size-4" /> Create and Add</Button></div></div>
        {selected.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">No shipments attached yet.</p> : <div className="space-y-2 text-sm">{selected.map((s) => <div key={s.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span><strong>{s.eway_bill_number}</strong><span className="ml-3 text-muted-foreground">{s.dispatch_from_pin_code || "—"} → {s.ship_to_pin_code || "—"}</span></span><Button variant="ghost" size="icon" onClick={() => removeShipment(s.id)}><X className="size-4" /></Button></div>)}</div>}
        {showPicker && <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3"><p className="text-sm font-medium">Select compatible shipment</p><div className="flex flex-wrap gap-2"><Input className="flex-1" placeholder="Search shipment number" value={shipmentSearch} onChange={(e) => setShipmentSearch(e.target.value)} /><Input className="w-40" type="date" value={shipmentDate} onChange={(e) => setShipmentDate(e.target.value)} /></div>{available.length === 0 ? <p className="text-sm text-muted-foreground">No unlinked shipments available for this branch.</p> : available.slice(0, 50).map((s) => <button type="button" key={s.id} onClick={() => addShipment(s)} className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:bg-muted"><span><strong>{s.eway_bill_number}</strong><span className="ml-3 text-muted-foreground">{s.dispatch_from_pin_code || "—"} → {s.ship_to_pin_code || "—"}</span></span><Link2 className="size-4 text-primary" /></button>)}</div>}
      </section>
      </div>
      {showCreateShipment && <CreateAndAddShipment branchId={row.branch_id} branches={branches} onClose={() => setShowCreateShipment(false)} onCreated={(shipment) => { addShipment(shipment); setShowCreateShipment(false); }} />}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button></div>
    </div>
  );
}

function LorryReceiptForm({
  branches,
  user,
  onCancel,
  onSaved,
}: {
  branches: Array<{ id: string; branch_name: string; lr_series_prefix?: string | null }>;
  user: any;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [branchId, setBranchId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [mode, setMode] = useState<TransportMode>("ROAD");
  const [transporterId, setTransporterId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [entries, setEntries] = useState<EntryLite[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selected, setSelected] = useState<Shipment[]>([]);
  const [baseId, setBaseId] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipmentDate, setShipmentDate] = useState("");
  const [showCreateShipment, setShowCreateShipment] = useState(false);
  const [saving, setSaving] = useState(false);
  const previewPrefix = String(branches.find((branch) => branch.id === branchId)?.lr_series_prefix ?? "").trim().toUpperCase();
  const previewLrNumber = previewPrefix ? `${previewPrefix}${new Date().getFullYear()}000001` : "Generated after branch prefix is set";
  useEffect(() => {
    if (!branchId) {
      setSources([]);
      setShipments([]);
      return;
    }
    void (async () => {
      const [s, sh, t, e] = await Promise.all([
        db
          .from("contracts")
          .select("id,contract_name,branch_id,status")
          .eq("branch_id", branchId)
          .order("contract_name"),
        db
          .from("shipments")
          .select("*, shipment_items(*)")
          .eq("branch_id", branchId)
          .order("eway_bill_date", { ascending: false }),
        db.from("transporters").select("id,transporter_name").order("transporter_name"),
        db.from("contract_entries").select("*").eq("contract_id", sourceId),
      ]);
      if (s.error || sh.error)
        toast.error(s.error?.message ?? sh.error?.message ?? "Could not load LR options");
      const { data: links } = await db.from("lr_shipments").select("shipment_id, lr:lorry_receipts(lr_number)");
      const lrByShipment = new Map(((links ?? []) as Array<Record<string, any>>).map((link) => [String(link.shipment_id), link.lr?.lr_number ?? null]));
      setSources((s.data ?? []) as Source[]);
      setTransporters((t.data ?? []) as Transporter[]);
      setEntries((e.data ?? []) as EntryLite[]);
      setShipments(((sh.data ?? []) as Shipment[]).map((shipment) => ({ ...shipment, lr_number: lrByShipment.get(shipment.id) ?? null })));
    })();
  }, [branchId]);
  const base = selected.find((s) => s.id === baseId) ?? selected[0];
  const available = shipments.filter((s) =>
    !s.lr_number &&
    !selected.some((x) => x.id === s.id) &&
    (!shipmentSearch.trim() || s.eway_bill_number.includes(shipmentSearch.trim())) &&
    (!shipmentDate || s.eway_bill_date === shipmentDate),
  );
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
    const branch = branches.find((candidate) => candidate.id === branchId);
    const lrPrefix = String(branch?.lr_series_prefix ?? "").trim().toUpperCase();
    if (!branchId || !sourceId || !base || selected.length === 0 || !/^[A-Z0-9]{1,10}$/.test(lrPrefix))
      return toast.error("Branch, source and at least one shipment are required");
    setSaving(true);
    try {
      const { data: generatedNumber, error: numberError } = await db.rpc("next_branch_series_number", {
        p_branch_id: branchId,
        p_document_type: "lr",
        p_prefix: lrPrefix,
        p_series_year: new Date().getFullYear(),
      });
      if (numberError || !generatedNumber) throw numberError ?? new Error("Could not generate LR number");
      const { data: lr, error } = await db
        .from("lorry_receipts")
        .insert({
          branch_id: branchId,
          lr_number: generatedNumber,
          source_id: sourceId,
          base_shipment_id: base.id,
          mode,
          transporter_id: transporterId || null,
          calculated_income: lrIncome(sourceId, mode, selected as any[], entries),
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
        `LR ${generatedNumber} created with ${selected.length} shipment${selected.length === 1 ? "" : "s"}`,
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
          <p className="text-sm text-muted-foreground">Attach one or more compatible shipments to this LR.</p>
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
          <Input value={previewLrNumber} readOnly />
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
        <div className="space-y-1.5"><Label>Transport Mode *</Label><Select value={mode} onValueChange={(value) => setMode(value as TransportMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ROAD">Road</SelectItem><SelectItem value="RAIL">Rail</SelectItem><SelectItem value="AIR">Air</SelectItem><SelectItem value="SHIP">Ship</SelectItem></SelectContent></Select></div>
        <div className="space-y-1.5"><Label>Transporter</Label><Select value={transporterId || "none"} onValueChange={(value) => setTransporterId(value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Select transporter" /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{transporters.map((t) => <SelectItem key={t.id} value={t.id}>{t.transporter_name}</SelectItem>)}</SelectContent></Select></div>
        <Field label="Calculated Income" value={`₹${lrIncome(sourceId, mode, selected as any[], entries).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} />
      </div>
      <div className="flex flex-col">
      <div className="space-y-4 order-last">
        {base && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm">
            <Truck className="size-4 text-primary" />
            <span>
              Base shipment: <strong>{base.eway_bill_number}</strong>. Other shipments must match
              its party GSTINs and route PIN codes.
            </span>
          </div>
        )}
        <ShipmentDetails shipment={base ?? blankShipment} />
      </div>
      <section className="space-y-3 rounded-xl border border-border p-4 order-first">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Attached Shipments</h3>
            <p className="text-xs text-muted-foreground">
              Shipment number is the E-Way Bill number. Route is shown from PIN to PIN.
            </p>
          </div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setShowPicker((v) => !v)} disabled={!branchId}><Plus className="mr-1 size-4" /> Add Shipment</Button><Button type="button" onClick={() => setShowCreateShipment(true)} disabled={!branchId}><Plus className="mr-1 size-4" /> Create and Add</Button></div>
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
        {!base && (
          <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
            Select a shipment to auto-fill LR details.
          </p>
        )}
      </section>
      <LrTotals shipments={selected} />
      </div>
      {showCreateShipment && <CreateAndAddShipment branchId={branchId} branches={branches} onClose={() => setShowCreateShipment(false)} onCreated={(shipment) => { addShipment(shipment); setShowCreateShipment(false); }} />}
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
