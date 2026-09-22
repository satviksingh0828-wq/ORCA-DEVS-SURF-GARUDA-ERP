import { useEffect, useMemo, useState } from "react";
import { Eye, Pencil, Plus, Search, Trash2, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches, type BranchOption } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Item = {
  description: string;
  hsn_code: string;
  quantity: string;
  weight_kg: string;
  unit: string;
  taxable_value: string;
  gst_rate: string;
  cgst: string;
  sgst_utgst: string;
  igst: string;
  cess: string;
  other_tax_charges: string;
  total_invoice_value: string;
};

type Form = {
  branch_id: string;
  eway_bill_number: string;
  eway_bill_date: string;
  eway_bill_status: string;
  valid_from: string;
  valid_until: string;
  supply_type: string;
  sub_type: string;
  document_type: string;
  document_number: string;
  document_date: string;
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
  approximate_distance_km: string;
};

type Shipment = Form & {
  id: string;
  total_taxable_value: number;
  total_invoice_value: number;
  item_count: number;
  created_at: string;
  lr_number?: string | null;
};

const blankItem = (): Item => ({
  description: "",
  hsn_code: "",
  quantity: "",
  weight_kg: "",
  unit: "NOS",
  taxable_value: "",
  gst_rate: "",
  cgst: "",
  sgst_utgst: "",
  igst: "",
  cess: "",
  other_tax_charges: "",
  total_invoice_value: "",
});
const blankForm = (): Form => ({
  branch_id: "",
  eway_bill_number: "",
  eway_bill_date: new Date().toISOString().slice(0, 10),
  eway_bill_status: "Active",
  valid_from: "",
  valid_until: "",
  supply_type: "Outward",
  sub_type: "Supply",
  document_type: "Tax Invoice",
  document_number: "",
  document_date: new Date().toISOString().slice(0, 10),
  supplier_gstin: "URP",
  supplier_trade_name: "",
  supplier_legal_name: "",
  supplier_address: "",
  supplier_place: "",
  supplier_state: "",
  supplier_pin_code: "",
  recipient_gstin: "URP",
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
  approximate_distance_km: "",
});
const n = (v: string) => Number(v || 0) || 0;
const money = (v: number) =>
  `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Field({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  placeholder,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && " *"}
      </Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function PartySection({
  title,
  prefix,
  form,
  setForm,
  readOnly = false,
}: {
  title: string;
  prefix: "supplier" | "recipient" | "dispatch_from" | "ship_to";
  form: Form;
  setForm: (f: Form) => void;
  readOnly?: boolean;
}) {
  const get = (key: string) => form[`${prefix}_${key}` as keyof Form] as string;
  const set = (key: string, value: string) => setForm({ ...form, [`${prefix}_${key}`]: value });
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(prefix === "supplier" || prefix === "recipient") && (
          <Field
            label="GSTIN"
            value={get("gstin")}
            onChange={(v) => set("gstin", v.toUpperCase())}
            readOnly={readOnly}
            placeholder="GSTIN or URP"
          />
        )}
        {(prefix === "supplier" || prefix === "recipient") && (
          <Field
            label="Trade Name"
            value={get("trade_name")}
            onChange={(v) => set("trade_name", v)}
            readOnly={readOnly}
          />
        )}
        {(prefix === "supplier" || prefix === "recipient") && (
          <Field
            label="Legal Name"
            value={get("legal_name")}
            onChange={(v) => set("legal_name", v)}
            readOnly={readOnly}
          />
        )}
        <div className="md:col-span-2">
          <Field label="Address" value={get("address")} onChange={(v) => set("address", v)} readOnly={readOnly} />
        </div>
        <Field label="Place" value={get("place")} onChange={(v) => set("place", v)} readOnly={readOnly} />
        <Field label="State" value={get("state")} onChange={(v) => set("state", v)} readOnly={readOnly} />
        <Field label="PIN Code" value={get("pin_code")} onChange={(v) => set("pin_code", v)} readOnly={readOnly} />
      </div>
    </section>
  );
}

function ShipmentView({
  shipment,
  items,
  branchName,
  onBack,
}: {
  shipment: Shipment;
  items: Item[];
  branchName: (id: string) => string;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <button type="button" className="mb-2 text-sm text-muted-foreground hover:text-foreground" onClick={onBack}>← Back to Shipments</button>
          <h2 className="text-xl font-semibold">Shipment Details — {shipment.eway_bill_number}</h2>
          <p className="text-sm text-muted-foreground">{shipment.lr_number ? `Assigned to LR ${shipment.lr_number}` : "Not assigned to an LR"}</p>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-3">
        <Field label="E-Way Bill Number" value={shipment.eway_bill_number} onChange={() => {}} readOnly />
        <Field label="E-Way Bill Date" value={shipment.eway_bill_date} onChange={() => {}} readOnly />
        <Field label="Status" value={shipment.eway_bill_status} onChange={() => {}} readOnly />
        <Field label="Document" value={`${shipment.document_type} · ${shipment.document_number}`} onChange={() => {}} readOnly />
        <Field label="Branch" value={branchName(shipment.branch_id)} onChange={() => {}} readOnly />
        <Field label="LR Number" value={shipment.lr_number || "Not assigned"} onChange={() => {}} readOnly />
      </div>
      <PartySection title="Supplier / Consignor" prefix="supplier" form={shipment} setForm={() => {}} readOnly />
      <PartySection title="Recipient / Consignee" prefix="recipient" form={shipment} setForm={() => {}} readOnly />
      <PartySection title="Dispatch From" prefix="dispatch_from" form={shipment} setForm={() => {}} readOnly />
      <PartySection title="Ship To" prefix="ship_to" form={shipment} setForm={() => {}} readOnly />
      <div className="rounded-xl border border-border p-4">
        <h3 className="mb-3 font-semibold">Goods / Invoice Details</h3>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="px-2 py-2">Item</th><th className="px-2 py-2">HSN</th><th className="px-2 py-2">Quantity</th><th className="px-2 py-2">Weight (KG)</th><th className="px-2 py-2 text-right">Value</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${item.description}-${index}`} className="border-t border-border"><td className="px-2 py-2">{item.description}</td><td className="px-2 py-2">{item.hsn_code}</td><td className="px-2 py-2">{item.quantity} {item.unit}</td><td className="px-2 py-2">{n(item.weight_kg).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg</td><td className="px-2 py-2 text-right">{money(n(item.total_invoice_value))}</td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap justify-end gap-5 border-t border-border pt-3 text-sm">
          <span>Taxable total: <strong>{money(items.reduce((sum, item) => sum + n(item.taxable_value), 0))}</strong></span>
          <span>Invoice total: <strong>{money(items.reduce((sum, item) => sum + n(item.total_invoice_value), 0))}</strong></span>
          <span>Total quantity: <strong>{items.reduce((sum, item) => sum + n(item.quantity), 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</strong></span>
          <span>Total Weight (in kg): <strong>{items.reduce((sum, item) => sum + n(item.weight_kg), 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg</strong></span>
        </div>
      </div>
    </div>
  );
}

export function ShipmentList() {
  const { user } = useSession();
  const branches = useBranches();
  const isBasic = user?.role === "basic";
  const allowed = useMemo(
    () => (isBasic ? (user?.branchIds ?? []) : null),
    [isBasic, user?.branchIds],
  );
  // The generated Supabase types do not yet include the new shipment tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
  const [viewingShipment, setViewingShipment] = useState<Shipment | null>(null);
  const [viewingItems, setViewingItems] = useState<Item[]>([]);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(blankForm());
  const [items, setItems] = useState<Item[]>([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [branchFilter, setBranchFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const [assignment, setAssignment] = useState("all");

  const visibleBranches = useMemo(
    () => (allowed === null ? branches : branches.filter((b) => allowed.includes(b.id))),
    [allowed, branches],
  );
  const branchName = (id: string) => branches.find((b) => b.id === id)?.branch_name ?? "—";

  async function load() {
    setLoading(true);
    try {
      let q = db
        .from("shipments")
        .select("*, shipment_items(count)")
        .order("eway_bill_date", { ascending: false });
      if (allowed !== null)
        q = q.in("branch_id", allowed.length ? allowed : ["00000000-0000-0000-0000-000000000000"]);
      const { data, error } = await q;
      if (error) throw error;
      const { data: linkedRows } = await db
        .from("lr_shipments")
        .select("shipment_id, lorry_receipt:lorry_receipts(lr_number)");
      const lrByShipment = new Map(
        ((linkedRows ?? []) as Array<Record<string, unknown>>).map((row) => [
          String(row.shipment_id),
          (row.lorry_receipt as { lr_number?: string } | null)?.lr_number ?? null,
        ]),
      );
      setShipments(
        ((data ?? []) as Array<Record<string, unknown>>).map(
          (row) =>
            ({
              ...row,
              lr_number: lrByShipment.get(String(row.id)) ?? null,
              item_count: Number(
                (row.shipment_items as Array<{ count?: number }> | undefined)?.[0]?.count ?? 0,
              ),
            }) as Shipment,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load shipments");
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
    // The loader intentionally captures the current branch scope and database client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, branches.length]);

  const filtered = shipments.filter((s) => {
    if (branchFilter !== "all" && s.branch_id !== branchFilter) return false;
    if (monthFilter !== "all" && !s.eway_bill_date.startsWith(monthFilter)) return false;
    if (assignment !== "all" && (assignment === "assigned") !== Boolean(s.lr_number)) return false;
    return !search.trim() || s.eway_bill_number.includes(search.trim());
  });

  function openCreate() {
    const f = blankForm();
    f.branch_id = visibleBranches.length === 1 ? visibleBranches[0].id : "";
    setForm(f);
    setItems([blankItem()]);
    setShowCreate(true);
    setEditingShipmentId(null);
  }
  async function openEdit(shipment: Shipment) {
    if (shipment.lr_number) {
      toast.error("This shipment is already assigned to an LR and is read-only");
      return;
    }
    const { data, error } = await db
      .from("shipment_items")
      .select("*")
      .eq("shipment_id", shipment.id)
      .order("item_no");
    if (error) return toast.error(error.message);
    setForm(
      Object.fromEntries(
        Object.keys(blankForm()).map((key) => [key, String((shipment as Record<string, unknown>)[key] ?? "")]),
      ) as Form,
    );
    setItems(
      ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
        description: String(item.description ?? ""),
        hsn_code: String(item.hsn_code ?? ""),
        quantity: String(item.quantity ?? ""),
        weight_kg: String(item.weight_kg ?? ""),
        unit: String(item.unit ?? "NOS"),
        taxable_value: String(item.taxable_value ?? ""),
        gst_rate: String(item.gst_rate ?? ""),
        cgst: String(item.cgst ?? ""),
        sgst_utgst: String(item.sgst_utgst ?? ""),
        igst: String(item.igst ?? ""),
        cess: String(item.cess ?? ""),
        other_tax_charges: String(item.other_tax_charges ?? ""),
        total_invoice_value: String(item.total_invoice_value ?? ""),
      })),
    );
    setSelectedItemIndex(null);
    setEditingShipmentId(shipment.id);
    setShowCreate(true);
  }
  async function openView(shipment: Shipment) {
    const { data } = await db
      .from("shipment_items")
      .select("*")
      .eq("shipment_id", shipment.id)
      .order("item_no");
    setViewingItems(
      ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
        description: String(item.description ?? ""),
        hsn_code: String(item.hsn_code ?? ""),
        quantity: String(item.quantity ?? ""),
        weight_kg: String(item.weight_kg ?? ""),
        unit: String(item.unit ?? "NOS"),
        taxable_value: String(item.taxable_value ?? ""),
        gst_rate: String(item.gst_rate ?? ""),
        cgst: String(item.cgst ?? ""),
        sgst_utgst: String(item.sgst_utgst ?? ""),
        igst: String(item.igst ?? ""),
        cess: String(item.cess ?? ""),
        other_tax_charges: String(item.other_tax_charges ?? ""),
        total_invoice_value: String(item.total_invoice_value ?? ""),
      })),
    );
    setViewingShipment(shipment);
  }
  async function deleteShipment(shipment: Shipment) {
    if (shipment.lr_number) {
      toast.error("A shipment assigned to an LR cannot be deleted");
      return;
    }
    if (!window.confirm(`Delete shipment ${shipment.eway_bill_number}? This cannot be undone.`)) return;
    const { error } = await db.from("shipments").delete().eq("id", shipment.id);
    if (error) return toast.error(error.message);
    toast.success(`Shipment ${shipment.eway_bill_number} deleted`);
    await load();
  }

  if (viewingShipment)
    return <ShipmentView shipment={viewingShipment} items={viewingItems} branchName={branchName} onBack={() => setViewingShipment(null)} />;
  const setItem = (index: number, key: keyof Item, value: string) =>
    setItems(items.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  const totalTaxable = items.reduce((sum, item) => sum + n(item.taxable_value), 0);
  const totalInvoice = items.reduce((sum, item) => sum + n(item.total_invoice_value), 0);
  const totalQuantity = items.reduce((sum, item) => sum + n(item.quantity), 0);
  const totalWeight = items.reduce((sum, item) => sum + n(item.weight_kg), 0);
  const selectedItem = selectedItemIndex === null ? null : (items[selectedItemIndex] ?? null);

  async function save() {
    if (!/^[0-9]{12}$/.test(form.eway_bill_number))
      return toast.error("E-Way Bill Number must contain exactly 12 digits");
    if (!form.branch_id || !form.eway_bill_date || !form.document_number || !form.document_date)
      return toast.error("Branch, E-Way Bill date, document number and document date are required");
    if (items.some((item) => !item.description.trim() || !item.hsn_code.trim()))
      return toast.error("Each item needs a description and HSN code");
    if (!visibleBranches.some((b) => b.id === form.branch_id))
      return toast.error("Select a permitted branch");
    setSaving(true);
    try {
      const payload = {
        ...form,
        approximate_distance_km: n(form.approximate_distance_km),
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        total_taxable_value: totalTaxable,
        total_invoice_value: totalInvoice,
        created_by: user?.id ?? null,
      };
      const { data: shipment, error } = editingShipmentId
        ? await db.from("shipments").update(payload).eq("id", editingShipmentId).select("id").single()
        : await db.from("shipments").insert(payload).select("id").single();
      if (error || !shipment) throw error ?? new Error("Could not create shipment");
      if (editingShipmentId) {
        const { error: deleteError } = await db.from("shipment_items").delete().eq("shipment_id", editingShipmentId);
        if (deleteError) throw deleteError;
      }
      const { error: itemError } = await db.from("shipment_items").insert(
        items.map((item, index) => ({
          ...item,
          shipment_id: shipment.id,
          item_no: index + 1,
          quantity: n(item.quantity),
          weight_kg: n(item.weight_kg),
          taxable_value: n(item.taxable_value),
          gst_rate: n(item.gst_rate),
          cgst: n(item.cgst),
          sgst_utgst: n(item.sgst_utgst),
          igst: n(item.igst),
          cess: n(item.cess),
          other_tax_charges: n(item.other_tax_charges),
          total_invoice_value: n(item.total_invoice_value),
        })),
      );
      if (itemError) {
        await db.from("shipments").delete().eq("id", shipment.id);
        throw itemError;
      }
      toast.success(editingShipmentId ? "Shipment updated" : "Shipment created from E-Way Bill");
      setShowCreate(false);
      setEditingShipmentId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create shipment");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      {!showCreate && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
        <h2 className="text-lg font-semibold">Shipments</h2>
              <p className="text-sm text-muted-foreground">
                One shipment is one E-Way Bill. Part A details are stored with nested goods items.
              </p>
            </div>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="size-4" /> Create Shipment
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 p-3">
            <div className="min-w-[190px] space-y-1.5">
              <Label>Branch</Label>
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger>
                  <SelectValue />
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
            </div>
            <div className="space-y-1.5">
              <Label>E-Way Bill month</Label>
              <Input
                type="month"
                value={monthFilter === "all" ? "" : monthFilter}
                onChange={(e) => setMonthFilter(e.target.value || "all")}
              />
            </div>
            <div className="min-w-[230px] flex-1 space-y-1.5">
              <Label>Search E-Way Bill / Shipment Number</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value.replace(/\D/g, ""))}
                  placeholder="12-digit number"
                />
              </div>
            </div>
          </div>
          {loading ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              Loading shipments…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              <Truck className="mx-auto mb-2 size-8 opacity-40" />
              No shipments found.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Shipment / E-Way Bill No.</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">E-Way Bill Date</th>
                    <th className="px-4 py-3">Supply</th>
                    <th className="px-4 py-3">Document</th>
                    <th className="px-4 py-3 text-right">Items</th>
                    <th className="px-4 py-3 text-right">Invoice Value</th>
                    <th className="px-4 py-3">LR Number</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{s.eway_bill_number}</td>
                      <td className="px-4 py-3">{branchName(s.branch_id)}</td>
                      <td className="px-4 py-3">{s.eway_bill_date}</td>
                      <td className="px-4 py-3">
                        {s.supply_type} · {s.sub_type}
                      </td>
                      <td className="px-4 py-3">
                        {s.document_type} · {s.document_number}
                      </td>
                      <td className="px-4 py-3 text-right">{s.item_count}</td>
                      <td className="px-4 py-3 text-right">
                        {money(Number(s.total_invoice_value))}
                      </td>
                      <td className="px-4 py-3">{s.lr_number || "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{s.eway_bill_status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => void openView(s)}>
                            <Eye className="mr-1 size-4" /> View
                          </Button>
                          {!s.lr_number && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => void openEdit(s)}>
                                <Pencil className="mr-1 size-4" /> Edit
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => void deleteShipment(s)} title="Delete shipment">
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {showCreate ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div>
              <button
                type="button"
                className="mb-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowCreate(false);
                  setEditingShipmentId(null);
                }}
              >
                ← Back to Shipments
              </button>
              <h2 className="text-xl font-semibold">
                {editingShipmentId ? "Edit Shipment — Part A" : "Create Shipment from E-Way Bill — Part A"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Create one shipment for one E-Way Bill.
              </p>
            </div>
          </div>
          <div className="space-y-5 py-2">
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="font-semibold">E-Way Bill Basic Details</h3>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Branch *</Label>
                  <Select
                    value={form.branch_id}
                    onValueChange={(v) => setForm({ ...form, branch_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleBranches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.branch_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field
                  label="E-Way Bill Number *"
                  value={form.eway_bill_number}
                  onChange={(v) =>
                    setForm({ ...form, eway_bill_number: v.replace(/\D/g, "").slice(0, 12) })
                  }
                  placeholder="12 digits"
                />
                <Field
                  label="E-Way Bill Date *"
                  type="date"
                  value={form.eway_bill_date}
                  onChange={(v) => setForm({ ...form, eway_bill_date: v })}
                />
                <div className="space-y-1.5">
                  <Label>E-Way Bill Status</Label>
                  <Select
                    value={form.eway_bill_status}
                    onValueChange={(v) => setForm({ ...form, eway_bill_status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["Active", "Cancelled", "Expired", "Part-B Pending"].map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field
                  label="Valid From"
                  type="datetime-local"
                  value={form.valid_from}
                  onChange={(v) => setForm({ ...form, valid_from: v })}
                />
                <Field
                  label="Valid Until"
                  type="datetime-local"
                  value={form.valid_until}
                  onChange={(v) => setForm({ ...form, valid_until: v })}
                />
                <div className="space-y-1.5">
                  <Label>Supply Type</Label>
                  <Select
                    value={form.supply_type}
                    onValueChange={(v) => setForm({ ...form, supply_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Outward">Outward</SelectItem>
                      <SelectItem value="Inward">Inward</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field
                  label="Sub-type"
                  value={form.sub_type}
                  onChange={(v) => setForm({ ...form, sub_type: v })}
                />
              </div>
            </section>
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Document Details</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Document Type *</Label>
                  <Select
                    value={form.document_type}
                    onValueChange={(v) => setForm({ ...form, document_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "Tax Invoice",
                        "Bill of Supply",
                        "Bill of Entry",
                        "Delivery Challan",
                        "Others",
                      ].map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field
                  label="Document Number *"
                  value={form.document_number}
                  onChange={(v) => setForm({ ...form, document_number: v })}
                />
                <Field
                  label="Document Date *"
                  type="date"
                  value={form.document_date}
                  onChange={(v) => setForm({ ...form, document_date: v })}
                />
              </div>
            </section>
            <PartySection
              title="Supplier / Consignor (Bill From)"
              prefix="supplier"
              form={form}
              setForm={setForm}
            />
            <PartySection
              title="Recipient / Consignee (Bill To)"
              prefix="recipient"
              form={form}
              setForm={setForm}
            />
            <PartySection
              title="Dispatch From"
              prefix="dispatch_from"
              form={form}
              setForm={setForm}
            />
            <PartySection title="Ship To" prefix="ship_to" form={form} setForm={setForm} />
            <section className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="font-semibold">Transport Details</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Transporter ID / GSTIN"
                  value={form.transporter_id}
                  onChange={(v) => setForm({ ...form, transporter_id: v.toUpperCase() })}
                />
                <Field
                  label="Approximate Distance (KM)"
                  type="number"
                  value={form.approximate_distance_km}
                  onChange={(v) => setForm({ ...form, approximate_distance_km: v })}
                />
              </div>
            </section>
            <section className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Goods / Invoice Details</h3>
                  <p className="text-xs text-muted-foreground">
                    At least one item is required. HSN is required for every item.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setItems([...items, blankItem()]);
                    setSelectedItemIndex(items.length);
                  }}
                >
                  <Plus className="mr-1 size-3.5" /> Add Item
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Item Name</th>
                      <th className="px-3 py-2">HSN Code</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2 text-right">Weight (KG)</th>
                      <th className="px-3 py-2 text-right">Total Value</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={index} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">
                          {item.description || `Item ${index + 1}`}
                        </td>
                        <td className="px-3 py-2">{item.hsn_code || "—"}</td>
                        <td className="px-3 py-2 text-right">{n(item.quantity)} {item.unit}</td>
                        <td className="px-3 py-2 text-right">{n(item.weight_kg).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                        <td className="px-3 py-2 text-right">
                          {money(n(item.total_invoice_value))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedItemIndex(index)}
                          >
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-end gap-5 border-t border-border pt-3 text-sm">
                <span>
                  Taxable total: <strong>{money(totalTaxable)}</strong>
                </span>
                <span>
                  Invoice total: <strong>{money(totalInvoice)}</strong>
                </span>
                <span>
                  Total quantity: <strong>{totalQuantity.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</strong>
                </span>
                <span>
                  Total Weight (in kg): <strong>{totalWeight.toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg</strong>
                </span>
              </div>
            </section>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                setEditingShipmentId(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : editingShipmentId ? "Save Changes" : "Create Shipment"}
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog
        open={selectedItemIndex !== null}
        onOpenChange={(open) => !open && setSelectedItemIndex(null)}
      >
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedItemIndex === null ? "Item" : `Goods Item ${selectedItemIndex + 1}`}
            </DialogTitle>
          </DialogHeader>
          {selectedItem && selectedItemIndex !== null && (
            <div className="grid gap-3 py-2 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field
                  label="Product / Item Description *"
                  value={selectedItem.description}
                  onChange={(v) => setItem(selectedItemIndex, "description", v)}
                />
              </div>
              <Field
                label="HSN Code *"
                value={selectedItem.hsn_code}
                onChange={(v) => setItem(selectedItemIndex, "hsn_code", v)}
              />
              <Field
                label="Quantity"
                type="number"
                value={selectedItem.quantity}
                onChange={(v) => setItem(selectedItemIndex, "quantity", v)}
              />
              <Field
                label="Weight (KG)"
                type="number"
                value={selectedItem.weight_kg}
                onChange={(v) => setItem(selectedItemIndex, "weight_kg", v)}
              />
              <Field
                label="Unit"
                value={selectedItem.unit}
                onChange={(v) => setItem(selectedItemIndex, "unit", v)}
              />
              <Field
                label="Taxable Value"
                type="number"
                value={selectedItem.taxable_value}
                onChange={(v) => setItem(selectedItemIndex, "taxable_value", v)}
              />
              <Field
                label="GST Rate %"
                type="number"
                value={selectedItem.gst_rate}
                onChange={(v) => setItem(selectedItemIndex, "gst_rate", v)}
              />
              <Field
                label="CGST"
                type="number"
                value={selectedItem.cgst}
                onChange={(v) => setItem(selectedItemIndex, "cgst", v)}
              />
              <Field
                label="SGST / UTGST"
                type="number"
                value={selectedItem.sgst_utgst}
                onChange={(v) => setItem(selectedItemIndex, "sgst_utgst", v)}
              />
              <Field
                label="IGST"
                type="number"
                value={selectedItem.igst}
                onChange={(v) => setItem(selectedItemIndex, "igst", v)}
              />
              <Field
                label="Cess"
                type="number"
                value={selectedItem.cess}
                onChange={(v) => setItem(selectedItemIndex, "cess", v)}
              />
              <Field
                label="Other Tax / Charges"
                type="number"
                value={selectedItem.other_tax_charges}
                onChange={(v) => setItem(selectedItemIndex, "other_tax_charges", v)}
              />
              <Field
                label="Total Invoice Value"
                type="number"
                value={selectedItem.total_invoice_value}
                onChange={(v) => setItem(selectedItemIndex, "total_invoice_value", v)}
              />
            </div>
          )}
          <DialogFooter>
            {items.length > 1 && selectedItemIndex !== null && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setItems(items.filter((_, i) => i !== selectedItemIndex));
                  setSelectedItemIndex(null);
                }}
              >
                Remove Item
              </Button>
            )}
            <Button type="button" onClick={() => setSelectedItemIndex(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={viewingShipment !== null} onOpenChange={(open) => !open && setViewingShipment(null)}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Shipment Details — {viewingShipment?.eway_bill_number}
              {viewingShipment?.lr_number ? ` (LR ${viewingShipment.lr_number})` : ""}
            </DialogTitle>
          </DialogHeader>
          {viewingShipment && (
            <div className="space-y-4 py-2">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="E-Way Bill Number" value={viewingShipment.eway_bill_number} onChange={() => {}} />
                <Field label="E-Way Bill Date" value={viewingShipment.eway_bill_date} onChange={() => {}} />
                <Field label="Status" value={viewingShipment.eway_bill_status} onChange={() => {}} />
                <Field label="Document" value={`${viewingShipment.document_type} · ${viewingShipment.document_number}`} onChange={() => {}} />
                <Field label="Branch" value={branchName(viewingShipment.branch_id)} onChange={() => {}} />
                <Field label="LR Number" value={viewingShipment.lr_number || "Not assigned"} onChange={() => {}} />
              </div>
              <PartySection title="Supplier / Consignor" prefix="supplier" form={viewingShipment} setForm={() => {}} readOnly />
              <PartySection title="Recipient / Consignee" prefix="recipient" form={viewingShipment} setForm={() => {}} readOnly />
              <PartySection title="Dispatch From" prefix="dispatch_from" form={viewingShipment} setForm={() => {}} readOnly />
              <PartySection title="Ship To" prefix="ship_to" form={viewingShipment} setForm={() => {}} readOnly />
              <div className="rounded-xl border border-border p-4">
                <h3 className="mb-3 font-semibold">Goods / Invoice Details</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-2 py-2">Item</th><th className="px-2 py-2">HSN</th><th className="px-2 py-2">Quantity</th><th className="px-2 py-2 text-right">Value</th></tr></thead>
                    <tbody>{viewingItems.map((item, index) => <tr key={`${item.description}-${index}`} className="border-t border-border"><td className="px-2 py-2">{item.description}</td><td className="px-2 py-2">{item.hsn_code}</td><td className="px-2 py-2">{item.quantity} {item.unit}</td><td className="px-2 py-2 text-right">{money(n(item.total_invoice_value))}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
