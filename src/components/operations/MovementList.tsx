import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// LTMS tables are not fully represented in the generated Supabase Database type yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type ShipmentItem = {
  product_name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  weight_kg?: number | string | null;
  total_invoice_value?: number | string | null;
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
const pin = (value: unknown) => String(value ?? "").trim() || "—";
const vehicleName = (movement: Movement) =>
  [movement.vehicle?.registration_number, movement.vehicle?.nickname].filter(Boolean).join(" · ") ||
  "Not assigned";
const driverName = (movement: Movement) =>
  movement.driver?.full_name || movement.driver?.driver_code || "Not assigned";
const shipmentItems = (movement: Movement) =>
  (movement.shipments ?? []).flatMap((shipment) => shipment.shipment_items ?? []);
const totals = (movement: Movement) => {
  const items = shipmentItems(movement);
  return {
    weight: items.reduce((sum: number, item: Movement) => sum + Number(item.weight_kg || 0), 0),
    quantity: items.reduce((sum: number, item: Movement) => sum + Number(item.quantity || 0), 0),
    invoice: (movement.shipments ?? []).reduce(
      (sum: number, shipment: Movement) => sum + Number(shipment.total_invoice_value || 0),
      0,
    ),
  };
};

export function MovementList() {
  const branches = useBranches();
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [branchId, setBranchId] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      let query = db
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,consignment_type,movement_mode,own_transport_mode,transport_mode,from_pin_code,to_pin_code,from_gstin,to_gstin,from_details,to_details,created_at,branch:branches(branch_name,pin_code),vehicle:vehicles(registration_number,nickname),driver:drivers(full_name,driver_code),rental:rentals(rental_name),transporter:ltms_transporters(transporter_name,pin_code,gstin),shipments(id,eway_bill_number,total_invoice_value,supplier_trade_name,recipient_trade_name,supplier_pin_code,recipient_pin_code,shipment_items(product_name,description,quantity,weight_kg,total_invoice_value))",
        )
        .order("created_at", { ascending: false });
      if (month) {
        const start = new Date(`${month}-01T00:00:00.000Z`);
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
      }
      const { data, error } = await query;
      if (!active) return;
      if (error) toast.error(error.message);
      setRows((data ?? []) as Movement[]);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [month]);

  const movements = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      // A transporter pickup is not a movement recorded by our fleet, so keep it out of this view.
      if (row.consignment_type === "third_party" && row.movement_mode !== "drop") return false;
      if (branchId !== "all" && row.branch_id !== branchId) return false;
      if (
        query &&
        ![
          row.consignment_number,
          row.transporter?.transporter_name,
          row.vehicle?.registration_number,
          row.driver?.full_name,
          ...(row.shipments ?? []).map((shipment) => shipment.eway_bill_number),
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(query),
        )
      )
        return false;
      return true;
    });
  }, [rows, branchId, search]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Monthly Movements</h2>
        <p className="text-sm text-muted-foreground">
          Consignment routes and shipment totals. Transporter pickup consignments are not shown
          here.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 p-3">
        <div className="min-w-[190px] space-y-1.5">
          <Label htmlFor="movement-month">Movement month</Label>
          <Input
            id="movement-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
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
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.branch_name}
                </SelectItem>
              ))}
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
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Consignment, E-Way Bill, transporter, vehicle, driver"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Consignment No.</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Movement</th>
              <th className="px-4 py-3">From PIN</th>
              <th className="px-4 py-3">To PIN</th>
              <th className="px-4 py-3">Transporter</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  Loading movements…
                </td>
              </tr>
            )}
            {!loading && movements.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No movements found for this month.
                </td>
              </tr>
            )}
            {!loading &&
              movements.map((row) => {
                const isThirdPartyDrop =
                  row.consignment_type === "third_party" && row.movement_mode === "drop";
                const total = totals(row);
                const isExpanded = expandedId === row.id;
                const routeFrom = isThirdPartyDrop
                  ? row.branch?.pin_code || row.from_pin_code
                  : row.shipments?.[0]?.supplier_pin_code || row.from_details?.pincode;
                const routeTo = isThirdPartyDrop
                  ? row.transporter?.pin_code || row.to_pin_code
                  : row.shipments?.[0]?.recipient_pin_code || row.to_details?.pincode;
                return (
                  <MovementRows
                    key={row.id}
                    row={row}
                    isExpanded={isExpanded}
                    isThirdPartyDrop={isThirdPartyDrop}
                    routeFrom={routeFrom}
                    routeTo={routeTo}
                    total={total}
                    onToggle={() => setExpandedId(isExpanded ? null : row.id)}
                  />
                );
              })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {movements.length} movement{movements.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function MovementRows({
  row,
  isExpanded,
  isThirdPartyDrop,
  routeFrom,
  routeTo,
  total,
  onToggle,
}: {
  row: Movement;
  isExpanded: boolean;
  isThirdPartyDrop: boolean;
  routeFrom: unknown;
  routeTo: unknown;
  total: { weight: number; quantity: number; invoice: number };
  onToggle: () => void;
}) {
  const fromLabel = isThirdPartyDrop
    ? row.branch?.branch_name || "Our branch"
    : row.from_details?.trade_name || row.from_details?.legal_name || "Consignment origin";
  const toLabel = isThirdPartyDrop
    ? row.transporter?.transporter_name || "Transporter"
    : row.to_details?.trade_name || row.to_details?.legal_name || "Consignment destination";
  return (
    <>
      <tr className="border-t border-border align-top hover:bg-muted/20">
        <td className="px-4 py-3 font-medium">{row.consignment_number}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {row.created_at ? new Date(row.created_at).toLocaleDateString("en-IN") : "—"}
        </td>
        <td className="px-4 py-3">
          {isThirdPartyDrop
            ? "Transporter drop"
            : row.own_transport_mode === "rental"
              ? "Own · rental"
              : "Own · vehicle"}
        </td>
        <td className="px-4 py-3">
          <div>{pin(routeFrom)}</div>
          <div className="text-xs text-muted-foreground">{fromLabel}</div>
        </td>
        <td className="px-4 py-3">
          <div>{pin(routeTo)}</div>
          <div className="text-xs text-muted-foreground">{toLabel}</div>
        </td>
        <td className="px-4 py-3">
          {isThirdPartyDrop ? row.transporter?.transporter_name || "—" : "—"}
        </td>
        <td className="px-4 py-3">{row.branch?.branch_name || "—"}</td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <>
                Hide <ChevronUp className="size-4" />
              </>
            ) : (
              <>
                Details <ChevronDown className="size-4" />
              </>
            )}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={8} className="p-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Detail label="Consignment" value={row.consignment_number} />
              <Detail label="Branch" value={row.branch?.branch_name} />
              <Detail label="Transport mode" value={row.transport_mode} />
              <Detail
                label="Consignment type"
                value={
                  isThirdPartyDrop
                    ? "Third Party — Drop"
                    : row.own_transport_mode === "rental"
                      ? "Own — Rental"
                      : "Own"
                }
              />
              <Detail label="Route from" value={`${fromLabel} · PIN ${pin(routeFrom)}`} />
              <Detail label="Route to" value={`${toLabel} · PIN ${pin(routeTo)}`} />
              <Detail
                label="Transporter"
                value={isThirdPartyDrop ? row.transporter?.transporter_name : "—"}
              />
              <Detail
                label="Transporter GSTIN"
                value={isThirdPartyDrop ? row.transporter?.gstin : "—"}
              />
              <Detail label="Vehicle" value={vehicleName(row)} />
              <Detail label="Driver" value={driverName(row)} />
              <Detail label="Rental provider" value={row.rental?.rental_name} />
              <Detail
                label="Created"
                value={row.created_at ? new Date(row.created_at).toLocaleString("en-IN") : "—"}
              />
            </div>
            <div className="mt-4 grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-3">
              <Detail label="Total weight" value={`${total.weight.toLocaleString("en-IN")} kg`} />
              <Detail label="Total quantity" value={total.quantity.toLocaleString("en-IN")} />
              <Detail label="Total invoice value" value={money(total.invoice)} />
            </div>
            <div className="mt-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Shipment brief
              </h3>
              {row.shipments?.length ? (
                row.shipments.map((shipment) => {
                  const descriptions = (shipment.shipment_items ?? [])
                    .map((item) => item.description || item.product_name)
                    .filter(Boolean);
                  return (
                    <div
                      key={shipment.id}
                      className="rounded-lg border border-border bg-background p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
                        <span>E-Way Bill {shipment.eway_bill_number || "—"}</span>
                        <span>{money(Number(shipment.total_invoice_value || 0))}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {descriptions.length
                          ? [...new Set(descriptions)].join(" · ")
                          : "No item description"}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        From {shipment.supplier_trade_name || "—"} · To{" "}
                        {shipment.recipient_trade_name || "—"}
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground">No shipment details are linked.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm">{String(value || "—")}</p>
    </div>
  );
}
