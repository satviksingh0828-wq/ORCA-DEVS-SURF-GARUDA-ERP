/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/session";
import {
  serverTransferManifestLrs,
  serverRecordLtmsManifestTransfer,
} from "@/lib/manifest-transfer";

const db = supabase as any;

type Transporter = Record<string, any>;
type ShipmentItem = Record<string, any>;
type Shipment = Record<string, any> & { shipment_items?: ShipmentItem[] };
type Consignment = Record<string, any> & { shipments: Shipment[] };
type ManifestHistoryRow = Record<string, any> & {
  items?: Record<string, any>[];
  transporter?: Transporter;
};

type TransporterFields = {
  transporter_name: string;
  legal_business_name: string;
  transporter_type: string;
  gstin: string;
  pan: string;
  msme_udyam: string;
  tan: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  country: string;
  pin_code: string;
  primary_contact_name: string;
  mobile_number: string;
};

const EMPTY_TRANSPORTER: TransporterFields = {
  transporter_name: "",
  legal_business_name: "",
  transporter_type: "",
  gstin: "",
  pan: "",
  msme_udyam: "",
  tan: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  country: "",
  pin_code: "",
  primary_contact_name: "",
  mobile_number: "",
};

const TRANSPORTER_FIELDS: Array<{ label: string; key: keyof TransporterFields }> = [
  { label: "Transporter Name", key: "transporter_name" },
  { label: "Legal Business Name", key: "legal_business_name" },
  { label: "Transporter Type", key: "transporter_type" },
  { label: "Gstin", key: "gstin" },
  { label: "Pan", key: "pan" },
  { label: "Msme Udyam", key: "msme_udyam" },
  { label: "Tan", key: "tan" },
  { label: "Address Line1", key: "address_line1" },
  { label: "Address Line2", key: "address_line2" },
  { label: "City", key: "city" },
  { label: "State", key: "state" },
  { label: "Country", key: "country" },
  { label: "Pin Code", key: "pin_code" },
  { label: "Primary Contact Name", key: "primary_contact_name" },
  { label: "Mobile Number", key: "mobile_number" },
];

const GOODS_FIELDS: Array<{ label: string; key: string }> = [
  { label: "Product Name", key: "product_name" },
  { label: "Description", key: "description" },
  { label: "HSN", key: "hsn_code" },
  { label: "Quantity / Unit", key: "quantity_unit" },
  { label: "Taxable", key: "taxable_value" },
  { label: "CGST %", key: "cgst_rate" },
  { label: "SGST %", key: "sgst_rate" },
  { label: "IGST %", key: "igst_rate" },
  { label: "Cess %", key: "cess_rate" },
  { label: "Cess Non-Advol", key: "cess_nonadvol" },
  { label: "Invoice Value", key: "total_invoice_value" },
];

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function money(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-IN", { maximumFractionDigits: 2 })
    : show(value);
}

function profileFromTransporter(transporter?: Transporter): TransporterFields {
  return Object.fromEntries(
    TRANSPORTER_FIELDS.map(({ key }) => [
      key,
      String(transporter?.[key] ?? EMPTY_TRANSPORTER[key]),
    ]),
  ) as TransporterFields;
}

function TransferBadge({ status }: { status: string | null | undefined }) {
  const value = status || "pending";
  const label =
    value === "updated" || value === "transferred"
      ? "Transferred"
      : value === "partial"
        ? "Partially Transferred"
        : "Transporter Update Pending";
  return (
    <Badge
      variant="outline"
      className={
        value === "updated" || value === "transferred"
          ? "border-emerald-300 text-emerald-700"
          : value === "partial"
            ? "border-amber-300 text-amber-700"
            : "border-slate-300 text-slate-700"
      }
    >
      {label}
    </Badge>
  );
}

