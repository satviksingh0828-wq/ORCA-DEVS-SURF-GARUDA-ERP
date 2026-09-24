import { useEffect, useMemo, useState } from "react";
import { Eye, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { serverFetchEwayBillDetails } from "@/lib/ewaybill-details";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Item = Record<string, string>;
type ShipmentDraft = {
  eway_bill_number: string;
  eway_bill_date: string;
  eway_bill_status: string;
  valid_from: string;
  valid_until: string;
  supply_type: string;
  sub_type: string;
  sub_supply_desc: string;
  document_type: string;
  document_number: string;
  document_date: string;
  supplier_gstin: string;
  supplier_trade_name: string;
  supplier_legal_name: string;
  supplier_address: string;
  supplier_address_line_1: string;
  supplier_address_line_2: string;
  supplier_place: string;
  supplier_state: string;
  supplier_pin_code: string;
  recipient_gstin: string;
  recipient_trade_name: string;
  recipient_legal_name: string;
  recipient_address: string;
  recipient_address_line_1: string;
  recipient_address_line_2: string;
  recipient_place: string;
  recipient_state: string;
  recipient_pin_code: string;
  dispatch_from_address: string;
  dispatch_from_address_line_1: string;
  dispatch_from_address_line_2: string;
  dispatch_from_place: string;
  dispatch_from_state: string;
  dispatch_from_pin_code: string;
  ship_to_address: string;
  ship_to_address_line_1: string;
  ship_to_address_line_2: string;
  ship_to_place: string;
  ship_to_state: string;
  ship_to_pin_code: string;
  transporter_id: string;
  approximate_distance_km: string;
  transaction_type: string;
  generation_mode: string;
  total_value: string;
  cgst_value: string;
  sgst_value: string;
  igst_value: string;
  cess_value: string;
  cess_non_advol_value: string;
  other_value: string;
  total_taxable_value: string;
  total_invoice_value: string;
  items: Item[];
};
type Master = { id: string; label: string; extra?: string };
type RecordRow = Record<string, any>;

const text = (source: Record<string, unknown>, key: string) => String(source[key] ?? "");
const num = (value: string | number | null | undefined) => Number(value || 0);
const dateValue = (value: unknown) => {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) { const [d, m, y] = raw.split("/"); return `${y}-${m}-${d}`; }
  return raw.slice(0, 10);
};
const emptyItem = (): Item => ({ product_name: "", description: "", hsn_code: "", quantity: "", weight_kg: "", unit: "NOS", taxable_value: "", cgst_rate: "", sgst_rate: "", igst_rate: "", cess_rate: "", cess_nonadvol: "", gst_rate: "", cgst: "", sgst_utgst: "", igst: "", cess: "", other_tax_charges: "", total_invoice_value: "" });

