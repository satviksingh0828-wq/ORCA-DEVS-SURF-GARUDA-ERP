import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  QrCode,
  Search,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { canManageOutwardPODDocument } from "@/lib/outward-pod-document-access";
import { printOutwardPOD } from "@/lib/outward-pod-pdf";
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
  updated_at?: string;
  updated_by?: string | null;
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
const allowedPODMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
// This screen queries tables added by migrations that are not present in the generated client types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function podApiUrl(operation: string, podId?: string) {
  const url = new URL("/api/mobile/outward-pod", window.location.origin);
  url.searchParams.set("operation", operation);
  if (podId) url.searchParams.set("podId", podId);
  return url.toString();
}

function consignmentManifestUrl(consignmentId: string) {
  const url = new URL("/api/mobile/outward-pod", window.location.origin);
  url.searchParams.set("operation", "manifest");
  url.searchParams.set("consignmentId", consignmentId);
  return url.toString();
}

function podManifestUrl(podId: string, mode?: "view") {
  const url = new URL("/api/mobile/outward-pod", window.location.origin);
  url.searchParams.set("operation", "manifest");
  url.searchParams.set("podId", podId);
  if (mode) url.searchParams.set("mode", mode);
  return url.toString();
}

async function podApiJson<T>(url: string, token: string | undefined, init: RequestInit = {}) {
  if (!token)
    throw new Error("Your ERP session has expired. Sign in again before managing POD documents.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload && typeof payload === "object" && payload.ok === false)) {
    throw new Error(
      payload && typeof payload === "object" && typeof payload.message === "string"
        ? payload.message
        : `POD request failed (${response.status}).`,
    );
  }
  return payload as T;
}

function podDocumentsChanged(a: POD | null, b: POD | null) {
  if (!a || !b) return a !== b;
  return (
    a.front_copy_path !== b.front_copy_path ||
    a.back_copy_path !== b.back_copy_path ||
    a.signature_copy_path !== b.signature_copy_path ||
    a.updated_at !== b.updated_at
  );
}

