import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  Search,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SearchBy = "consignment" | "consignor" | "consignee";
type DocumentKind = "front" | "back" | "signature";
type Details = Record<string, unknown>;
type POD = {
  id: string;
  delivery_date: string;
  transporter_lr_number: string | null;
  transporter_lr_date: string | null;
  front_copy_path: string | null;
  back_copy_path: string | null;
  signature_copy_path: string | null;
  created_at: string;
};
type Consignment = {
  id: string;
  consignment_number: string;
  consignment_date: string | null;
  branch_id: string;
  consignment_type: "own" | "third_party";
  movement_mode: "pickup" | "drop";
  from_details: Details | null;
  to_details: Details | null;
  from_pin_code: string | null;
  to_pin_code: string | null;
  delivery_date: string | null;
  transporter_lr_number: string | null;
  transporter_lr_date: string | null;
  branch?: { branch_name?: string } | null;
  source?: { contract_name?: string } | null;
  transporter?: { transporter_name?: string } | null;
  shipments?: Array<{
    supplier_trade_name?: string | null;
    recipient_trade_name?: string | null;
    supplier_pin_code?: string | null;
    recipient_pin_code?: string | null;
    shipment_items?: Array<{ quantity?: number | null; weight_kg?: number | null }>;
  }>;
  consignment_package_information?: Array<{
    package_type?: string | null;
    quantity?: number | null;
    weight_kg?: number | null;
  }>;
  trip?: {
    trip_code?: string | null;
    odometer_start?: number | null;
    odometer_end?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    vehicle?: { registration_number?: string | null } | null;
  } | null;
  outward_pod?: POD | POD[] | null;
};

type FormState = {
  delivery_date: string;
  transporter_lr_number: string;
  transporter_lr_date: string;
};
const emptyFiles: Record<DocumentKind, File | null> = { front: null, back: null, signature: null };
const emptyUrls: Record<DocumentKind, string | null> = { front: null, back: null, signature: null };
// This screen queries tables added by migrations that are not present in the generated client types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).join(" ");
  return "";
}
function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
function party(row: Consignment, kind: "consignor" | "consignee") {
  const shipment = row.shipments?.[0];
  const detail = kind === "consignor" ? row.from_details : row.to_details;
  return (
    (kind === "consignor" ? shipment?.supplier_trade_name : shipment?.recipient_trade_name) ||
    text(detail?.[kind === "consignor" ? "supplier_trade_name" : "recipient_trade_name"]) ||
    text(detail?.[kind === "consignor" ? "trade_name" : "trade_name"]) ||
    "—"
  );
}
function destination(row: Consignment) {
  return text(row.to_details) || row.to_pin_code || "—";
}
function shipmentTotals(row: Consignment) {
  const items = (row.shipments ?? []).flatMap((shipment) => shipment.shipment_items ?? []);
  return {
    quantity: items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    weight: items.reduce((sum, item) => sum + Number(item.weight_kg ?? 0), 0),
  };
}
function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function isImage(fileOrUrl: File | string | null) {
  return Boolean(
    fileOrUrl &&
    (typeof fileOrUrl === "string"
      ? !fileOrUrl.toLowerCase().includes(".pdf")
      : fileOrUrl.type.startsWith("image/")),
  );
}