function mapEway(raw: unknown): ShipmentDraft {
  const source = (((raw as Record<string, unknown>)?.data ?? raw) as Record<string, unknown>);
  const from1 = text(source, "fromAddr1"); const from2 = text(source, "fromAddr2");
  const to1 = text(source, "toAddr1"); const to2 = text(source, "toAddr2");
  const ship1 = text(source, "shipToAddr1") || to1; const ship2 = text(source, "shipToAddr2") || to2;
  const itemList = Array.isArray(source.itemList) ? source.itemList as Array<Record<string, unknown>> : [];
  return {
    eway_bill_number: text(source, "ewbNo"), eway_bill_date: dateValue(source.ewayBillDate || source.ewayBillDateStr), eway_bill_status: text(source, "status") || "Active",
    valid_from: text(source, "validFrom"), valid_until: text(source, "validUpto"), supply_type: text(source, "supplyType") || "Outward", sub_type: text(source, "subSupplyType") || text(source, "subType") || "Supply", sub_supply_desc: text(source, "subSupplyDesc"), document_type: text(source, "docType") || "Tax Invoice", document_number: text(source, "docNo"), document_date: dateValue(source.docDate),
    supplier_gstin: text(source, "fromGstin") || "URP", supplier_trade_name: text(source, "fromTrdName"), supplier_legal_name: text(source, "fromTrdName"), supplier_address: [from1, from2].filter(Boolean).join(", "), supplier_address_line_1: from1, supplier_address_line_2: from2, supplier_place: text(source, "fromPlace"), supplier_state: text(source, "fromStateCode"), supplier_pin_code: text(source, "fromPincode"),
    recipient_gstin: text(source, "toGstin") || "URP", recipient_trade_name: text(source, "toTrdName"), recipient_legal_name: text(source, "toTrdName"), recipient_address: [to1, to2].filter(Boolean).join(", "), recipient_address_line_1: to1, recipient_address_line_2: to2, recipient_place: text(source, "toPlace"), recipient_state: text(source, "toStateCode"), recipient_pin_code: text(source, "toPincode"),
    dispatch_from_address: [from1, from2].filter(Boolean).join(", "), dispatch_from_address_line_1: from1, dispatch_from_address_line_2: from2, dispatch_from_place: text(source, "fromPlace"), dispatch_from_state: text(source, "fromStateCode"), dispatch_from_pin_code: text(source, "fromPincode"), ship_to_address: [ship1, ship2].filter(Boolean).join(", "), ship_to_address_line_1: ship1, ship_to_address_line_2: ship2, ship_to_place: text(source, "shipToPlace") || text(source, "toPlace"), ship_to_state: text(source, "toStateCode"), ship_to_pin_code: text(source, "shipToPincode") || text(source, "toPincode"),
    transporter_id: text(source, "transporterId"), approximate_distance_km: text(source, "transDistance"), transaction_type: text(source, "transactionType"), generation_mode: text(source, "genMode"), total_value: text(source, "totalValue"), cgst_value: text(source, "cgstValue"), sgst_value: text(source, "sgstValue"), igst_value: text(source, "igstValue"), cess_value: text(source, "cessValue"), cess_non_advol_value: text(source, "cessNonAdvolValue"), other_value: text(source, "otherValue"), total_taxable_value: text(source, "totalValue"), total_invoice_value: text(source, "totInvValue"),
    items: itemList.map((item) => ({ product_name: text(item, "productName"), description: text(item, "productDesc") || text(item, "productName"), hsn_code: text(item, "hsnCode"), quantity: text(item, "quantity"), weight_kg: text(item, "quantity"), unit: text(item, "qtyUnit") || "NOS", taxable_value: text(item, "taxableAmount"), cgst_rate: text(item, "cgstRate"), sgst_rate: text(item, "sgstRate"), igst_rate: text(item, "igstRate"), cess_rate: text(item, "cessRate"), cess_nonadvol: text(item, "cessNonadvol"), gst_rate: String(num(item.cgstRate as string) + num(item.sgstRate as string) + num(item.igstRate as string)), cgst: text(item, "cgstValue"), sgst_utgst: text(item, "sgstValue"), igst: text(item, "igstValue"), cess: text(item, "cessValue"), other_tax_charges: text(item, "cessNonadvol"), total_invoice_value: text(item, "taxableAmount") })),
  };
}

function ReadonlyField({ label, value }: { label: string; value: unknown }) { return <div><Label>{label}</Label><div className="mt-1 min-h-9 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">{String(value || "—")}</div></div>; }

