/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/lib/session";
import { serverTransferManifestLrs } from "@/lib/manifest-transfer";

const db = supabase as any;

type Transporter = Record<string, any>;
type Shipment = Record<string, any> & { shipment_items?: Record<string, any>[] };
type Consignment = Record<string, any> & { shipments: Shipment[] };

const displayValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const title = (key: string) => key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function DetailsGrid({ value, omit = [] }: { value: Record<string, any>; omit?: string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(value)
        .filter(([key]) => !omit.includes(key) && !key.endsWith("_id") && key !== "id")
        .map(([key, item]) => (
          <div key={key} className="rounded-md border border-border/70 bg-background/60 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title(key)}</div>
            <div className="mt-0.5 break-words text-xs">{displayValue(item)}</div>
          </div>
        ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const value = status || "pending";
  const label = value === "updated" ? "Transporter Updated" : value === "partial" ? "Partially Updated — Retry" : "Transporter Update Pending";
  return <Badge variant="outline" className={value === "updated" ? "border-emerald-300 text-emerald-700" : value === "partial" ? "border-amber-300 text-amber-700" : "border-slate-300 text-slate-700"}>{label}</Badge>;
}

function ShipmentRow({ shipment }: { shipment: Shipment }) {
  const [expanded, setExpanded] = useState(false);
  const goods = shipment.shipment_items ?? [];
  return (
    <div className="rounded-lg border border-border/70 bg-background">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40" onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="font-medium">Shipment {shipment.shipment_number || shipment.id}</span>
        <span className="text-xs text-muted-foreground">E-Way Bill: {shipment.eway_bill_number || "—"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{goods.length} goods item(s)</span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-border/70 p-3">
          <DetailsGrid value={shipment} omit={["shipment_items"]} />
          <div>
            <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Goods</h5>
            {goods.length ? (
              <div className="space-y-2">
                {goods.map((item, index) => (
                  <div key={item.id || index} className="rounded-md border border-border/70 p-2">
                    <div className="mb-2 text-xs font-semibold">Goods Item {index + 1}</div>
                    <DetailsGrid value={item} />
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">No goods details found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ConsignmentRow({ row, selected, onToggle }: { row: Consignment; selected: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <input aria-label={`Select ${row.consignment_number}`} type="checkbox" checked={selected} onChange={onToggle} className="size-4" />
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <span className="font-semibold">{row.consignment_number}</span>
          <span className="text-xs text-muted-foreground">{row.branch?.branch_name || "—"}</span>
        </button>
        <span className="text-xs text-muted-foreground">{row.shipments.length} shipment(s)</span>
        <StatusBadge status={row.transporter_update_status} />
      </div>
      <div className="grid gap-2 border-t border-border/70 px-3 pb-3 pt-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <span><b>From:</b> {row.from_pin_code || "—"}</span>
        <span><b>To:</b> {row.to_pin_code || "—"}</span>
        <span><b>Type:</b> {row.consignment_type || "—"}</span>
        <span><b>Created:</b> {row.created_at ? new Date(row.created_at).toLocaleDateString("en-IN") : "—"}</span>
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-border/70 p-3">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consignment Details</h4>
            <DetailsGrid value={row} omit={["shipments", "branch", "source", "vehicle", "rental", "transporter"]} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shipments and Goods</h4>
            <div className="space-y-2">{row.shipments.map((shipment) => <ShipmentRow key={shipment.id} shipment={shipment} />)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LtmsManifestList() {
  const { user } = useSession();
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [transporterId, setTransporterId] = useState("");
  const [rows, setRows] = useState<Consignment[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const selectedTransporter = transporters.find((item) => item.id === transporterId);
  const filteredRows = useMemo(() => rows.filter((row) => {
    const text = `${row.consignment_number} ${row.from_pin_code} ${row.to_pin_code} ${row.branch?.branch_name ?? ""} ${row.shipments.map((item) => item.eway_bill_number).join(" ")}`.toLowerCase();
    return !search.trim() || text.includes(search.trim().toLowerCase());
  }), [rows, search]);

  async function loadTransporters() {
    const { data, error } = await db.from("ltms_transporters").select("*").order("transporter_name");
    if (error) toast.error(error.message);
    setTransporters(data ?? []);
  }

  async function loadConsignments(id = transporterId) {
    if (!id) { setRows([]); setSelectedIds([]); return; }
    setLoading(true);
    const consignmentResult = await db.from("consignments")
      .select("*, branch:branches(*), source:contracts(*), vehicle:vehicles(*), rental:rentals(*), transporter:ltms_transporters(*)")
      .eq("transporter_id", id)
      .order("created_at", { ascending: false });
    if (consignmentResult.error) {
      toast.error(consignmentResult.error.message);
      setLoading(false);
      return;
    }
    const consignments = (consignmentResult.data ?? []).filter((row: any) => row.transporter_update_status !== "updated");
    const ids = consignments.map((row: any) => row.id);
    const shipmentResult = ids.length
      ? await db.from("shipments").select("*, shipment_items(*)").in("consignment_id", ids).order("created_at", { ascending: false })
      : { data: [], error: null };
    if (shipmentResult.error) toast.error(shipmentResult.error.message);
    const byConsignment = new Map<string, Shipment[]>();
    for (const shipment of shipmentResult.data ?? []) {
      const list = byConsignment.get(shipment.consignment_id) ?? [];
      list.push(shipment);
      byConsignment.set(shipment.consignment_id, list);
    }
    setRows(consignments.map((row: any) => ({ ...row, shipments: byConsignment.get(row.id) ?? [] })));
    setSelectedIds([]);
    setLoading(false);
  }

  useEffect(() => { void loadTransporters(); }, []);
  useEffect(() => { void loadConsignments(); }, [transporterId]);

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function updateTransporter() {
    if (!selectedTransporter) return toast.error("Select an LTMS transporter");
    const gstin = String(selectedTransporter.gstin ?? "").trim().toUpperCase();
    if (!/^\d{2}[0-9A-Z]{13}$/.test(gstin)) return toast.error("Selected transporter has an invalid GSTIN");
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
    if (!selectedRows.length) return toast.error("Select at least one consignment");
    if (!user?.sessionToken) return toast.error("Your session has expired. Please sign in again.");
    setTransferring(true);
    try {
      const byBranch = new Map<string, Consignment[]>();
      for (const row of selectedRows) {
        const list = byBranch.get(row.branch_id) ?? [];
        list.push(row);
        byBranch.set(row.branch_id, list);
      }
      const allResults = new Map<string, { ok: boolean; error?: string }>();
      for (const [branchId, branchRows] of byBranch) {
        const ewayNumbers = [...new Set(branchRows.flatMap((row) => row.shipments
          .filter((shipment) => shipment.transporter_update_status !== "updated")
          .map((shipment) => String(shipment.eway_bill_number ?? ""))
          .filter((number) => /^\d{12}$/.test(number))))];
        if (!ewayNumbers.length) continue;
        for (let offset = 0; offset < ewayNumbers.length; offset += 100) {
          const batch = ewayNumbers.slice(offset, offset + 100);
          const result = await serverTransferManifestLrs({ data: { sessionToken: user.sessionToken, branchId, partnerGstin: gstin, ewayBillNumbers: batch } });
          for (const item of result.results) allResults.set(item.ewayBillNumber, { ok: item.ok, error: item.error });
        }
      }
      for (const row of selectedRows) {
        const shipmentResults = row.shipments.map((shipment) => ({
          shipment,
          result: shipment.transporter_update_status === "updated"
            ? { ok: true }
            : allResults.get(String(shipment.eway_bill_number ?? "")),
        }));
        const successful = shipmentResults.filter((item) => item.result?.ok);
        const failed = shipmentResults.filter((item) => !item.result?.ok);
        for (const item of successful) {
          await db.from("shipments").update({ transporter_id: selectedTransporter.id, transporter_update_status: "updated", transporter_update_error: null, transporter_updated_at: new Date().toISOString() }).eq("id", item.shipment.id);
        }
        for (const item of failed) {
          await db.from("shipments").update({ transporter_update_status: "failed", transporter_update_error: item.result?.error ?? "E-Way Bill transporter update failed" }).eq("id", item.shipment.id);
        }
        const allDone = row.shipments.length > 0 && successful.length === row.shipments.length;
        const status = allDone ? "updated" : successful.length ? "partial" : "pending";
        await db.from("consignments").update({ transporter_update_status: status, transporter_update_error: allDone ? null : `${failed.length} E-Way Bill(s) still need retry`, transporter_updated_at: allDone ? new Date().toISOString() : null }).eq("id", row.id);
      }
      const failedCount = [...allResults.values()].filter((item) => !item.ok).length;
      toast[failedCount ? "error" : "success"](failedCount ? `${failedCount} E-Way Bill(s) failed. Retry is available.` : "All selected consignments transferred successfully");
      await loadConsignments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update transporter");
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Manifest</h2>
        <p className="text-sm text-muted-foreground">Update the transporter on every E-Way Bill belonging to a consignment.</p>
      </div>
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="max-w-xl space-y-1.5">
          <Label>Transporter *</Label>
          <Select value={transporterId} onValueChange={setTransporterId}>
            <SelectTrigger><SelectValue placeholder="Select LTMS transporter" /></SelectTrigger>
            <SelectContent>{transporters.map((item) => <SelectItem key={item.id} value={item.id}>{item.transporter_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {selectedTransporter && <DetailsGrid value={selectedTransporter} />}
      </section>
      {transporterId && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search consignment or E-Way Bill" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <Button variant="outline" onClick={() => void loadConsignments()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            <Button onClick={() => void updateTransporter()} disabled={transferring || selectedIds.length === 0}>{transferring ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}Update Transporter ({selectedIds.length})</Button>
          </div>
          {loading ? <div className="flex items-center justify-center rounded-xl border border-border p-10 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading consignments…</div> : filteredRows.length ? <div className="space-y-3">{filteredRows.map((row) => <ConsignmentRow key={row.id} row={row} selected={selectedIds.includes(row.id)} onToggle={() => toggle(row.id)} />)}</div> : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No unupdated consignments found for this transporter.</div>}
        </>
      )}
    </div>
  );
}
