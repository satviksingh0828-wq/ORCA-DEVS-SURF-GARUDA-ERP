import { useEffect, useMemo, useState } from "react";
import { Search, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
const db = supabase as any;
type ShipmentItem = {
  product_name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  weight_kg?: number | string | null;
};
type Shipment = {
  id: string;
  eway_bill_number?: string | null;
  total_invoice_value?: number | string | null;
  supplier_trade_name?: string | null;
  recipient_trade_name?: string | null;
  supplier_pin_code?: string | null;
  recipient_pin_code?: string | null;
  shipment_items?: ShipmentItem[] | null;
};
type Movement = {
  id: string;
  consignment_number?: string | null;
  branch_id?: string | null;
  consignment_type?: string | null;
  movement_mode?: string | null;
  own_transport_mode?: string | null;
  transport_mode?: string | null;
  from_pin_code?: string | null;
  to_pin_code?: string | null;
  from_details?: { trade_name?: string; legal_name?: string; pincode?: string } | null;
  to_details?: { trade_name?: string; legal_name?: string; pincode?: string } | null;
  created_at?: string | null;
  trip_id?: string | null;
  trip?: { trip_code?: string | null } | null;
  branch?: { branch_name?: string | null; pin_code?: string | null } | null;
  vehicle?: { registration_number?: string | null; nickname?: string | null } | null;
  driver?: { full_name?: string | null; driver_code?: string | null } | null;
  rental?: { rental_name?: string | null } | null;
  transporter?: {
    transporter_name?: string | null;
    pin_code?: string | null;
    gstin?: string | null;
  } | null;
  shipments?: Shipment[] | null;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
const show = (value: unknown) => String(value ?? "").trim() || "—";
const vehicleName = (m: Movement) =>
  [m.vehicle?.registration_number, m.vehicle?.nickname].filter(Boolean).join(" · ") ||
  "Not assigned";
const driverName = (m: Movement) => m.driver?.full_name || m.driver?.driver_code || "Not assigned";
const shipmentItems = (m: Movement) => (m.shipments ?? []).flatMap((s) => s.shipment_items ?? []);
const totals = (m: Movement) => ({
  weight: shipmentItems(m).reduce((sum, i) => sum + Number(i.weight_kg || 0), 0),
  quantity: shipmentItems(m).reduce((sum, i) => sum + Number(i.quantity || 0), 0),
  invoice: (m.shipments ?? []).reduce((sum, s) => sum + Number(s.total_invoice_value || 0), 0),
});
function isThirdPartyDrop(m: Movement) {
  return m.consignment_type === "third_party" && m.movement_mode === "drop";
}
function routeLabels(m: Movement) {
  const thirdPartyDrop = isThirdPartyDrop(m);
  return {
    from: thirdPartyDrop
      ? m.branch?.branch_name || "Our branch"
      : m.from_details?.trade_name ||
        m.from_details?.legal_name ||
        m.from_details?.place ||
        "Consignment origin",
    to: thirdPartyDrop
      ? m.transporter?.transporter_name || "Transporter"
      : m.to_details?.trade_name ||
        m.to_details?.legal_name ||
        m.to_details?.place ||
        "Consignment destination",
    fromPin: thirdPartyDrop
      ? m.branch?.pin_code || m.from_pin_code
      : m.shipments?.[0]?.supplier_pin_code || m.from_details?.pincode || m.from_pin_code,
    toPin: thirdPartyDrop
      ? m.transporter?.pin_code || m.to_pin_code
      : m.shipments?.[0]?.recipient_pin_code || m.to_details?.pincode || m.to_pin_code,
  };
}
export function MovementList() {
  const branches = useBranches();
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [branchId, setBranchId] = useState("all");
  const [assignment, setAssignment] = useState("all");
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<Movement | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      let q = db
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,consignment_type,movement_mode,own_transport_mode,transport_mode,from_pin_code,to_pin_code,from_details,to_details,created_at,trip_id,trip:trips(trip_code),branch:branches(branch_name,pin_code),vehicle:vehicles(registration_number,nickname),driver:drivers(full_name,driver_code),rental:rentals(rental_name),transporter:ltms_transporters(transporter_name,pin_code,gstin),shipments(id,eway_bill_number,total_invoice_value,supplier_trade_name,recipient_trade_name,supplier_pin_code,recipient_pin_code,shipment_items(product_name,description,quantity,weight_kg))",
        )
        .order("created_at", { ascending: false });
      if (month) {
        const start = new Date(`${month}-01T00:00:00.000Z`);
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        q = q.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
      }
      const { data, error } = await q;
      if (!active) return;
      if (error) toast.error(error.message);
      setRows((data ?? []) as Movement[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [month]);
  const movements = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (m.consignment_type === "third_party" && m.movement_mode !== "drop") return false;
      if (branchId !== "all" && m.branch_id !== branchId) return false;
      if (assignment === "assigned" && !m.trip_id) return false;
      if (assignment === "unassigned" && m.trip_id) return false;
      return (
        !needle ||
        [
          m.consignment_number,
          m.trip?.trip_code,
          m.vehicle?.registration_number,
          m.driver?.full_name,
          ...(m.shipments ?? []).map((s) => s.eway_bill_number),
        ].some((v) => show(v).toLowerCase().includes(needle))
      );
    });
  }, [rows, branchId, assignment, search]);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Monthly Movements</h2>
        <p className="text-sm text-muted-foreground">
          Movements can be assigned to only one trip. Unassign a movement from its current trip
          before selecting it elsewhere.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 p-3">
        <div className="min-w-[190px] space-y-1.5">
          <Label htmlFor="movement-month">Movement month</Label>
          <Input
            id="movement-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="min-w-[190px] space-y-1.5">
          <Label>Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[170px] space-y-1.5">
          <Label>Assignment</Label>
          <Select value={assignment} onValueChange={setAssignment}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movements</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[240px] flex-1 space-y-1.5">
          <Label htmlFor="movement-search">Search movements</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="movement-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Consignment, trip, E-Way Bill, vehicle, driver"
              className="pl-9"
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[1050px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {[
                "Consignment No.",
                "Date",
                "Movement",
                "From",
                "To",
                "Vehicle",
                "Driver",
                "Trip",
                "Status",
                "",
              ].map((h) => (
                <th key={h} className="px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center">
                  Loading movements…
                </td>
              </tr>
            ) : movements.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                  No movements found for this month.
                </td>
              </tr>
            ) : (
              movements.map((m) => {
                const r = routeLabels(m);
                return (
                  <tr key={m.id} className="border-t border-border align-top hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{show(m.consignment_number)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {m.created_at ? new Date(m.created_at).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {isThirdPartyDrop(m)
                        ? "Transporter drop"
                        : m.own_transport_mode === "rental"
                          ? "Own · rental"
                          : "Own · vehicle"}
                    </td>
                    <td className="px-4 py-3">
                      <div>{show(r.fromPin)}</div>
                      <div className="text-xs text-muted-foreground">{r.from}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{show(r.toPin)}</div>
                      <div className="text-xs text-muted-foreground">{r.to}</div>
                    </td>
                    <td className="px-4 py-3">{vehicleName(m)}</td>
                    <td className="px-4 py-3">{driverName(m)}</td>
                    <td className="px-4 py-3">{m.trip?.trip_code || "—"}</td>
                    <td className="px-4 py-3">
                      {m.trip_id ? (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                          Assigned
                        </Badge>
                      ) : (
                        <Badge variant="outline">Unassigned</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setViewing(m)}
                      >
                        <Eye className="mr-1 size-4" />
                        View
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {movements.length} movement{movements.length === 1 ? "" : "s"}
      </p>
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Movement {show(viewing?.consignment_number)}</DialogTitle>
          </DialogHeader>
          {viewing ? <MovementDetails movement={viewing} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function MovementDetails({ movement }: { movement: Movement }) {
  const r = routeLabels(movement);
  const t = totals(movement);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Consignment" value={movement.consignment_number} />
        <Detail
          label="Movement"
          value={
            isThirdPartyDrop(movement)
              ? "Third-party transporter drop"
              : `${movement.consignment_type === "third_party" ? "Third party" : "Own"} · ${movement.own_transport_mode || "vehicle"}`
          }
        />
        <Detail label="From" value={`${r.from} · PIN ${show(r.fromPin)}`} />
        <Detail label="To" value={`${r.to} · PIN ${show(r.toPin)}`} />
        <Detail label="Branch" value={movement.branch?.branch_name} />
        <Detail label="Vehicle" value={vehicleName(movement)} />
        <Detail label="Driver" value={driverName(movement)} />
        <Detail label="Trip" value={movement.trip?.trip_code || "Unassigned"} />
        <Detail label="Transporter" value={movement.transporter?.transporter_name} />
        <Detail label="Rental provider" value={movement.rental?.rental_name} />
        <Detail label="Transport mode" value={movement.transport_mode} />
        <Detail
          label="Created"
          value={movement.created_at ? new Date(movement.created_at).toLocaleString("en-IN") : "—"}
        />
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-3">
        <Detail label="Total weight" value={`${t.weight.toLocaleString("en-IN")} kg`} />
        <Detail label="Total quantity" value={t.quantity.toLocaleString("en-IN")} />
        <Detail label="Total invoice value" value={money(t.invoice)} />
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Shipment details
        </h3>
        {(movement.shipments ?? []).map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-3 text-xs">
            <div className="flex justify-between gap-2 font-medium">
              <span>E-Way Bill {show(s.eway_bill_number)}</span>
              <span>{money(Number(s.total_invoice_value || 0))}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              From {show(s.supplier_trade_name)} · To {show(s.recipient_trade_name)}
            </p>
            {(s.shipment_items ?? []).length ? (
              <p className="mt-1 text-muted-foreground">
                {(s.shipment_items ?? [])
                  .map((i) => i.description || i.product_name || "Item")
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm">{show(value)}</p>
    </div>
  );
}