export function ConsignmentList() {
  const branches = useBranches(); const { user } = useSession();
  const [rows, setRows] = useState<RecordRow[]>([]); const [loading, setLoading] = useState(false); const [screen, setScreen] = useState<"list" | "create" | "view">("list");
  const [view, setView] = useState<RecordRow | null>(null); const [viewShipments, setViewShipments] = useState<RecordRow[]>([]);
  const [branchFilter, setBranchFilter] = useState("all"); const [typeFilter, setTypeFilter] = useState("all"); const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState(""); const [sourceId, setSourceId] = useState(""); const [type, setType] = useState("own"); const [movement, setMovement] = useState("pickup"); const [transportMode, setTransportMode] = useState("Road");
  const [vehicleId, setVehicleId] = useState(""); const [driverId, setDriverId] = useState(""); const [transporterId, setTransporterId] = useState(""); const [fromPin, setFromPin] = useState(""); const [toPin, setToPin] = useState(""); const [ewayNo, setEwayNo] = useState(""); const [fetching, setFetching] = useState(false); const [drafts, setDrafts] = useState<ShipmentDraft[]>([]);
  const [contracts, setContracts] = useState<Master[]>([]); const [vehicles, setVehicles] = useState<Master[]>([]); const [drivers, setDrivers] = useState<Master[]>([]); const [transporters, setTransporters] = useState<RecordRow[]>([]); const [newTransporter, setNewTransporter] = useState({ name: "", gstin: "", pin: "" });
  const branch = branches.find((item) => item.id === branchId); const first = drafts[0]; const selectedTransporter = transporters.find((item) => item.id === transporterId);

  async function load() { setLoading(true); const { data, error } = await supabase.from("consignments").select("*, branch:branches(branch_name), transporter:ltms_transporters(transporter_name)").order("created_at", { ascending: false }); if (error) toast.error(error.message); setRows((data ?? []) as RecordRow[]); setLoading(false); }
  useEffect(() => { void load(); }, []);
  async function loadMasters() {
    const [c, v, d, t] = await Promise.all([supabase.from("contracts").select("id,contract_name").eq("status", "active").order("contract_name"), supabase.from("vehicles").select("id,registration_number").order("registration_number"), supabase.from("drivers").select("id,full_name").order("full_name"), supabase.from("ltms_transporters").select("*").order("transporter_name")]);
    setContracts((c.data ?? []).map((x: any) => ({ id: x.id, label: x.contract_name }))); setVehicles((v.data ?? []).map((x: any) => ({ id: x.id, label: x.registration_number }))); setDrivers((d.data ?? []).map((x: any) => ({ id: x.id, label: x.full_name }))); setTransporters((t.data ?? []) as RecordRow[]);
  }
  function openCreate() { setScreen("create"); setBranchId(branches.length === 1 ? branches[0].id : ""); setDrafts([]); setEwayNo(""); setSourceId(""); setTransporterId(""); setVehicleId(""); setDriverId(""); setMovement("pickup"); setTransportMode("Road"); void loadMasters(); }
  useEffect(() => { if (branch && screen === "create") { setFromPin(branch.pin_code ?? ""); if (movement === "pickup") setToPin(""); } }, [branchId, branch?.pin_code, screen]);
  useEffect(() => { if (movement === "drop") setToPin(selectedTransporter?.pin_code ?? ""); }, [movement, selectedTransporter?.pin_code]);
  async function addEway() {
    if (!/^\d{12}$/.test(ewayNo)) return toast.error("E-Way Bill Number must contain exactly 12 digits");
    if (!branchId || !user?.sessionToken) return toast.error("Select a branch and sign in again");
    if (drafts.some((item) => item.eway_bill_number === ewayNo)) return toast.error("This E-Way Bill is already used");
    const existing = await supabase.from("shipments").select("id").eq("eway_bill_number", ewayNo).maybeSingle();
    if (existing.data) return toast.error("This E-Way Bill is already used");
    setFetching(true); try { const raw = await serverFetchEwayBillDetails({ data: { token: user.sessionToken, branchId, ewayBillNumber: ewayNo } }); const draft = mapEway(raw); if (!draft.eway_bill_number) draft.eway_bill_number = ewayNo; if (!draft.items.length) throw new Error("E-Way Bill has no goods details"); if (drafts.length) { const base = drafts[0]; if (base.supplier_gstin.toUpperCase() !== draft.supplier_gstin.toUpperCase() || base.recipient_gstin.toUpperCase() !== draft.recipient_gstin.toUpperCase() || base.dispatch_from_pin_code !== draft.dispatch_from_pin_code || base.ship_to_pin_code !== draft.ship_to_pin_code) throw new Error("All Consignment shipments must have matching From/To GSTINs and Pincodes"); } setDrafts((items) => [...items, draft]); setEwayNo(""); toast.success("E-Way Bill fetched and added"); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not fetch E-Way Bill details"); } finally { setFetching(false); }
  }
  async function createTransporter() { if (!newTransporter.name.trim()) return toast.error("Enter transporter name"); const { data, error } = await supabase.from("ltms_transporters").insert({ transporter_name: newTransporter.name.trim(), gstin: newTransporter.gstin.toUpperCase(), pin_code: newTransporter.pin, branch_id: branchId || null }).select("*").single(); if (error) return toast.error(error.message); setTransporters((items) => [...items, data]); setTransporterId(data.id); setNewTransporter({ name: "", gstin: "", pin: "" }); toast.success("Transporter added"); }
  async function save() {
    if (!branchId || !sourceId || !vehicleId || !driverId || !transporterId || drafts.length < 1) return toast.error("Branch, Contract, Vehicle, Driver, Transporter and at least one E-Way Bill are required");
    if (movement === "drop" && (!/^\d{6}$/.test(fromPin) || !/^\d{6}$/.test(toPin))) return toast.error("Drop mode requires valid From and To Pincodes");
    const p = { branch_id: branchId, source_id: sourceId, consignment_type: type, movement_mode: movement, transport_mode: transportMode, vehicle_id: vehicleId, driver_id: driverId, transporter_id: transporterId, from_pin_code: fromPin, to_pin_code: toPin, from_gstin: first?.supplier_gstin ?? "", to_gstin: first?.recipient_gstin ?? "", generation_mode: first?.generation_mode ?? "", transaction_type: first?.transaction_type ?? "", supply_type: first?.supply_type ?? "", sub_supply_type: first?.sub_type ?? "", from_details: { gstin: first?.supplier_gstin, trade_name: first?.supplier_trade_name, legal_name: first?.supplier_legal_name, address1: first?.supplier_address_line_1, address2: first?.supplier_address_line_2, place: first?.supplier_place, pin: first?.supplier_pin_code, state: first?.supplier_state }, to_details: { gstin: first?.recipient_gstin, trade_name: first?.recipient_trade_name, legal_name: first?.recipient_legal_name, address1: first?.recipient_address_line_1, address2: first?.recipient_address_line_2, place: first?.recipient_place, pin: first?.recipient_pin_code, state: first?.recipient_state }, created_by: user?.id ?? null };
    setLoading(true); const { data, error } = await supabase.rpc("create_consignment_with_shipments", { p_consignment: p, p_shipments: drafts.map((draft) => ({ ...draft, items: draft.items.map((item, index) => ({ ...item, item_no: index + 1 })) })) }); setLoading(false); if (error) return toast.error(error.message); toast.success(`Consignment ${data?.consignment_number ?? ""} created with ${data?.shipment_count ?? drafts.length} Shipment(s)`); setScreen("list"); await load();
  }
  async function deleteRow(row: RecordRow) { if (!window.confirm(`Delete Consignment ${row.consignment_number}? Its generated Shipments will also be deleted.`)) return; const { error } = await supabase.from("consignments").delete().eq("id", row.id); if (error) return toast.error(error.message); toast.success("Consignment and generated Shipments deleted"); await load(); }
  async function openView(row: RecordRow) { const { data, error } = await supabase.from("shipments").select("*, shipment_items(*)").eq("consignment_id", row.id).order("eway_bill_date", { ascending: false }); if (error) return toast.error(error.message); setView(row); setViewShipments((data ?? []) as RecordRow[]); setScreen("view"); }
  const filtered = useMemo(() => rows.filter((row) => (branchFilter === "all" || row.branch_id === branchFilter) && (typeFilter === "all" || row.consignment_type === typeFilter) && (!search.trim() || String(row.consignment_number).toLowerCase().includes(search.trim().toLowerCase()))), [rows, branchFilter, typeFilter, search]);
  if (screen === "view" && view) return <ViewConsignment row={view} shipments={viewShipments} onBack={() => setScreen("list")} />;
  if (screen === "create") return <CreateConsignment branch={branch} branchId={branchId} setBranchId={setBranchId} branches={branches} sourceId={sourceId} setSourceId={setSourceId} contracts={contracts} type={type} setType={setType} movement={movement} setMovement={setMovement} transportMode={transportMode} setTransportMode={setTransportMode} vehicleId={vehicleId} setVehicleId={setVehicleId} driverId={driverId} setDriverId={setDriverId} transporterId={transporterId} setTransporterId={setTransporterId} vehicles={vehicles} drivers={drivers} transporters={transporters} newTransporter={newTransporter} setNewTransporter={setNewTransporter} createTransporter={createTransporter} fromPin={fromPin} setFromPin={setFromPin} toPin={toPin} setToPin={setToPin} ewayNo={ewayNo} setEwayNo={setEwayNo} addEway={addEway} fetching={fetching} drafts={drafts} removeDraft={(index) => setDrafts((items) => items.filter((_, i) => i !== index))} save={save} saving={loading} onBack={() => setScreen("list")} />;
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Consignment</h2><p className="text-sm text-muted-foreground">Create consignments from fetched E-Way Bills. Generated Shipments are view-only.</p></div><Button onClick={openCreate}><Plus className="mr-1 size-4" /> Create Consignment</Button></div><div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 p-3"><div className="min-w-[180px] space-y-1.5"><Label>Search Consignment</Label><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ABC202600001" /></div><div className="min-w-[180px] space-y-1.5"><Label>Branch</Label><Select value={branchFilter} onValueChange={setBranchFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All branches</SelectItem>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}</SelectContent></Select></div><div className="min-w-[160px] space-y-1.5"><Label>Type</Label><Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="own">Own</SelectItem><SelectItem value="third_party">Third Party</SelectItem></SelectContent></Select></div></div><div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3">Consignment No.</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Mode</th><th className="px-4 py-3">Created</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>}{!loading && !filtered.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No consignments found.</td></tr>}{filtered.map((row) => <tr key={row.id} className="border-t border-border"><td className="px-4 py-3 font-medium">{row.consignment_number}</td><td className="px-4 py-3">{row.branch?.branch_name ?? "—"}</td><td className="px-4 py-3"><Badge variant="outline">{row.consignment_type === "third_party" ? "Third Party" : "Own"}</Badge></td><td className="px-4 py-3">{row.movement_mode} · {row.transport_mode}</td><td className="px-4 py-3">{new Date(row.created_at).toLocaleDateString("en-IN")}</td><td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => void openView(row)}><Eye className="mr-1 size-4" /> View</Button><Button variant="ghost" size="sm" onClick={() => void deleteRow(row)}><Trash2 className="mr-1 size-4 text-destructive" /> Delete</Button></td></tr>)}</tbody></table></div></div>;
}

function CreateConsignment(props: any) {
  const { branch, branches, branchId, setBranchId, sourceId, setSourceId, contracts, type, setType, movement, setMovement, transportMode, setTransportMode, vehicleId, setVehicleId, driverId, setDriverId, transporterId, setTransporterId, vehicles, drivers, transporters, newTransporter, setNewTransporter, createTransporter, fromPin, setFromPin, toPin, setToPin, ewayNo, setEwayNo, addEway, fetching, drafts, removeDraft, save, saving, onBack } = props;
  const select = (label: string, value: string, onChange: (value: string) => void, options: Master[], placeholder: string) => <div className="space-y-1.5"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></div>;
  return <div className="space-y-5"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Create Consignment</h2><p className="text-sm text-muted-foreground">Shipments are created only after the Consignment is saved.</p></div><Button variant="outline" onClick={onBack}><X className="mr-1 size-4" /> Cancel</Button></div><section className="space-y-4 rounded-xl border border-border p-4"><h3 className="font-semibold">Document and Movement</h3><div className="grid gap-3 md:grid-cols-4"><ReadonlyField label="Document Type" value="Consignment" /><ReadonlyField label="Consignment No." value="Generated on save: branch prefix + year + sequence" />{select("Branch *", branchId, setBranchId, branches.map((b: any) => ({ id: b.id, label: b.branch_name })), "Select branch")}{select("Source — Contract *", sourceId, setSourceId, contracts, "Select contract")}<div className="space-y-1.5"><Label>Type *</Label><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="own">Own</SelectItem><SelectItem value="third_party">Third Party</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><Label>Movement *</Label><Select value={movement} onValueChange={setMovement}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pickup">Pickup</SelectItem><SelectItem value="drop">Drop</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><Label>Transport Mode *</Label><Select value={transportMode} onValueChange={setTransportMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Road", "Rail", "Air", "Ship"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>{select("Vehicle *", vehicleId, setVehicleId, vehicles, "Select company vehicle")}{select("Driver *", driverId, setDriverId, drivers, "Select company driver")}{select("Transporter *", transporterId, setTransporterId, transporters.map((t: any) => ({ id: t.id, label: t.transporter_name, extra: t.gstin })), "Select transporter")}</div><p className="text-xs text-muted-foreground">Own and Third Party both use our company Vehicle and Driver masters. Transporter GSTIN: {transporters.find((t: any) => t.id === transporterId)?.gstin || "—"}</p></section><section className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-semibold">Create Transporter Inline</h3><div className="grid gap-3 md:grid-cols-4"><Input placeholder="Transporter name" value={newTransporter.name} onChange={(e: any) => setNewTransporter({ ...newTransporter, name: e.target.value })} /><Input placeholder="GSTIN" value={newTransporter.gstin} onChange={(e: any) => setNewTransporter({ ...newTransporter, gstin: e.target.value })} /><Input placeholder="Pincode" value={newTransporter.pin} onChange={(e: any) => setNewTransporter({ ...newTransporter, pin: e.target.value })} /><Button type="button" variant="outline" onClick={() => void createTransporter()}>Add Transporter</Button></div></section><section className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-semibold">Pincodes</h3><div className="grid gap-3 md:grid-cols-2"><div><Label>From Pincode</Label><Input value={fromPin} onChange={(e) => setFromPin(e.target.value)} placeholder={branch?.pin_code ?? "Branch pincode"} /></div><div><Label>To Pincode {movement === "drop" ? "*" : ""}</Label><Input value={toPin} onChange={(e) => setToPin(e.target.value)} placeholder="Transporter pincode" /></div></div></section><section className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap items-end gap-2"><div className="min-w-[260px] flex-1"><Label>E-Way Bill Number *</Label><Input value={ewayNo} onChange={(e) => setEwayNo(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="12 digit E-Way Bill" /></div><Button type="button" onClick={() => void addEway()} disabled={fetching}>{fetching ? "Fetching…" : "Fetch and Add E-Way Bill"}</Button></div>{drafts.map((draft: ShipmentDraft, index: number) => <div key={draft.eway_bill_number} className="rounded-lg border border-border bg-muted/20 p-3"><div className="flex items-start justify-between"><div><p className="font-medium">{index + 1}. {draft.eway_bill_number}</p><p className="text-xs text-muted-foreground">{draft.supplier_gstin} → {draft.recipient_gstin} · {draft.dispatch_from_pin_code} → {draft.ship_to_pin_code}</p></div><Button variant="ghost" size="sm" onClick={() => removeDraft(index)}>Remove</Button></div><div className="mt-3 grid gap-2 md:grid-cols-4"><ReadonlyField label="Generation Mode" value={draft.generation_mode} /><ReadonlyField label="Transaction Type" value={draft.transaction_type} /><ReadonlyField label="Supply Type" value={draft.supply_type} /><ReadonlyField label="Sub-Supply Type" value={draft.sub_type} /><ReadonlyField label="From GSTIN" value={draft.supplier_gstin} /><ReadonlyField label="From Trade Name" value={draft.supplier_trade_name} /><ReadonlyField label="From Legal Name" value={draft.supplier_legal_name} /><ReadonlyField label="From Address 1" value={draft.supplier_address_line_1} /><ReadonlyField label="From Address 2" value={draft.supplier_address_line_2} /><ReadonlyField label="From Place" value={draft.supplier_place} /><ReadonlyField label="From Pincode" value={draft.supplier_pin_code} /><ReadonlyField label="From State" value={draft.supplier_state} /><ReadonlyField label="To GSTIN" value={draft.recipient_gstin} /><ReadonlyField label="To Trade Name" value={draft.recipient_trade_name} /><ReadonlyField label="To Legal Name" value={draft.recipient_legal_name} /><ReadonlyField label="To Address 1" value={draft.recipient_address_line_1} /><ReadonlyField label="To Address 2" value={draft.recipient_address_line_2} /><ReadonlyField label="To Place" value={draft.recipient_place} /><ReadonlyField label="To Pincode" value={draft.recipient_pin_code} /><ReadonlyField label="To State" value={draft.recipient_state} /></div><GoodsTable items={draft.items} /></div>)}</section><div className="flex justify-end gap-2"><Button variant="outline" onClick={onBack}>Cancel</Button><Button onClick={() => void save()} disabled={saving || drafts.length === 0}>{saving ? "Saving…" : "Create Consignment and Shipments"}</Button></div></div>;
}

function GoodsTable({ items }: { items: Item[] }) { return <div className="mt-4 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[1200px] text-xs"><thead className="bg-muted/40 text-left"><tr>{["Product", "Description", "HSN", "Qty", "Unit", "Weight", "Taxable", "CGST %", "SGST %", "IGST %", "Cess %", "Total"].map((x) => <th key={x} className="px-2 py-2">{x}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={index} className="border-t border-border">{["product_name", "description", "hsn_code", "quantity", "unit", "weight_kg", "taxable_value", "cgst_rate", "sgst_rate", "igst_rate", "cess_rate", "total_invoice_value"].map((key) => <td key={key} className="px-2 py-2">{item[key] || "—"}</td>)}</tr>)}</tbody></table></div>; }

function ViewConsignment({ row, shipments, onBack }: { row: RecordRow; shipments: RecordRow[]; onBack: () => void }) { return <div className="space-y-5"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Consignment {row.consignment_number}</h2><p className="text-sm text-muted-foreground">View-only Consignment and generated Shipment records</p></div><Button variant="outline" onClick={onBack}>Back</Button></div><div className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-4"><ReadonlyField label="Document Type" value="Consignment" /><ReadonlyField label="Branch" value={row.branch?.branch_name} /><ReadonlyField label="Type" value={row.consignment_type === "third_party" ? "Third Party" : "Own"} /><ReadonlyField label="Movement / Mode" value={`${row.movement_mode} / ${row.transport_mode}`} /><ReadonlyField label="From GSTIN" value={row.from_gstin} /><ReadonlyField label="To GSTIN" value={row.to_gstin} /><ReadonlyField label="From Pincode" value={row.from_pin_code} /><ReadonlyField label="To Pincode" value={row.to_pin_code} /></div>{shipments.map((shipment) => <div key={shipment.id} className="rounded-xl border border-border p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">E-Way Bill {shipment.eway_bill_number}</h3><Badge variant="outline">View only</Badge></div><div className="grid gap-3 md:grid-cols-4"><ReadonlyField label="Generation Mode" value={shipment.generation_mode} /><ReadonlyField label="Transaction Type" value={shipment.transaction_type} /><ReadonlyField label="From GSTIN" value={shipment.supplier_gstin} /><ReadonlyField label="To GSTIN" value={shipment.recipient_gstin} /><ReadonlyField label="From Place" value={shipment.dispatch_from_place} /><ReadonlyField label="From Pincode" value={shipment.dispatch_from_pin_code} /><ReadonlyField label="To Place" value={shipment.ship_to_place} /><ReadonlyField label="To Pincode" value={shipment.ship_to_pin_code} /></div><GoodsTable items={(shipment.shipment_items ?? []) as Item[]} /></div>)}</div>; }