function uploadedDocumentCount(pod: POD | null | undefined) {
  if (!pod) return 0;
  return [pod.front_copy_path, pod.back_copy_path, pod.signature_copy_path].filter(Boolean).length;
}

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
  const canUsePODDocuments = (["view", "add", "replace"] as const).some((action) =>
    canManageOutwardPODDocument(user?.role, action),
  );
  const canAddPODDocuments = canManageOutwardPODDocument(user?.role, "add");
  const canEditMobileMetadata =
    canManageOutwardPODDocument(user?.role, "add") ||
    canManageOutwardPODDocument(user?.role, "replace");
  const allowed = useMemo(
    () => (user?.role === "basic" ? (user.branchIds ?? []) : null),
    [user?.role, user?.branchIds],
  );
  const [rows, setRows] = useState<Consignment[]>([]);
  const [searchBy, setSearchBy] = useState<SearchBy>("consignment");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Consignment[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Consignment | null>(null);
  const selectedRef = useRef<Consignment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [viewQrDataUrl, setViewQrDataUrl] = useState<string | null>(null);
  const [mobileEditQrDataUrl, setMobileEditQrDataUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [mobileEditQrLoading, setMobileEditQrLoading] = useState(false);
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

  const loadRows = useCallback(
    async (quiet = false): Promise<Consignment[]> => {
      if (!quiet) setLoading(true);
      try {
        let query = db
          .from("consignments")
          .select(
            "id,consignment_number,consignment_date,branch_id,consignment_type,movement_mode,from_details,to_details,from_pin_code,to_pin_code,delivery_date,transporter_lr_number,transporter_lr_date,branch:branches(branch_name),source:contracts(contract_name),transporter:ltms_transporters(transporter_name),shipments(supplier_trade_name,recipient_trade_name,supplier_pin_code,recipient_pin_code,shipment_items(quantity,weight_kg)),consignment_package_information(package_type,quantity,weight_kg),trip:trips(trip_code,odometer_start,odometer_end,start_date,end_date,vehicle:vehicles(registration_number)),outward_pod:outward_pods(id,delivery_date,transporter_lr_number,transporter_lr_date,front_copy_path,back_copy_path,signature_copy_path,created_at,updated_at,updated_by)",
          )
          .order("created_at", { ascending: false })
          .limit(2000);
        if (allowed !== null) query = query.in("branch_id", allowed);
        const { data, error } = await query;
        if (error) throw error;
        const nextRows = (data ?? []) as Consignment[];
        setRows(nextRows);
        return nextRows;
      } catch (error) {
        if (!quiet)
          toast.error(error instanceof Error ? error.message : "Could not load consignments");
        return [];
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [allowed],
  );

  const selectConsignment = useCallback(
    async (row: Consignment) => {
      selectedRef.current = row;
      setSelected(row);
      setSearchOpen(false);
      setQrDataUrl(null);
      setViewQrDataUrl(null);
      setMobileEditQrDataUrl(null);
      const existing = first(row.outward_pod);
      setForm({
        delivery_date: existing?.delivery_date ?? row.delivery_date ?? "",
        transporter_lr_number: existing?.transporter_lr_number ?? row.transporter_lr_number ?? "",
        transporter_lr_date: existing?.transporter_lr_date ?? row.transporter_lr_date ?? "",
      });
      setFiles({ ...emptyFiles });
      setUrls({ ...emptyUrls });
      if (!canUsePODDocuments) return;

      if (existing && canManageOutwardPODDocument(user?.role, "view")) {
        try {
          const result = await podApiJson<{ urls?: Partial<Record<DocumentKind, string>> }>(
            podApiUrl("links", existing.id),
            user?.sessionToken,
          );
          if (selectedRef.current?.id === row.id) {
            setUrls({ ...emptyUrls, ...(result.urls ?? {}) });
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not prepare POD previews");
        }
      }

      if (existing && canManageOutwardPODDocument(user?.role, "view")) {
        try {
          const dataUrl = await QRCode.toDataURL(podManifestUrl(existing.id, "view"), {
            width: 256,
            margin: 2,
            errorCorrectionLevel: "M",
          });
          if (selectedRef.current?.id === row.id) setViewQrDataUrl(dataUrl);
        } catch {
          toast.error("Could not create the view-only POD QR code");
        }
      }
      if (existing || !canAddPODDocuments) return;

      try {
        const manifestUrl = consignmentManifestUrl(row.id);
        const dataUrl = await QRCode.toDataURL(manifestUrl, {
          width: 256,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        if (selectedRef.current?.id === row.id) setQrDataUrl(dataUrl);
      } catch {
        toast.error("Could not create the POD mobile QR code");
      }
    },
    [canAddPODDocuments, canUsePODDocuments, user?.role, user?.sessionToken],
  );

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (allowed !== null && allowed.length === 0) return;
    void loadRows();
  }, [allowed, loadRows]);

  useEffect(() => {
    if (allowed !== null && allowed.length === 0) return;
    let active = true;
    const refresh = async () => {
      const nextRows = await loadRows(true);
      if (!active) return;
      const current = selectedRef.current;
      if (!current) return;
      const latest = nextRows.find((row) => row.id === current.id);
      if (!latest) return;
      const currentPod = first(current.outward_pod);
      const latestPod = first(latest.outward_pod);
      if (podDocumentsChanged(currentPod, latestPod)) {
        await selectConsignment(latest);
      }
    };
    const channel = supabase
      .channel("outward-pod-document-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "outward_pods" }, () => {
        void refresh();
      })
      .subscribe();
    const timer = window.setInterval(() => void refresh(), 12_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [allowed, loadRows, selectConsignment]);

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
  async function showMobileEditQr() {
    const pod = first(selected?.outward_pod);
    if (!selected || !pod || !canEditMobileMetadata) return;
    const selectedId = selected.id;
    setMobileEditQrLoading(true);
    try {
      const dataUrl = await QRCode.toDataURL(podManifestUrl(pod.id), {
        width: 256,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      if (selectedRef.current?.id === selectedId) setMobileEditQrDataUrl(dataUrl);
    } catch {
      toast.error("Could not create the mobile edit QR code");
    } finally {
      setMobileEditQrLoading(false);
    }
  }
  function chooseFile(kind: DocumentKind, file: File | undefined) {
    if (!file) return;
    const allowedType =
      allowedPODMimeTypes.has(file.type.toLowerCase()) ||
      /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (!allowedType) return toast.error("Upload a PDF, JPEG, PNG, WEBP, HEIC or HEIF file.");
    if (file.size > 20 * 1024 * 1024) return toast.error("Each document must be 20 MB or smaller");
    if (urls[kind]?.startsWith("blob:")) URL.revokeObjectURL(urls[kind] as string);
    setFiles((current) => ({ ...current, [kind]: file }));
    setUrls((current) => ({ ...current, [kind]: URL.createObjectURL(file) }));
  }
  function removeDraftFile(kind: DocumentKind) {
    if (urls[kind]?.startsWith("blob:")) URL.revokeObjectURL(urls[kind] as string);
    const current = selected;
    if (current && first(current.outward_pod)) {
      void selectConsignment(current);
      return;
    }
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
    try {
      const body = new FormData();
      body.set("consignmentId", selected.id);
      body.set("deliveryDate", form.delivery_date);
      body.set("transporterLrNumber", form.transporter_lr_number.trim());
      body.set("transporterLrDate", form.transporter_lr_date);
      for (const kind of ["front", "back", "signature"] as DocumentKind[]) {
        if (files[kind]) body.set(kind, files[kind] as File);
      }
      await podApiJson<{ ok: true }>(podApiUrl("create"), user?.sessionToken, {
        method: "POST",
        body,
      });
      toast.success(
        "Outward POD created. Scan its QR to add or replace documents from ORCA Documents.",
      );
      const refreshedRows = await loadRows(true);
      const refreshed = refreshedRows.find((row) => row.id === selected.id);
      if (refreshed) {
        await selectConsignment(refreshed);
        setScreen("create");
      } else {
        setSelected(null);
        setScreen("list");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create Outward POD");
    } finally {
      setCreating(false);
    }
  }

  async function saveExistingDocument(kind: DocumentKind) {
    const row = selected;
    const pod = first(row?.outward_pod);
    const file = files[kind];
    if (!row || !pod || !file) return;
    const savedPath =
      kind === "front"
        ? pod.front_copy_path
        : kind === "back"
          ? pod.back_copy_path
          : pod.signature_copy_path;
    const action = savedPath ? "replace" : "add";
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("action", action);
      body.set("recordId", pod.id);
      body.set("uploadId", kind);
      await podApiJson<{ ok: true }>(
        `${podApiUrl("upload", pod.id)}&kind=${encodeURIComponent(kind)}`,
        user?.sessionToken,
        { method: "POST", body },
      );
      toast.success(
        `${kind === "front" ? "Front" : kind === "back" ? "Back" : "Signature"} copy ${action === "add" ? "added" : "replaced"}.`,
      );
      const refreshedRows = await loadRows(true);
      const refreshed = refreshedRows.find((candidate) => candidate.id === row.id);
      if (refreshed) await selectConsignment(refreshed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the POD document");
    } finally {
      setUploading(false);
    }
  }
  const existing = first(selected?.outward_pod);
  async function exportExistingPODPdf() {
    if (!selected || !existing || !viewQrDataUrl) return;
    setPdfLoading(true);
    try {
      await printOutwardPOD({
        consignmentNumber: selected.consignment_number,
        consignmentDate: selected.consignment_date,
        consignor: party(selected, "consignor"),
        consignee: party(selected, "consignee"),
        destination: destination(selected),
        branchName: selected.branch?.branch_name,
        consignmentType: selected.consignment_type,
        deliveryDate: existing.delivery_date,
        transporterLrNumber: existing.transporter_lr_number,
        transporterLrDate: existing.transporter_lr_date,
        createdAt: existing.created_at,
        viewQrUrl: podManifestUrl(existing.id, "view"),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export the Outward POD PDF");
    } finally {
      setPdfLoading(false);
    }
  }
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
  const documentPanels = (["front", "back", "signature"] as DocumentKind[]).map((kind) => {
    const savedPath =
      kind === "front"
        ? existing?.front_copy_path
        : kind === "back"
          ? existing?.back_copy_path
          : existing?.signature_copy_path;
    return (
      <DocumentPanel
        key={kind}
        kind={kind}
        url={urls[kind]}
        file={files[kind]}
        existing={Boolean(existing)}
        hasSavedFile={Boolean(savedPath)}
        canView={canManageOutwardPODDocument(user?.role, "view")}
        canAdd={canManageOutwardPODDocument(user?.role, "add")}
        canReplace={canManageOutwardPODDocument(user?.role, "replace")}
        uploading={uploading}
        onChooseFile={(file) => chooseFile(kind, file)}
        onRemove={() => removeDraftFile(kind)}
        onSave={() => void saveExistingDocument(kind)}
        onDownload={() =>
          urls[kind]
            ? void downloadDocument(
                urls[kind] as string,
                `${selected?.consignment_number ?? "pod"}-${kind}`,
              )
            : undefined
        }
      />
    );
  });

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
                <th className="px-4 py-3">Documents</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPodRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
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
                        {uploadedDocumentCount(pod) > 0 ? (
                          <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600">
                            Uploaded ({uploadedDocumentCount(pod)}/3)
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No files uploaded</span>
                        )}
                      </td>
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
          <h2 className="font-semibold">{existing ? "View Outward POD" : "Create Outward POD"}</h2>
          <p className="text-xs text-muted-foreground">
            {existing
              ? "Review the POD details and uploaded document status."
              : "Select a consignment and complete the POD documents."}
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
            <h2 className="font-semibold">{existing ? "Outward POD details" : "Outward POD"}</h2>
            <p className="text-xs text-muted-foreground">
              {existing
                ? "View the current POD and its attachment status."
                : "Select one consignment, consignor or consignee to create its proof of delivery."}
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                {existing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pdfLoading || !viewQrDataUrl}
                    onClick={() => void exportExistingPODPdf()}
                  >
                    {pdfLoading ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 size-4" />
                    )}
                    Export PDF
                  </Button>
                ) : null}
                {existing && canEditMobileMetadata ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={mobileEditQrLoading}
                    onClick={() => void showMobileEditQr()}
                  >
                    {mobileEditQrLoading ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <QrCode className="mr-2 size-4" />
                    )}
                    {mobileEditQrDataUrl ? "Refresh mobile QR" : "Edit on mobile"}
                  </Button>
                ) : null}
                {existing ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                      uploadedDocumentCount(existing) > 0
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <CheckCircle2 className="size-3.5" />
                    {uploadedDocumentCount(existing) > 0
                      ? `Uploaded (${uploadedDocumentCount(existing)}/3)`
                      : "No files uploaded"}
                    {canUsePODDocuments
                      ? " · document actions available"
                      : " · no document actions"}
                  </span>
                ) : null}
              </div>
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
            {!existing && canAddPODDocuments ? (
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/20 p-3">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`Mobile upload QR for ${selected.consignment_number}`}
                    className="size-36 rounded bg-white p-2"
                  />
                ) : (
                  <div className="flex size-36 items-center justify-center rounded border border-dashed bg-card text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                )}
                <div className="min-w-48 flex-1">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <QrCode className="size-4" />
                    Scan with ORCA Documents
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This QR starts an Outward POD for the selected consignment. In ORCA Documents,
                    enter the delivery details and upload the first PDF/image; that upload creates
                    the POD. Further files can be added from the same scan.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void selectConsignment(selected)}
                  >
                    <QrCode className="mr-2 size-4" /> Refresh QR
                  </Button>
                </div>
              </div>
            ) : null}
            {existing && viewQrDataUrl ? (
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/20 p-3">
                <img
                  src={viewQrDataUrl}
                  alt={`View-only QR for ${selected.consignment_number}`}
                  className="size-36 rounded bg-white p-2"
                />
                <div className="min-w-48 flex-1">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <QrCode className="size-4" />
                    View-only QR
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Scan in ORCA Documents to view this existing Outward POD and its documents. This
                    QR cannot replace files or edit any data.
                  </p>
                </div>
              </div>
            ) : null}
            {existing && mobileEditQrDataUrl ? (
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/20 p-3">
                <img
                  src={mobileEditQrDataUrl}
                  alt={`Mobile edit QR for ${selected.consignment_number}`}
                  className="size-36 rounded bg-white p-2"
                />
                <div className="min-w-48 flex-1">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <QrCode className="size-4" />
                    Mobile edit mode
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Scan with ORCA Documents to update or clear permitted POD details, then sync
                    them to the ERP. The QR is hidden from the normal view until requested.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setMobileEditQrDataUrl(null)}
                  >
                    Hide QR
                  </Button>
                </div>
              </div>
            ) : null}
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
                {existing
                  ? "Each slot accepts an image or PDF. Empty slots can be added; existing files can be previewed or replaced."
                  : "Upload at least one image or PDF here, or scan the create-form QR and upload the first file from ORCA Documents."}
              </p>
            </div>
            {!existing ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["front", "back", "signature"] as DocumentKind[]).map((kind) => (
                  <label
                    key={kind}
                    className="flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs hover:bg-muted"
                  >
                    <Upload className="size-3.5" />
                    {kind === "front"
                      ? "Front Copy"
                      : kind === "back"
                        ? "Back Copy"
                        : "Signature Copy"}
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                      className="hidden"
                      onChange={(event) => chooseFile(kind, event.target.files?.[0])}
                    />
                  </label>
                ))}
                <span className="flex items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-2 text-xs text-muted-foreground">
                  <FileText className="size-3.5" />
                  PDF / Image
                </span>
              </div>
            ) : null}
            {documentPanels}
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
  existing,
  hasSavedFile,
  canView,
  canAdd,
  canReplace,
  uploading,
  onChooseFile,
  onRemove,
  onSave,
  onDownload,
}: {
  kind: DocumentKind;
  url: string | null;
  file: File | null;
  existing: boolean;
  hasSavedFile: boolean;
  canView: boolean;
  canAdd: boolean;
  canReplace: boolean;
  uploading: boolean;
  onChooseFile: (file: File | undefined) => void;
  onRemove: () => void;
  onSave: () => void;
  onDownload: () => void;
}) {
  const label = kind === "front" ? "Front Copy" : kind === "back" ? "Back Copy" : "Signature Copy";
  const mayUpload = hasSavedFile ? canReplace : canAdd;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs font-medium">
        <span>{label}</span>
        {canView && hasSavedFile && url && !file && (
          <span className="flex items-center gap-1">
            <button
              type="button"
              title="View current file"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              <Eye className="size-3.5" />
            </button>
            <button type="button" title="Download" onClick={onDownload}>
              <Download className="size-3.5" />
            </button>
          </span>
        )}
      </div>
      <div className="flex min-h-40 items-center justify-center bg-muted/10 p-2">
        {canView && url ? (
          isImage(file || url) ? (
            <img src={url} alt={label} className="max-h-64 w-full object-contain" />
          ) : (
            <iframe title={label} src={url} className="h-64 w-full rounded border-0" />
          )
        ) : (
          <div className="text-center text-xs text-muted-foreground">
            <Upload className="mx-auto mb-2 size-6 opacity-50" />
            {hasSavedFile
              ? canView
                ? "File attached; preview is unavailable."
                : "A file is attached, but viewing is not allowed for this account."
              : "No document uploaded"}
          </div>
        )}
      </div>
      {file && (
        <div className="truncate px-3 pb-2 text-[11px] text-muted-foreground">{file.name}</div>
      )}
      {existing ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border p-2">
          {mayUpload && !file ? (
            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted">
              <Upload className="size-3.5" />
              {hasSavedFile ? "Replace image / PDF" : "Add image / PDF"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  onChooseFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          ) : null}
          {file ? (
            <>
              <Button type="button" size="sm" disabled={uploading} onClick={onSave}>
                {uploading ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-3.5" />
                )}
                Save {hasSavedFile ? "replacement" : "document"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={onRemove}
              >
                <Trash2 className="mr-1.5 size-3.5" /> Cancel
              </Button>
            </>
          ) : null}
          {!mayUpload && !file ? (
            <span className="text-[11px] text-muted-foreground">
              Upload/replace is not allowed for this account.
            </span>
          ) : null}
          {uploading ? (
            <span className="text-[11px] text-muted-foreground">Saving securely…</span>
          ) : null}
        </div>
      ) : file ? (
        <div className="border-t border-border p-2">
          <Button type="button" size="sm" variant="outline" onClick={onRemove}>
            <Trash2 className="mr-1.5 size-3.5" /> Remove draft
          </Button>
        </div>
      ) : null}
    </div>
  );
}
