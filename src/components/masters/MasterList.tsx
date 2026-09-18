import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Plus,
  Search,
  Save,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { lookupIndiaPin } from "@/lib/india-post";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CsvIO } from "@/components/CsvIO";
import { BranchSelect } from "@/components/BranchSelect";
import { useBranches, branchName } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { fetchAll } from "@/lib/fetch-all";
import { logAction } from "@/lib/log-actions";
import { ItemLogsButton } from "@/components/shared/ItemLogsDrawer";
import { isDriverActive } from "@/lib/drivers";

export type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "email" | "date" | "number" | "file" | "ledger";
  options?: string[]; // if present → Select
  full?: boolean;
};
export type SectionDef = { title: string; fields: FieldDef[] };

export type MasterConfig = {
  table: "vehicles" | "drivers" | "transporters" | "locations";
  entityLabel: string; // "Vehicles"
  singular: string; // "vehicle"
  icon: LucideIcon;
  sections: SectionDef[];
  hasBranch: boolean;
  titleKey: string; // column used as primary display name
  subtitleKeys: string[]; // fields to join for subtitle
  emptyMsg: string;
};

type Row = Record<string, unknown> & { id?: string; branch_id?: string | null };
type PaymentLedger = {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: "bank" | "cash";
};

function DriverPhotoField({
  field,
  objectPath,
  uploading,
  locked,
  onFile,
}: {
  field: FieldDef;
  objectPath: string;
  uploading: boolean;
  locked: boolean;
  onFile: (file: File) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string>("");

  useEffect(() => {
    let active = true;
    if (!objectPath) {
      setPreviewUrl("");
      return;
    }
    void supabase.storage
      .from("driver-documents")
      .createSignedUrl(objectPath, 60 * 60)
      .then(({ data }) => {
        if (active) setPreviewUrl(data?.signedUrl ?? "");
      });
    return () => {
      active = false;
    };
  }, [objectPath]);

  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {field.label}
        <span className="text-destructive"> *</span>
      </Label>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
        <div className="flex h-40 items-center justify-center overflow-hidden bg-muted/40">
          {previewUrl ? (
            <img src={previewUrl} alt={field.label} className="h-full w-full object-contain" />
          ) : uploading ? (
            <Loader2 className="size-6 animate-spin text-primary" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Upload className="size-6" />
              <span className="text-xs">No photo uploaded</span>
            </div>
          )}
        </div>
        {locked ? (
          <div className="flex h-11 items-center justify-center border-t border-border px-3 text-xs font-medium text-muted-foreground">
            Uploaded photo cannot be replaced
          </div>
        ) : (
          <label className="flex h-11 cursor-pointer items-center justify-center gap-2 border-t border-border px-3 text-sm font-medium transition-colors hover:bg-muted/60">
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            <span>{objectPath ? "Replace photo" : "Upload photo"}</span>
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              required={field.required && !objectPath}
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

export function MasterList({
  config,
  renderExtraEditSections,
}: {
  config: MasterConfig;
  renderExtraEditSections?: (id: string, row: Row) => React.ReactNode;
}) {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [pinLooking, setPinLooking] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);
  const pinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLocations = config.table === "locations";
  const PAGE_SIZE = 100;
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [locationOffset, setLocationOffset] = useState(0);
  const [locationSearch, setLocationSearch] = useState("");
  const [locationSearchBy, setLocationSearchBy] = useState<"location_name" | "pin_code">("location_name");
  const branches = useBranches();
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";

  // For basic/viewer users, restrict data to their allowed branches
  const isBasic = user?.role === "basic";
  const allowedBranchIds = user?.role === "basic" ? (user?.branchIds ?? []) : null;

  const allFieldKeys = config.sections.flatMap((s) => s.fields.map((f) => f.key));
  const dateFieldKeys = new Set(
    config.sections.flatMap((section) =>
      section.fields.filter((field) => field.type === "date").map((field) => field.key),
    ),
  );
  const emptyRow: Row = Object.fromEntries(allFieldKeys.map((k) => [k, ""])) as Row;
  // Auto-fill branch when user has exactly one allowed branch
  if (config.hasBranch) {
    emptyRow.branch_id = allowedBranchIds?.length === 1 ? allowedBranchIds[0] : null;
  }

  const columns = [...allFieldKeys, ...(config.hasBranch ? ["branch_name"] : [])];

  async function load() {
    setLoading(true);
    setHasMore(false);
    setLocationOffset(0);
    try {
      // If basic user has no branches assigned, show nothing
      if (allowedBranchIds !== null && allowedBranchIds.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      if (isLocations) {
        let locationsQuery = supabase
          .from("locations")
          .select("*")
          .order("created_at", { ascending: true });
        const search = locationSearch.trim();
        if (search) locationsQuery = locationsQuery.ilike(locationSearchBy, `%${search}%`);
        const res = await (locationsQuery.range(0, PAGE_SIZE - 1) as unknown as Promise<{
          data: Row[] | null;
          error: { message: string } | null;
        }>);
        if (res.error) throw new Error(res.error.message);
        const rows = res.data ?? [];
        setItems(rows);
        setHasMore(rows.length === PAGE_SIZE);
        setLocationOffset(rows.length);
      } else {
        const rows = await fetchAll<Row>(() => {
          let q = supabase.from(config.table).select("*").order("created_at", { ascending: true });
          // Filter by allowed branches for basic users (only applies to branch-linked tables)
          if (allowedBranchIds !== null && config.hasBranch) {
            q = q.in("branch_id", allowedBranchIds) as typeof q;
          }
          return q;
        });
        setItems(rows);
      }
    } catch {
      toast.error(`Could not load ${config.entityLabel.toLowerCase()}`);
    }
    setLoading(false);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await (supabase
        .from("locations")
        .select("*")
        .order("created_at", { ascending: true })
        .range(locationOffset, locationOffset + PAGE_SIZE - 1) as unknown as Promise<{
        data: Row[] | null;
        error: { message: string } | null;
      }>);
      if (res.error) throw new Error(res.error.message);
      const rows = res.data ?? [];
      setItems((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      setLocationOffset((prev) => prev + rows.length);
    } catch {
      toast.error(`Could not load more locations`);
    }
    setLoadingMore(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.table, user?.id, locationSearch, locationSearchBy]);

  useEffect(() => {
    if (config.table !== "vehicles") return;
    void supabase
      .from("ledger_accounts")
      .select("id,branch_id,account_name,ledger_type")
      .in("ledger_type", ["bank", "cash"])
      .eq("is_active", true)
      .order("account_name")
      .then(({ data, error }) => {
        if (error) {
          toast.error("Could not load vehicle payment accounts");
          return;
        }
        setPaymentLedgers((data ?? []) as PaymentLedger[]);
      });
  }, [config.table]);

  const set = (k: string) => (v: string) => setEditing((f) => (f ? { ...f, [k]: v } : f));

  async function uploadDriverDocument(fieldKey: string, file: File) {
    const existingPath = String(editing?.[fieldKey] ?? "");
    if (isBasic && existingPath) {
      toast.error("Basic users cannot replace or delete an uploaded driver photo");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setUploadingField(fieldKey);
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const objectPath = `${crypto.randomUUID()}/${fieldKey}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from("driver-documents").upload(objectPath, file, {
      cacheControl: "3600",
      upsert: false,
    });
    setUploadingField(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    set(fieldKey)(objectPath);
    toast.success("Photo uploaded");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    const {
      id,
      created_at: _c,
      updated_at: _u,
      branch_name: _bn,
      ...rest
    } = editing as Row & {
      created_at?: unknown;
      updated_at?: unknown;
      branch_name?: unknown;
    };
    const payload = Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [
        key,
        dateFieldKeys.has(key) && value === "" ? null : value,
      ]),
    ) as never;
    const res = id
      ? await supabase.from(config.table).update(payload).eq("id", id)
      : await supabase.from(config.table).insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    const isNew = !id;
    const label = String(editing[config.titleKey] ?? "");
    logAction(isNew ? "created" : "updated", config.singular, {
      entityId: id ?? "",
      entityLabel: label,
    });
    toast.success(id ? `${config.singular} updated` : `${config.singular} created`);
    setEditing(null);
    load();
  }

  async function remove(item: Row) {
    if (!window.confirm(`Delete this ${config.singular}? This cannot be undone.`)) return;
    const { error } = await supabase.from(config.table).delete().eq("id", item.id!);
    if (error) return toast.error(error.message);
    logAction("deleted", config.singular, {
      entityId: String(item.id ?? ""),
      entityLabel: String(item[config.titleKey] ?? ""),
    });
    toast.success(`${config.singular} removed`);
    load();
  }

  async function onImport(rows: Record<string, string>[]) {
    const nameToId = new Map(branches.map((b) => [b.branch_name.toLowerCase(), b.id] as const));
    const payload = rows
      .filter((r) => (r[config.titleKey] || "").trim() !== "")
      .map((r) => {
        const o: Record<string, unknown> = {};
        for (const k of allFieldKeys) {
          const value = r[k] ?? "";
          o[k] = dateFieldKeys.has(k) && value === "" ? null : value;
        }
        if (config.hasBranch) {
          const n = (r.branch_name || "").trim().toLowerCase();
          o.branch_id = n ? (nameToId.get(n) ?? null) : null;
        }
        return o;
      });
    if (payload.length === 0) return { inserted: 0, failed: rows.length };
    const { error, count } = await supabase
      .from(config.table)
      .insert(payload as never, { count: "exact" });
    if (error) {
      toast.error(error.message);
      return { inserted: 0, failed: payload.length };
    }
    logAction("imported", config.singular, {
      details: { count: count ?? payload.length },
    });
    await load();
    return { inserted: count ?? payload.length, failed: rows.length - payload.length };
  }

  const rowsForExport = items.map((r) => ({
    ...r,
    branch_name: config.hasBranch
      ? branchName(branches, r.branch_id as string | null | undefined)
      : undefined,
  })) as Record<string, unknown>[];

  if (editing) {
    return (
      <form
        onSubmit={onSubmit}
        className="animate-fade-up min-w-0 max-w-full space-y-5 overflow-x-hidden"
      >
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
            <ArrowLeft className="size-4" />
            Back to list
          </Button>
          <h2 className="text-lg font-semibold tracking-tight">
            {editing.id ? `Edit ${config.singular}` : `New ${config.singular}`}
          </h2>
        </div>

        {config.sections.map((sec) => (
          <section key={sec.title} className="surface-card min-w-0 overflow-hidden p-4 sm:p-6">
            <h3 className="text-sm font-semibold tracking-tight">{sec.title}</h3>
            <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
              {sec.fields.map((f) => {
                const val = String(editing[f.key] ?? "");
                if (f.options) {
                  return (
                    <div key={f.key} className={`space-y-1.5 ${f.full ? "sm:col-span-2" : ""}`}>
                      <Label className="text-xs font-medium text-muted-foreground">
                        {f.label}
                        {f.required ? <span className="text-destructive"> *</span> : null}
                      </Label>
                      <Select value={val || undefined} onValueChange={(v) => set(f.key)(v)}>
                        <SelectTrigger className="h-10 w-full">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {f.options.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                if (f.type === "file") {
                  return (
                    <DriverPhotoField
                      key={f.key}
                      field={f}
                      objectPath={val}
                      uploading={uploadingField === f.key}
                      locked={isBasic && Boolean(val)}
                      onFile={(file) => void uploadDriverDocument(f.key, file)}
                    />
                  );
                }
                if (f.type === "ledger") {
                  const branchId = editing.branch_id as string | null | undefined;
                  const choices = paymentLedgers.filter((ledger) => ledger.branch_id === branchId);
                  return (
                    <div key={f.key} className={`space-y-1.5 ${f.full ? "sm:col-span-2" : ""}`}>
                      <Label className="text-xs font-medium text-muted-foreground">
                        {f.label}
                        {f.required ? <span className="text-destructive"> *</span> : null}
                      </Label>
                      <select
                        value={val}
                        required={f.required}
                        onChange={(e) => set(f.key)(e.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select cash or bank account</option>
                        {choices.map((ledger) => (
                          <option key={ledger.id} value={ledger.id}>
                            {ledger.account_name} ({ledger.ledger_type})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                // PIN code field on locations table — auto-fill city/district/state/country
                if (f.key === "pin_code" && config.table === "locations") {
                  return (
                    <div key={f.key} className={`space-y-1.5 ${f.full ? "sm:col-span-2" : ""}`}>
                      <Label className="text-xs font-medium text-muted-foreground">
                        {f.label}
                        {f.required ? <span className="text-destructive"> *</span> : null}
                      </Label>
                      <div className="relative">
                        <Input
                          type="text"
                          value={val}
                          maxLength={6}
                          required={f.required}
                          className="h-10"
                          placeholder="6-digit PIN — auto-fills city/state"
                          onChange={(e) => {
                            const pin = e.target.value.replace(/\D/g, "").slice(0, 6);
                            set(f.key)(pin);
                            if (pinDebounceRef.current) clearTimeout(pinDebounceRef.current);
                            if (/^\d{6}$/.test(pin)) {
                              pinDebounceRef.current = setTimeout(async () => {
                                setPinLooking(true);
                                const result = await lookupIndiaPin(pin);
                                setPinLooking(false);
                                if (result) {
                                  setEditing((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          pin_code: pin,
                                          city: (prev.city as string) || result.district,
                                          district: result.district,
                                          state: (prev.state as string) || result.state,
                                          country: (prev.country as string) || result.country,
                                        }
                                      : prev,
                                  );
                                }
                              }, 400);
                            }
                          }}
                        />
                        {pinLooking && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                          </div>
                        )}
                        {!pinLooking && val.length === 6 && (editing?.state as string) && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3.5 text-primary" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={f.key} className={`space-y-1.5 ${f.full ? "sm:col-span-2" : ""}`}>
                    <Label className="text-xs font-medium text-muted-foreground">
                      {f.label}
                      {f.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <Input
                      type={f.type ?? "text"}
                      value={val}
                      required={f.required}
                      onChange={(e) => set(f.key)(e.target.value)}
                      className="h-10"
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {editing.id && renderExtraEditSections
          ? renderExtraEditSections(editing.id, editing)
          : null}

        {config.hasBranch ? (
          <section className="surface-card p-6">
            <h3 className="text-sm font-semibold tracking-tight">Controlling branch</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Link this {config.singular} to a branch defined in Settings.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
              <BranchSelect
                value={(editing.branch_id as string | null | undefined) ?? null}
                onChange={(id: string | null) =>
                  setEditing((f) =>
                    f
                      ? {
                          ...f,
                          branch_id: id,
                          ...(config.table === "vehicles"
                            ? { purchase_paid_by_ledger_id: null }
                            : {}),
                        }
                      : f,
                  )
                }
              />
            </div>
          </section>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="h-10">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : `Save ${config.singular}`}
          </Button>
        </div>
      </form>
    );
  }

  const Icon = config.icon;

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{config.entityLabel}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{config.emptyMsg}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isViewer ? (
            <CsvIO
              entityLabel={config.entityLabel}
              filename={config.table}
              columns={columns}
              rows={rowsForExport}
              onImport={onImport}
            />
          ) : null}
          {!isViewer ? (
            <Button onClick={() => setEditing({ ...emptyRow })}>
              <Plus className="size-4" />
              New {config.singular}
            </Button>
          ) : null}
        </div>
      </div>

      {isLocations ? (
        <div className="surface-card flex flex-wrap items-center gap-2 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Search className="size-4 text-muted-foreground" />
            <span className="sr-only">Search locations</span>
            <Select value={locationSearchBy} onValueChange={(value) => setLocationSearchBy(value as "location_name" | "pin_code")}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="location_name">By name</SelectItem>
                <SelectItem value="pin_code">By PIN code</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            value={locationSearch}
            onChange={(event) => setLocationSearch(event.target.value)}
            placeholder={locationSearchBy === "pin_code" ? "Search by PIN code" : "Search by location name"}
            inputMode={locationSearchBy === "pin_code" ? "numeric" : "text"}
            className="h-9 min-w-[220px] flex-1"
            aria-label={locationSearchBy === "pin_code" ? "Search locations by PIN code" : "Search locations by name"}
          />
          {locationSearch ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setLocationSearch("")}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Icon className="size-6" />
          </span>
          <p className="mt-4 text-sm font-medium">
            {isLocations && locationSearch.trim()
              ? "No locations match your search"
              : `No ${config.entityLabel.toLowerCase()} yet`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isBasic
              ? "No records found for your assigned branches."
              : "Create one, or import a filled template."}
          </p>
          {!isViewer ? (
            <Button className="mt-5" onClick={() => setEditing({ ...emptyRow })}>
              <Plus className="size-4" />
              New {config.singular}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((r, i) => (
              <li
                key={r.id as string}
                style={{ animationDelay: `${i * 40}ms` }}
                className="surface-card animate-fade-up flex items-center gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-lift)]"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {String(r[config.titleKey] ?? "—")}
                    {config.table === "drivers" && !isDriverActive(r) ? (
                      <span className="ml-2 inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                        Inactive
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {config.subtitleKeys
                      .map((k) =>
                        k === "branch_name"
                          ? branchName(branches, r.branch_id as string | null | undefined)
                          : String(r[k] ?? ""),
                      )
                      .filter(Boolean)
                      .join(" · ") || "No details"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Admin-only: per-row logs button */}
                  {isAdmin && r.id ? (
                    <ItemLogsButton
                      entityType={config.singular}
                      entityId={String(r.id)}
                      entityLabel={String(r[config.titleKey] ?? "")}
                    />
                  ) : null}
                  {!isViewer ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {isLocations && hasMore && (
            <button
              type="button"
              className="mt-2 w-full rounded-xl border border-dashed border-border py-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </span>
              ) : (
                `Load more locations (showing ${items.length} so far)`
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