function GoodsTable({ items }: { items: ShipmentItem[] }) {
  if (!items.length)
    return <p className="p-3 text-xs text-muted-foreground">No goods items found.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[950px] text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {GOODS_FIELDS.map((field) => (
              <th key={field.key} className="px-3 py-2 font-medium">
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id ?? index} className="border-t border-border/70">
              {GOODS_FIELDS.map((field) => {
                const value =
                  field.key === "quantity_unit"
                    ? `${show(item.quantity)} / ${show(item.unit)}`
                    : item[field.key];
                return (
                  <td key={field.key} className="px-3 py-2">
                    {["taxable_value", "cess_nonadvol", "total_invoice_value"].includes(field.key)
                      ? money(value)
                      : show(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsignmentRow({
  row,
  selected,
  onToggle,
}: {
  row: Consignment;
  selected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <input
          aria-label={`Select ${row.consignment_number}`}
          type="checkbox"
          checked={selected}
          disabled={row.transporter_update_status === "updated"}
          onChange={onToggle}
          className="size-4"
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0" />
          ) : (
            <ChevronRight className="size-4 shrink-0" />
          )}
          <span className="font-semibold">{row.consignment_number}</span>
        </button>
        <span className="text-xs text-muted-foreground">{row.branch?.branch_name || "—"}</span>
        <span className="text-xs">
          {row.consignment_type === "third_party"
            ? "Third Party"
            : row.consignment_type === "own"
              ? "Own"
              : show(row.consignment_type)}
        </span>
        <span className="text-xs text-muted-foreground">
          {row.movement_mode || "pickup"} · {row.from_pin_code || "="} → {row.to_pin_code || "="}
        </span>
        <TransferBadge status={row.transporter_update_status} />
        <span className="text-xs text-muted-foreground">
          {row.created_at ? new Date(row.created_at).toLocaleDateString("en-GB") : "—"}
        </span>
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-border/70 p-3">
          {row.shipments.map((shipment) => (
            <ShipmentDetails key={shipment.id} shipment={shipment} />
          ))}
        </div>
      )}
    </article>
  );
}

function ShipmentDetails({ shipment }: { shipment: Shipment }) {
  const [expanded, setExpanded] = useState(false);
  const status =
    String(shipment.eway_bill_status ?? "").toUpperCase() === "ACTIVE"
      ? "ACT"
      : show(shipment.eway_bill_status);
  const validUntil = shipment.valid_until
    ? new Date(shipment.valid_until).toLocaleString("en-GB")
    : "—";
  return (
    <section className="overflow-hidden rounded-lg border border-border/70">
      <button
        type="button"
        className="grid w-full gap-2 px-3 py-2 text-left text-xs sm:grid-cols-2 lg:grid-cols-6"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="font-semibold">{show(shipment.eway_bill_number)}</span>
        <span>{show(shipment.recipient_trade_name)}</span>
        <span>{show(shipment.recipient_gstin)}</span>
        <span>{show(shipment.recipient_place)}</span>
        <span>{validUntil}</span>
        <span className="flex items-center gap-1">
          {status}
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/70">
          <GoodsTable items={shipment.shipment_items ?? []} />
        </div>
      )}
    </section>
  );
}

function relatedRecord(value: unknown): Record<string, any> {
  if (Array.isArray(value)) return value[0] ?? {};
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function ManifestDetailView({
  manifest,
  onBack,
}: {
  manifest: ManifestHistoryRow;
  onBack: () => void;
}) {
  const grouped = new Map<
    string,
    { consignment: Record<string, any>; items: Record<string, any>[] }
  >();
  for (const item of manifest.items ?? []) {
    const consignment = relatedRecord(item.consignment);
    const key = String(item.consignment_id ?? consignment.id ?? item.consignment_number);
    const group = grouped.get(key) ?? { consignment, items: [] };
    group.items.push(item);
    grouped.set(key, group);
  }
  const transporter = relatedRecord(manifest.transporter);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3 border-b border-border pb-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to manifest history">
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Manifest {show(manifest.manifest_number)}</h2>
          <p className="text-sm text-muted-foreground">
            Transfer record and linked consignment details
          </p>
        </div>
      </header>
      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label className="text-xs text-muted-foreground">Manifest Number</Label>
          <p className="font-semibold">{show(manifest.manifest_number)}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Branch</Label>
          <p>{show(relatedRecord(manifest.branch).branch_name)}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <p>
            <TransferBadge status={manifest.transfer_status} />
          </p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Created</Label>
          <p>{manifest.created_at ? new Date(manifest.created_at).toLocaleString("en-GB") : "—"}</p>
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 font-semibold">Transporter Details</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TRANSPORTER_FIELDS.map(({ label, key }) => (
            <div key={key}>
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <p>
                {show(
                  key === "transporter_name"
                    ? manifest.transporter_name || transporter[key]
                    : key === "gstin"
                      ? manifest.transporter_gstin || transporter[key]
                      : transporter[key],
                )}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Consignments ({grouped.size})</h3>
          <span className="text-sm text-muted-foreground">
            E-Way Bills: {show(manifest.eway_bill_count)}
          </span>
        </div>
        {grouped.size ? (
          [...grouped.entries()].map(([key, group]) => {
            const fromDetails = relatedRecord(group.consignment.from_details);
            const toDetails = relatedRecord(group.consignment.to_details);
            const firstShipment = relatedRecord(group.items[0]?.shipment);
            const fromPin =
              fromDetails.pincode ||
              firstShipment.dispatch_from_pin_code ||
              group.consignment.from_pin_code;
            const toPin =
              toDetails.pincode ||
              firstShipment.ship_to_pin_code ||
              firstShipment.recipient_pin_code ||
              group.consignment.to_pin_code;
            const fromLocation = fromDetails.place || firstShipment.dispatch_from_place || fromPin;
            const toLocation =
              toDetails.place ||
              firstShipment.ship_to_place ||
              firstShipment.recipient_place ||
              toPin;
            return (
              <article key={key} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                  <div>
                    <Label className="text-xs text-muted-foreground">Consignment</Label>
                    <p className="font-semibold">
                      {show(
                        group.consignment.consignment_number || group.items[0]?.consignment_number,
                      )}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Branch</Label>
                    <p>
                      {show(
                        relatedRecord(group.consignment.branch).branch_name ||
                          relatedRecord(manifest.branch).branch_name,
                      )}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Type / Mode</Label>
                    <p>
                      {show(group.consignment.consignment_type)} /{" "}
                      {show(group.consignment.movement_mode)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">From → To</Label>
                    <p>
                      {show(fromLocation)} → {show(toLocation)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">From PIN</Label>
                    <p>{show(fromPin)}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">To PIN</Label>
                    <p>{show(toPin)}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {group.items.map((item, index) => {
                    const shipment = relatedRecord(item.shipment);
                    return (
                      <section
                        key={item.id ?? index}
                        className="overflow-hidden rounded-lg border border-border/70"
                      >
                        <div className="grid gap-2 bg-muted/30 p-3 text-xs sm:grid-cols-2 lg:grid-cols-7">
                          <div>
                            <Label className="text-[11px] text-muted-foreground">E-Way Bill</Label>
                            <p className="font-semibold">
                              {show(shipment.eway_bill_number || item.eway_bill_number)}
                            </p>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Recipient</Label>
                            <p>{show(shipment.recipient_trade_name)}</p>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">
                              Recipient GSTIN
                            </Label>
                            <p>{show(shipment.recipient_gstin)}</p>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Place</Label>
                            <p>{show(shipment.recipient_place)}</p>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">Valid Until</Label>
                            <p>
                              {shipment.valid_until
                                ? new Date(shipment.valid_until).toLocaleString("en-GB")
                                : "—"}
                            </p>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">
                              E-Way Bill Status
                            </Label>
                            <p>{show(shipment.eway_bill_status)}</p>
                          </div>
                          <div>
                            <Label className="text-[11px] text-muted-foreground">
                              Transfer Result
                            </Label>
                            <p>
                              {item.transfer_status === "transferred" ? "Transferred" : "Failed"}
                            </p>
                          </div>
                        </div>
                        {item.transfer_error && (
                          <p className="px-3 py-2 text-xs text-destructive">
                            {item.transfer_error}
                          </p>
                        )}
                        <div className="border-t border-border/70">
                          <h4 className="px-3 pt-3 text-sm font-medium">Goods</h4>
                          <GoodsTable items={shipment.shipment_items ?? []} />
                        </div>
                      </section>
                    );
                  })}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No consignment details are linked to this manifest.
          </div>
        )}
      </section>
    </div>
  );
}

export function LtmsManifestList({
  onSidebarVisibilityChange,
}: {
  onSidebarVisibilityChange?: (visible: boolean) => void;
}) {
  const { user } = useSession();
  const role = user?.role;
  const branchIdsKey = (user?.branchIds ?? []).join(",");
  const branchIds = useMemo(() => (branchIdsKey ? branchIdsKey.split(",") : []), [branchIdsKey]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [transporterId, setTransporterId] = useState("");
  const [profile, setProfile] = useState<TransporterFields>(EMPTY_TRANSPORTER);
  const [rows, setRows] = useState<Consignment[]>([]);
  const [history, setHistory] = useState<ManifestHistoryRow[]>([]);
  const [selectedManifest, setSelectedManifest] = useState<ManifestHistoryRow | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [statusFilter, setStatusFilter] = useState("pending");
  const [historyMonth, setHistoryMonth] = useState(new Date().toISOString().slice(0, 7));
  const [historyTransporterFilterId, setHistoryTransporterFilterId] = useState("");
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        const rowStatus = row.transporter_update_status || "pending";
        const statusMatch =
          statusFilter === "all" ||
          (statusFilter === "transferred"
            ? rowStatus === "updated"
            : statusFilter === "pending"
              ? rowStatus !== "updated"
              : rowStatus === "partial");
        const monthMatch = !month || String(row.created_at ?? "").slice(0, 7) === month;
        const text =
          `${row.consignment_number} ${row.from_pin_code} ${row.to_pin_code} ${row.branch?.branch_name ?? ""} ${row.shipments.map((item) => `${item.eway_bill_number} ${item.recipient_trade_name ?? ""} ${item.recipient_gstin ?? ""}`).join(" ")}`.toLowerCase();
        return (
          statusMatch &&
          monthMatch &&
          (!search.trim() || text.includes(search.trim().toLowerCase()))
        );
      }),
    [rows, statusFilter, month, search],
  );

  const filteredHistory = useMemo(
    () =>
      history.filter((row) => {
        const monthMatch =
          !historyMonth || String(row.created_at ?? "").slice(0, 7) === historyMonth;
        const selectedTransporter = transporters.find(
          (transporter) => transporter.id === historyTransporterFilterId,
        );
        const transporterMatch =
          !historyTransporterFilterId ||
          row.transporter_id === historyTransporterFilterId ||
          String(row.transporter_name ?? "")
            .trim()
            .toLowerCase() ===
            String(selectedTransporter?.transporter_name ?? "")
              .trim()
              .toLowerCase();
        const searchMatch =
          !historySearch.trim() ||
          String(row.manifest_number ?? "")
            .toLowerCase()
            .includes(historySearch.trim().toLowerCase());
        return monthMatch && transporterMatch && searchMatch;
      }),
    [history, historyMonth, historyTransporterFilterId, historySearch, transporters],
  );

  const loadTransporters = useCallback(async () => {
    const { data, error } = await db
      .from("ltms_transporters")
      .select("*")
      .order("transporter_name");
    if (error) toast.error(error.message);
    const list = (data ?? []) as Transporter[];
    setTransporters(list);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const allowedBranches = role === "basic" ? branchIds : null;
    let manifestQuery = db
      .from("ltms_manifest_transfers")
      .select(
        "id,branch_id,manifest_number,transporter_id,transporter_name,transporter_gstin,transfer_status,eway_bill_count,created_at,branch:branches(branch_name),transporter:ltms_transporters(*),items:ltms_manifest_transfer_items(id,consignment_id,consignment_number,shipment_id,eway_bill_number,transfer_status,transfer_error,consignment:consignments(id,consignment_number,consignment_type,movement_mode,from_pin_code,to_pin_code,from_details,to_details,transporter_update_status,created_at,branch:branches(branch_name)),shipment:shipments(id,eway_bill_number,eway_bill_status,recipient_trade_name,recipient_gstin,recipient_place,recipient_pin_code,dispatch_from_place,dispatch_from_pin_code,ship_to_place,ship_to_pin_code,valid_until,transporter_update_status,transporter_update_error,shipment_items(id,product_name,description,hsn_code,quantity,unit,taxable_value,cgst_rate,sgst_rate,igst_rate,cess_rate,cess_nonadvol,total_invoice_value)))",
      )
      .order("created_at", { ascending: false });
    if (allowedBranches !== null) {
      const ids = allowedBranches.length
        ? allowedBranches
        : ["00000000-0000-0000-0000-000000000000"];
      manifestQuery = manifestQuery.in("branch_id", ids);
    }
    let consignmentPromise: Promise<any> = Promise.resolve({ data: [], error: null });
    if (transporterId) {
      let consignmentQuery = db
        .from("consignments")
        .select(
          "id,consignment_number,branch_id,consignment_type,movement_mode,from_pin_code,to_pin_code,transporter_id,transporter_update_status,transporter_update_error,created_at,branch:branches(branch_name)",
        )
        .eq("transporter_id", transporterId)
        .order("created_at", { ascending: false });
      if (allowedBranches !== null) {
        consignmentQuery = consignmentQuery.in(
          "branch_id",
          allowedBranches.length ? allowedBranches : ["00000000-0000-0000-0000-000000000000"],
        );
      }
      consignmentPromise = consignmentQuery;
    }
    const [consignmentResult, historyResult] = await Promise.all([
      consignmentPromise,
      manifestQuery,
    ]);
    if (consignmentResult.error)
      toast.error(`Could not load consignments: ${consignmentResult.error.message}`);
    if (historyResult.error)
      toast.error(`Could not load manifest history: ${historyResult.error.message}`);
    const consignments = (consignmentResult.data ?? []) as any[];
    const ids = consignments.map((row) => row.id);
    const shipmentResult = ids.length
      ? await db
          .from("shipments")
          .select(
            "id,consignment_id,eway_bill_number,eway_bill_status,recipient_trade_name,recipient_gstin,recipient_place,valid_until,transporter_update_status,transporter_update_error,shipment_items(id,product_name,description,hsn_code,quantity,unit,taxable_value,cgst_rate,sgst_rate,igst_rate,cess_rate,cess_nonadvol,total_invoice_value)",
          )
          .in("consignment_id", ids)
      : { data: [], error: null };
    if (shipmentResult.error)
      toast.error(`Could not load E-Way Bills: ${shipmentResult.error.message}`);
    const byConsignment = new Map<string, Shipment[]>();
    for (const shipment of shipmentResult.data ?? []) {
      const list = byConsignment.get(shipment.consignment_id) ?? [];
      list.push(shipment);
      byConsignment.set(shipment.consignment_id, list);
    }
    setRows(consignments.map((row) => ({ ...row, shipments: byConsignment.get(row.id) ?? [] })));
    setHistory((historyResult.data ?? []) as ManifestHistoryRow[]);
    setSelectedIds([]);
    setLoading(false);
  }, [role, branchIds, transporterId]);

  useEffect(() => {
    void loadTransporters();
  }, [loadTransporters]);
  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => {
    const selected = transporters.find((item) => item.id === transporterId);
    setProfile(selected ? profileFromTransporter(selected) : EMPTY_TRANSPORTER);
  }, [transporterId, transporters]);

  function setProfileValue(key: keyof TransporterFields, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function updateTransporter() {
    const gstin = profile.gstin.trim().toUpperCase();
    if (!/^\d{2}[0-9A-Z]{13}$/.test(gstin)) return toast.error("Enter a valid transporter GSTIN");
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
    if (!selectedRows.length) return toast.error("Select at least one consignment");
    if (!user?.sessionToken) return toast.error("Your session has expired. Please sign in again.");
    const selectedShipments = selectedRows.flatMap((row) =>
      row.shipments
        .filter((shipment) => shipment.transporter_update_status !== "updated")
        .map((shipment) => ({ row, shipment })),
    );
    const validEwayBills = selectedShipments.filter(({ shipment }) =>
      /^\d{12}$/.test(String(shipment.eway_bill_number ?? "")),
    );
    if (!validEwayBills.length)
      return toast.error("The selected consignments do not contain a valid, pending E-Way Bill");

    setTransferring(true);
    try {
      const byBranch = new Map<string, Array<{ row: Consignment; shipment: Shipment }>>();
      for (const entry of selectedShipments) {
        const list = byBranch.get(entry.row.branch_id) ?? [];
        list.push(entry);
        byBranch.set(entry.row.branch_id, list);
      }
      for (const [branchId, branchEntries] of byBranch) {
        const entriesByEwb = new Map<string, Array<{ row: Consignment; shipment: Shipment }>>();
        for (const entry of branchEntries) {
          const number = String(entry.shipment.eway_bill_number ?? "");
          if (!/^\d{12}$/.test(number)) continue;
          const list = entriesByEwb.get(number) ?? [];
          list.push(entry);
          entriesByEwb.set(number, list);
        }
        const ewayBillNumbers = [...entriesByEwb.keys()];
        const results = new Map<string, { ok: boolean; error?: string }>();
        for (let offset = 0; offset < ewayBillNumbers.length; offset += 100) {
          const result = await serverTransferManifestLrs({
            data: {
              sessionToken: user.sessionToken,
              branchId,
              partnerGstin: gstin,
              ewayBillNumbers: ewayBillNumbers.slice(offset, offset + 100),
            },
          });
          for (const item of result.results)
            results.set(item.ewayBillNumber, { ok: item.ok, error: item.error });
        }
        const manifestItems = branchEntries.map(({ row, shipment }) => {
          const ewayBillNumber = String(shipment.eway_bill_number ?? "");
          const result = /^\d{12}$/.test(ewayBillNumber) ? results.get(ewayBillNumber) : undefined;
          return {
            consignment_id: row.id,
            consignment_number: row.consignment_number,
            shipment_id: shipment.id,
            eway_bill_number: /^\d{12}$/.test(ewayBillNumber) ? ewayBillNumber : "",
            transfer_status: result?.ok ? ("transferred" as const) : ("failed" as const),
            transfer_error: result?.ok
              ? ""
              : (result?.error ?? "Shipment has no valid E-Way Bill number"),
          };
        });
        const saved = await serverRecordLtmsManifestTransfer({
          data: {
            sessionToken: user.sessionToken,
            branchId,
            transporterId: transporterId || null,
            transporterName: profile.transporter_name.trim() || "ORCA",
            transporterGstin: gstin,
            items: manifestItems,
          },
        });
        toast[saved.transferStatus === "transferred" ? "success" : "error"](
          `Manifest ${saved.manifestNumber} recorded for ${profile.transporter_name || "ORCA"} (${saved.transferStatus})`,
        );
      }
      const failed = rows
        .filter((row) => selectedIds.includes(row.id))
        .flatMap((row) =>
          row.shipments.filter((shipment) => shipment.transporter_update_status !== "updated"),
        )
        .filter((shipment) => !/^\d{12}$/.test(String(shipment.eway_bill_number ?? "")));
      if (failed.length)
        toast.error(`${failed.length} shipment(s) have no valid E-Way Bill and were not sent`);
      await loadData();
      setIsCreating(false);
      onSidebarVisibilityChange?.(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Transfer failed; no success was recorded",
      );
    } finally {
      setTransferring(false);
    }
  }

  if (selectedManifest) {
    return (
      <ManifestDetailView
        manifest={selectedManifest}
        onBack={() => {
          setSelectedManifest(null);
          onSidebarVisibilityChange?.(true);
        }}
      />
    );
  }

  if (!isCreating) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Manifest Transfer History</h2>
            <p className="text-sm text-muted-foreground">
              Each recorded transfer has its generated manifest number and transfer details.
            </p>
          </div>
          <Button
            onClick={() => {
              setSelectedIds([]);
              setTransporterId("");
              setProfile(EMPTY_TRANSPORTER);
              setStatusFilter("pending");
              setIsCreating(true);
              onSidebarVisibilityChange?.(false);
            }}
          >
            <Plus className="mr-2 size-4" />
            Create Manifest
          </Button>
        </div>
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <Input
            className="w-48"
            type="month"
            aria-label="Manifest history month"
            value={historyMonth}
            onChange={(event) => setHistoryMonth(event.target.value)}
          />
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by manifest number"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
          </div>
          <Select
            value={historyTransporterFilterId || "all"}
            onValueChange={(value) => setHistoryTransporterFilterId(value === "all" ? "" : value)}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="All transporters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All transporters</SelectItem>
              {transporters.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.transporter_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
        <section className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Manifest Number</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Transporter</th>
                <th className="px-3 py-2">GSTIN</th>
                <th className="px-3 py-2">E-Way Bills</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : filteredHistory.length ? (
                filteredHistory.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 font-semibold">{row.manifest_number}</td>
                    <td className="px-3 py-2">{row.branch?.branch_name || "—"}</td>
                    <td className="px-3 py-2">
                      {row.transporter?.transporter_name || row.transporter_name || "—"}
                    </td>
                    <td className="px-3 py-2">{row.transporter_gstin}</td>
                    <td className="px-3 py-2">{row.eway_bill_count}</td>
                    <td className="px-3 py-2">
                      <TransferBadge status={row.transfer_status} />
                    </td>
                    <td className="px-3 py-2">
                      {row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedManifest(row);
                          onSidebarVisibilityChange?.(false);
                        }}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No manifest transfer history for these filters yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3 border-b border-border pb-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setIsCreating(false);
            onSidebarVisibilityChange?.(true);
          }}
          aria-label="Back to manifest history"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">Create Manifest</h2>
          <p className="text-sm text-muted-foreground">
            Choose consignments, update their transporter, and record the transfer.
          </p>
        </div>
      </header>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label>Transporter</Label>
            <Select
              value={transporterId}
              onValueChange={(value) => {
                setTransporterId(value);
                setSelectedIds([]);
                setRows([]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select transporter" />
              </SelectTrigger>
              <SelectContent>
                {transporters.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.transporter_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="pb-2 text-xs text-muted-foreground">
            Transporter details stay visible even when no saved transporter is selected.
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TRANSPORTER_FIELDS.map(({ label, key }) => (
            <div key={key} className="space-y-1.5">
              <Label
                htmlFor={`manifest-transporter-${key}`}
                className="text-xs text-muted-foreground"
              >
                {label}
              </Label>
              <Input
                id={`manifest-transporter-${key}`}
                value={profile[key]}
                onChange={(event) => setProfileValue(key, event.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      {transporterId ? (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-60 flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search consignment or E-Way Bill"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Input
                className="w-44"
                type="month"
                aria-label="Manifest month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Transferred or pending</SelectItem>
                  <SelectItem value="transferred">Transferred</SelectItem>
                  <SelectItem value="pending">Not yet transferred</SelectItem>
                  <SelectItem value="partial">Partially transferred</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
                <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                onClick={() => void updateTransporter()}
                disabled={transferring || selectedIds.length === 0}
              >
                {transferring ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Check className="mr-2 size-4" />
                )}
                Create Manifest & Transfer ({selectedIds.length})
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Consignments ({visibleRows.length})</h3>
              <span className="text-xs text-muted-foreground">
                The list remains visible while filters are changed.
              </span>
            </div>
            {loading ? (
              <div className="flex items-center justify-center rounded-xl border border-border p-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading consignments…
              </div>
            ) : visibleRows.length ? (
              visibleRows.map((row) => (
                <ConsignmentRow
                  key={row.id}
                  row={row}
                  selected={selectedIds.includes(row.id)}
                  onToggle={() => toggle(row.id)}
                />
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No consignments match the selected month, transporter, and status filters.
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Select a transporter to load its consignments.
        </div>
      )}
    </div>
  );
}