async function downloadDocument(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Download failed");
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function OutwardPOD() {
  const { user } = useSession();
  const branches = useBranches();
  const allowed = user?.role === "basic" ? (user.branchIds ?? []) : null;
  const [rows, setRows] = useState<Consignment[]>([]);
  const [searchBy, setSearchBy] = useState<SearchBy>("consignment");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Consignment[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Consignment | null>(null);
  const [form, setForm] = useState<FormState>({
    delivery_date: "",
    transporter_lr_number: "",
    transporter_lr_date: "",
  });
  const [files, setFiles] = useState(emptyFiles);
  const [urls, setUrls] = useState(emptyUrls);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [screen, setScreen] = useState<"list" | "create">("list");
  const [podSearch, setPodSearch] = useState("");
  const [podMonth, setPodMonth] = useState("");
  const [podVisibleCount, setPodVisibleCount] = useState(25);

  async function loadRows() {
    setLoading(true);
    try {
      let query = db
        .from("consignments")
        .select(
          "id,consignment_number,consignment_date,branch_id,consignment_type,movement_mode,from_details,to_details,from_pin_code,to_pin_code,delivery_date,transporter_lr_number,transporter_lr_date,branch:branches(branch_name),source:contracts(contract_name),transporter:ltms_transporters(transporter_name),shipments(supplier_trade_name,recipient_trade_name,supplier_pin_code,recipient_pin_code,shipment_items(quantity,weight_kg)),consignment_package_information(package_type,quantity,weight_kg),trip:trips(trip_code,odometer_start,odometer_end,start_date,end_date,vehicle:vehicles(registration_number)),outward_pod:outward_pods(id,delivery_date,transporter_lr_number,transporter_lr_date,front_copy_path,back_copy_path,signature_copy_path,created_at)",
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      if (allowed !== null) query = query.in("branch_id", allowed);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data ?? []) as Consignment[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load consignments");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (allowed === null || allowed.length) void loadRows();
  }, [allowed === null, allowed?.length]);

  const candidates = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return [];
    return rows
      .filter((row) => {
        if (first(row.outward_pod)) return false;
        if (searchBy === "consignment")
          return row.consignment_number.toLowerCase().includes(needle);
        return party(row, searchBy).toLowerCase().includes(needle);
      })
      .slice(0, 50);
  }, [rows, searchBy, searchTerm]);

  function runSearch() {
    const result = candidates;
    setSearchResults(result);
    setSearchOpen(true);
    if (!result.length) toast.info("No matching consignments found");
  }
  async function selectConsignment(row: Consignment) {
    setSelected(row);
    setSearchOpen(false);
    const existing = first(row.outward_pod);
    setForm({
      delivery_date: existing?.delivery_date ?? row.delivery_date ?? "",
      transporter_lr_number: existing?.transporter_lr_number ?? row.transporter_lr_number ?? "",
      transporter_lr_date: existing?.transporter_lr_date ?? row.transporter_lr_date ?? "",
    });
    setFiles({ ...emptyFiles });
    setUrls({ ...emptyUrls });
    if (existing) {
      const paths: Partial<Record<DocumentKind, string>> = {
        front: existing.front_copy_path,
        back: existing.back_copy_path,
        signature: existing.signature_copy_path,
      };
      const next = { ...emptyUrls };
      await Promise.all(
        (Object.keys(paths) as DocumentKind[]).map(async (kind) => {
          const path = paths[kind];
          if (!path) return;
          const { data, error } = await supabase.storage
            .from("outward-pod-documents")
            .createSignedUrl(path, 600);
          if (!error && data?.signedUrl) next[kind] = data.signedUrl;
        }),
      );
      setUrls(next);
    }
  }
  function chooseFile(kind: DocumentKind, file: File | undefined) {
    if (!file) return;
    const allowedType = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!allowedType) return toast.error("Upload an image or PDF file");
    if (file.size > 20 * 1024 * 1024) return toast.error("Each document must be 20 MB or smaller");
    if (urls[kind]?.startsWith("blob:")) URL.revokeObjectURL(urls[kind] as string);
    setFiles((current) => ({ ...current, [kind]: file }));
    setUrls((current) => ({ ...current, [kind]: URL.createObjectURL(file) }));
  }
  function removeDraftFile(kind: DocumentKind) {
    if (urls[kind]?.startsWith("blob:")) URL.revokeObjectURL(urls[kind] as string);
    setFiles((current) => ({ ...current, [kind]: null }));
    setUrls((current) => ({ ...current, [kind]: null }));
  }
  async function createPOD() {
    if (!selected || first(selected.outward_pod)) return;
    if (!form.delivery_date) return toast.error("Delivery date is required");
    if (!files.front && !files.back && !files.signature)
      return toast.error("Upload at least one of Front, Back or Signature copy");
    if (
      selected.consignment_type === "third_party" &&
      (!form.transporter_lr_number.trim() || !form.transporter_lr_date)
    ) {
      return toast.error(
        "Transporter LR number and date are required for third-party consignments",
      );
    }
    setCreating(true);
    const uploaded: string[] = [];
    try {
      const paths: Record<DocumentKind, string | null> = {
        front: null,
        back: null,
        signature: null,
      };
      for (const kind of ["front", "back", "signature"] as DocumentKind[]) {
        const file = files[kind];
        if (!file) continue;
        const path = `${user?.id ?? "user"}/${selected.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
        const { error } = await supabase.storage
          .from("outward-pod-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        uploaded.push(path);
        paths[kind] = path;
      }
      const { error: updateError } = await db
        .from("consignments")
        .update({
          delivery_date: form.delivery_date,
          transporter_lr_number:
            selected.consignment_type === "third_party" ? form.transporter_lr_number.trim() : null,
          transporter_lr_date:
            selected.consignment_type === "third_party" ? form.transporter_lr_date : null,
        })
        .eq("id", selected.id);
      if (updateError) throw updateError;
      const { error: podError } = await db.from("outward_pods").insert({
        consignment_id: selected.id,
        delivery_date: form.delivery_date,
        transporter_lr_number:
          selected.consignment_type === "third_party" ? form.transporter_lr_number.trim() : null,
        transporter_lr_date:
          selected.consignment_type === "third_party" ? form.transporter_lr_date : null,
        front_copy_path: paths.front,
        back_copy_path: paths.back,
        signature_copy_path: paths.signature,
        created_by: user?.id ?? null,
      });
      if (podError) throw podError;
      toast.success("Outward POD created. It is now view-only.");
      setSelected(null);
      setScreen("list");
      await loadRows();
      const refreshed = rows.find((row) => row.id === selected.id);
      if (refreshed)
        await selectConsignment({
          ...refreshed,
          outward_pod: {
            id: "",
            ...paths,
            delivery_date: form.delivery_date,
            transporter_lr_number: form.transporter_lr_number,
            transporter_lr_date: form.transporter_lr_date,
            created_at: new Date().toISOString(),
          } as POD,
        });
    } catch (error) {
      if (uploaded.length) await supabase.storage.from("outward-pod-documents").remove(uploaded);
      toast.error(error instanceof Error ? error.message : "Could not create Outward POD");
    } finally {
      setCreating(false);
    }
  }
  const existing = first(selected?.outward_pod);
  const totals = selected ? shipmentTotals(selected) : { quantity: 0, weight: 0 };
  const packageCount =
    selected?.consignment_package_information?.reduce(
      (sum, item) => sum + Number(item.quantity ?? 0),
      0,
    ) ?? 0;
  const trip = selected?.trip;
  const isThirdParty = selected?.consignment_type === "third_party";
  const podRows = useMemo(() => rows.filter((row) => Boolean(first(row.outward_pod))), [rows]);
  const filteredPodRows = useMemo(() => {
    const search = podSearch.trim().toLowerCase();
    return podRows.filter((row) => {
      const pod = first(row.outward_pod);
      const matchesSearch = !search || row.consignment_number.toLowerCase().includes(search);
      const matchesMonth = !podMonth || pod?.created_at?.slice(0, 7) === podMonth;
      return matchesSearch && matchesMonth;
    });
  }, [podRows, podSearch, podMonth]);
  const visiblePodRows = filteredPodRows.slice(0, podVisibleCount);

  if (screen === "list") {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div>
            <h2 className="font-semibold">Outward POD List</h2>
            <p className="text-xs text-muted-foreground">
              Showing the latest 25 created PODs by default. Use filters or Load more for older
              records.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => {
              setSelected(null);
              setScreen("create");
            }}
          >
            <Upload className="mr-2 size-4" />
            Create POD
          </Button>
        </div>
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={podSearch}
              onChange={(event) => {
                setPodSearch(event.target.value);
                setPodVisibleCount(25);
              }}
              className="pl-9"
              placeholder="Search consignment number"
            />
          </div>
          <Input
            type="month"
            value={podMonth}
            onChange={(event) => {
              setPodMonth(event.target.value);
              setPodVisibleCount(25);
            }}
            aria-label="Filter PODs by month"
          />
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Consignment</th>
                <th className="px-4 py-3">Consignor</th>
                <th className="px-4 py-3">Consignee</th>
                <th className="px-4 py-3">Delivery Date</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPodRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No Outward POD records created yet.
                  </td>
                </tr>
              ) : (
                visiblePodRows.map((row) => {
                  const pod = first(row.outward_pod) as POD;
                  return (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-4 py-3 font-semibold">{row.consignment_number}</td>
                      <td className="px-4 py-3">{party(row, "consignor")}</td>
                      <td className="px-4 py-3">{party(row, "consignee")}</td>
                      <td className="px-4 py-3">{pod.delivery_date || "—"}</td>
                      <td className="px-4 py-3">
                        {pod.created_at ? new Date(pod.created_at).toLocaleString("en-IN") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void selectConsignment(row);
                            setScreen("create");
                          }}
                        >
                          <Eye className="mr-1.5 size-3.5" />
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
        {visiblePodRows.length < filteredPodRows.length && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPodVisibleCount((count) => count + 25)}
            >
              Load more ({filteredPodRows.length - visiblePodRows.length} remaining)
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="font-semibold">Create Outward POD</h2>
          <p className="text-xs text-muted-foreground">
            Select a consignment and complete the POD documents.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setScreen("list");
            setSelected(null);
          }}
        >
          Back to POD List
        </Button>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Outward POD</h2>
            <p className="text-xs text-muted-foreground">
              Select one consignment, consignor or consignee to create its proof of delivery.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadRows()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <CalendarDays className="mr-2 size-4" />
            )}
            Reload
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Search by</label>
            <Select
              value={searchBy}
              onValueChange={(value: SearchBy) => {
                setSearchBy(value);
                setSearchTerm("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consignment">Consignment</SelectItem>
                <SelectItem value="consignor">Consignor</SelectItem>
                <SelectItem value="consignee">Consignee</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-64 flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type to search</label>
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
              placeholder={`Search ${searchBy}…`}
            />
          </div>
          <Button type="button" onClick={runSearch} disabled={!searchTerm.trim()}>
            <Search className="mr-2 size-4" />
            Search
          </Button>
        </div>
      </div>

      {selected && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <section className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Selected consignment
                </p>
                <h3 className="text-xl font-semibold">{selected.consignment_number}</h3>
                <p className="text-xs text-muted-foreground">
                  {selected.consignment_type === "third_party" ? "Third Party" : "Own"} ·{" "}
                  {selected.movement_mode === "drop" ? "Drop" : "Pickup"}
                </p>
              </div>
              {existing ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600">
                  <CheckCircle2 className="size-3.5" />
                  Created · View only
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Consignment Date" value={selected.consignment_date} />
              <Info label="Source" value={selected.source?.contract_name} />
              <Info label="Destination" value={destination(selected)} />
              <Info label="Consignor" value={party(selected, "consignor")} />
              <Info label="Consignee" value={party(selected, "consignee")} />
              <Info label="Shipment quantity" value={totals.quantity} />
              <Info label="Weight" value={totals.weight ? `${totals.weight} KG` : "—"} />
              <Info label="Packages (Pkgs.)" value={packageCount || "—"} />
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Truck className="size-4 text-primary" />
                Vehicle / trip information
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Info label="Vehicle No." value={trip?.vehicle?.registration_number} />
                <Info label="Trip No." value={trip?.trip_code} />
                <Info label="Start ODM" value={trip?.odometer_start} />
                <Info label="End ODM" value={trip?.odometer_end} />
                <Info
                  label="Dist. (KM)"
                  value={
                    trip && trip.odometer_start != null && trip.odometer_end != null
                      ? Number(trip.odometer_end) - Number(trip.odometer_start)
                      : "—"
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Delivery date *</label>
                <Input
                  type="date"
                  value={form.delivery_date}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, delivery_date: event.target.value }))
                  }
                  disabled={Boolean(existing)}
                />
              </div>
              {isThirdParty && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Transporter LR number *
                    </label>
                    <Input
                      value={form.transporter_lr_number}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          transporter_lr_number: event.target.value,
                        }))
                      }
                      disabled={Boolean(existing)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Transporter LR date *
                    </label>
                    <Input
                      type="date"
                      value={form.transporter_lr_date}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          transporter_lr_date: event.target.value,
                        }))
                      }
                      disabled={Boolean(existing)}
                    />
                  </div>
                </>
              )}
            </div>
            {!existing && (
              <Button
                type="button"
                className="w-full"
                onClick={() => void createPOD()}
                disabled={creating || uploading}
              >
                {creating ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 size-4" />
                )}
                Create POD
              </Button>
            )}
          </section>
          <section className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div>
              <h3 className="font-semibold">POD document area</h3>
              <p className="text-xs text-muted-foreground">
                Upload at least one image or PDF copy. After creation, documents are view-only.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["front", "back", "signature"] as DocumentKind[]).map((kind) => (
                <label
                  key={kind}
                  className={`flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs ${existing ? "cursor-default opacity-60" : "hover:bg-muted"}`}
                >
                  <Upload className="size-3.5" />
                  {kind === "front"
                    ? "Front Copy"
                    : kind === "back"
                      ? "Back Copy"
                      : "Signature Copy"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    disabled={Boolean(existing)}
                    onChange={(event) => chooseFile(kind, event.target.files?.[0])}
                  />
                </label>
              ))}
              <span className="flex items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-2 text-xs text-muted-foreground">
                <FileText className="size-3.5" />
                PDF / Image
              </span>
            </div>
            {(["front", "back", "signature"] as DocumentKind[]).map((kind) => (
              <DocumentPanel
                key={kind}
                kind={kind}
                url={urls[kind]}
                file={files[kind]}
                locked={Boolean(existing)}
                onRemove={() => removeDraftFile(kind)}
                onDownload={() =>
                  urls[kind]
                    ? void downloadDocument(
                        urls[kind] as string,
                        `${selected?.consignment_number ?? "pod"}-${kind}`,
                      )
                    : undefined
                }
              />
            ))}
          </section>
        </div>
      )}

      {!selected && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          <Search className="mx-auto mb-2 size-8 opacity-50" />
          Search and select a consignment to begin an Outward POD.
        </div>
      )}

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <h3 className="font-semibold">Select consignment</h3>
                <p className="text-xs text-muted-foreground">
                  {searchResults.length} matching result(s)
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSearchOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              {searchResults.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => void selectConsignment(row)}
                  className="mb-2 grid w-full gap-1 rounded-lg border border-border p-3 text-left hover:bg-muted sm:grid-cols-4"
                >
                  <span className="font-semibold">{row.consignment_number}</span>
                  <span>{party(row, "consignor")}</span>
                  <span>{party(row, "consignee")}</span>
                  <span className="text-muted-foreground">
                    {row.consignment_date || "—"} ·{" "}
                    {first(row.outward_pod) ? "POD created" : "POD pending"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">
        {value == null || value === "" ? "—" : String(value)}
      </div>
    </div>
  );
}
function DocumentPanel({
  kind,
  url,
  file,
  locked,
  onRemove,
  onDownload,
}: {
  kind: DocumentKind;
  url: string | null;
  file: File | null;
  locked: boolean;
  onRemove: () => void;
  onDownload: () => void;
}) {
  const label = kind === "front" ? "Front Copy" : kind === "back" ? "Back Copy" : "Signature Copy";
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs font-medium">
        <span>{label}</span>
        {url && !locked && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              title="View"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              <Eye className="size-3.5" />
            </button>
            <button type="button" title="Delete" onClick={onRemove}>
              <Trash2 className="size-3.5 text-destructive" />
            </button>
          </span>
        )}
        {url && locked && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              title="View"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              <Eye className="size-3.5 text-emerald-600" />
            </button>
            <button type="button" title="Download" onClick={onDownload}>
              <Download className="size-3.5 text-emerald-600" />
            </button>
          </span>
        )}
      </div>
      <div className="flex min-h-40 items-center justify-center bg-muted/10 p-2">
        {url ? (
          isImage(file || url) ? (
            <img src={url} alt={label} className="max-h-64 w-full object-contain" />
          ) : (
            <iframe title={label} src={url} className="h-64 w-full rounded border-0" />
          )
        ) : (
          <div className="text-center text-xs text-muted-foreground">
            <Upload className="mx-auto mb-2 size-6 opacity-50" />
            No document uploaded
          </div>
        )}
      </div>
      {file && (
        <div className="truncate px-3 pb-2 text-[11px] text-muted-foreground">{file.name}</div>
      )}
    </div>
  );
}
