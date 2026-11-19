import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvIO } from "@/components/CsvIO";
import type { RouteRange } from "@/lib/contract-ranges";
import { fetchAll } from "@/lib/fetch-all";
import { ensureLocationsForPins } from "@/lib/ensure-location";
import { ContractEntryForm, emptyEntry, type EntryRow } from "./ContractEntryForm";
import type { ContractRow } from "./ContractForm";

type Transporter = { id: string; transporter_name: string; branch_id?: string | null };
type Source = {
  id: string;
  source_name: string;
  branch_id: string;
  liability_ledger_id: string | null;
  freight_expenditure_ledger_id: string | null;
  loading_expenditure_ledger_id: string | null;
  liability_ledger?: { account_name?: string | null } | null;
  freight_expenditure_ledger?: { account_name?: string | null } | null;
  loading_expenditure_ledger?: { account_name?: string | null } | null;
  is_active: boolean;
  inactive_at: string | null;
};
type Ledger = { id: string; account_name: string; ledger_type: string };
const TABLE = "ltms_transporter_entries" as never;

export function TransporterEntries({
  transporter,
  onBack,
}: {
  transporter: Transporter;
  onBack: () => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [locNames, setLocNames] = useState<Record<string, string>>({});
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [sourceDialog, setSourceDialog] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [liabilityLedgerId, setLiabilityLedgerId] = useState("");
  const [freightLedgerId, setFreightLedgerId] = useState("");
  const [loadingLedgerId, setLoadingLedgerId] = useState("");
  const [savingSource, setSavingSource] = useState(false);
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active");
  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const owner = selectedSource
    ? ({
        id: transporter.id,
        contract_name: `${transporter.transporter_name} · ${selectedSource.source_name}`,
      } as ContractRow)
    : null;

  const entryColumns = useMemo(() => {
    const nF = Math.max(
      3,
      entries.length > 0
        ? Math.max(...entries.map((e) => (e.freight_route_ranges ?? []).length))
        : 0,
    );
    const nL = Math.max(
      3,
      entries.length > 0
        ? Math.max(...entries.map((e) => (e.loading_route_ranges ?? []).length))
        : 0,
    );
    const cols: string[] = [
      "mode",
      "from_location",
      "from_pin_code",
      "to_location",
      "to_pin_code",
      "freight_range_type",
    ];
    for (let i = 1; i <= nF; i++)
      cols.push(`f_r${i}_start`, `f_r${i}_end`, `f_r${i}_working`, `f_r${i}_value`);
    cols.push("loading_range_type");
    for (let i = 1; i <= nL; i++)
      cols.push(`l_r${i}_start`, `l_r${i}_end`, `l_r${i}_working`, `l_r${i}_value`);
    return cols;
  }, [entries]);

  async function loadSources() {
    setLoading(true);
    let query = supabase
      .from("ltms_transporter_sources" as never)
      .select(
        "id,source_name,branch_id,liability_ledger_id,freight_expenditure_ledger_id,loading_expenditure_ledger_id,is_active,inactive_at,liability_ledger:ledger_accounts!liability_ledger_id(account_name),freight_expenditure_ledger:ledger_accounts!freight_expenditure_ledger_id(account_name),loading_expenditure_ledger:ledger_accounts!loading_expenditure_ledger_id(account_name)",
      )
      .eq("transporter_id", transporter.id)
      .order("source_name");
    if (transporter.branch_id) query = query.eq("branch_id", transporter.branch_id);
    const { data, error } = await query;
    if (error) toast.error(`Could not load transporter sources: ${error.message}`);
    const nextSources = (data ?? []) as Source[];
    setSources(nextSources);
    setSourceId((current) =>
      current && nextSources.some((source) => source.id === current) ? current : null,
    );
    setLoading(false);
  }

  async function toggleSource(source: Source) {
    const nextActive = source.is_active === false;
    const inactiveAt = nextActive ? null : new Date().toISOString();
    const { error } = await supabase
      .from("ltms_transporter_sources" as never)
      .update({
        is_active: nextActive,
        inactive_at: inactiveAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", source.id);
    if (error) return toast.error(error.message);
    setSources((current) =>
      current.map((item) =>
        item.id === source.id ? { ...item, is_active: nextActive, inactive_at: inactiveAt } : item,
      ),
    );
    if (!nextActive && sourceId === source.id) setSourceId(null);
    toast.success(
      nextActive ? "Transporter source reactivated" : "Transporter source marked inactive",
    );
  }

  async function loadEntries() {
    if (!sourceId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("transporter_id", transporter.id)
      .eq("source_id", sourceId)
      .order("created_at", { ascending: true });
    if (error) toast.error(`Could not load transporter entries: ${error.message}`);
    const loadedEntries = (data ?? []) as EntryRow[];
    setEntries(loadedEntries);
    const ids = Array.from(new Set(loadedEntries.flatMap((entry) => [entry.from_location_id, entry.to_location_id]).filter(Boolean))) as string[];
    if (ids.length) {
      const locations = await fetchAll<{ id: string; location_name: string }>(() =>
        supabase.from("locations").select("id,location_name").in("id", ids),
      );
      setLocNames(Object.fromEntries(locations.map((location) => [location.id, location.location_name])));
    } else {
      setLocNames({});
    }
    setLoading(false);
  }

  async function loadLedgers() {
    if (!transporter.branch_id) return;
    const { data, error } = await supabase
      .from("ledger_accounts" as never)
      .select("id,account_name,ledger_type")
      .eq("branch_id", transporter.branch_id)
      .eq("is_active", true)
      .order("account_name");
    if (error) toast.error(`Could not load branch ledger accounts: ${error.message}`);
    setLedgers((data ?? []) as Ledger[]);
  }

  useEffect(() => {
    void loadSources();
  }, [transporter.id, transporter.branch_id]);
  useEffect(() => {
    if (sourceId) void loadEntries();
  }, [sourceId, transporter.id]);

  function openSourceDialog(source?: Source) {
    setEditingSourceId(source?.id ?? null);
    setSourceName(source?.source_name ?? "");
    setLiabilityLedgerId(source?.liability_ledger_id ?? "");
    setFreightLedgerId(source?.freight_expenditure_ledger_id ?? "");
    setLoadingLedgerId(source?.loading_expenditure_ledger_id ?? "");
    void loadLedgers();
    setSourceDialog(true);
  }

  async function saveSource() {
    if (!transporter.branch_id) return toast.error("Assign the transporter to a branch first");
    if (!sourceName.trim()) return toast.error("Source name is required");
    if (!liabilityLedgerId || !freightLedgerId || !loadingLedgerId) return toast.error("Select the transporter source, Freight and Loading ledger accounts");
    setSavingSource(true);
    const payload = {
      transporter_id: transporter.id,
      branch_id: transporter.branch_id,
      source_name: sourceName.trim(),
      liability_ledger_id: liabilityLedgerId,
      freight_expenditure_ledger_id: freightLedgerId,
      loading_expenditure_ledger_id: loadingLedgerId,
    };
    const query = editingSourceId
      ? supabase
          .from("ltms_transporter_sources" as never)
          .update(payload)
          .eq("id", editingSourceId)
      : supabase.from("ltms_transporter_sources" as never).insert(payload);
    const { data, error } = await query
      .select(
        "id,source_name,branch_id,liability_ledger_id,freight_expenditure_ledger_id,loading_expenditure_ledger_id,is_active,inactive_at,liability_ledger:ledger_accounts!liability_ledger_id(account_name),freight_expenditure_ledger:ledger_accounts!freight_expenditure_ledger_id(account_name),loading_expenditure_ledger:ledger_accounts!loading_expenditure_ledger_id(account_name)",
      )
      .single();
    setSavingSource(false);
    if (error) return toast.error(error.message);
    const saved = data as Source;
    setSources((current) =>
      [...current.filter((source) => source.id !== saved.id), saved].sort((a, b) =>
        a.source_name.localeCompare(b.source_name),
      ),
    );
    setSourceDialog(false);
    setEditingSourceId(null);
    toast.success(
      editingSourceId
        ? "Transporter source updated"
        : "Transporter source created. Add route entries under this source.",
    );
  }

  async function onImport(rows: Record<string, string>[]) {
    if (!sourceId || selectedSource?.is_active === false) return { inserted: 0, failed: rows.length };
    const all = await fetchAll<{ id: string; location_name: string; pin_code: string | null }>(() =>
      supabase.from("locations").select("id,location_name,pin_code"),
    );
    const nameToId = new Map(all.map((l) => [l.location_name.trim().toLowerCase(), l.id]));
    let pinToId = new Map(
      all
        .filter((l) => (l.pin_code ?? "").trim() !== "")
        .map((l) => [(l.pin_code ?? "").trim(), l.id]),
    );
    const pinById = new Map(all.map((l) => [l.id, (l.pin_code ?? "").trim()]));

    // Auto-create locations for any unknown PINs in the CSV
    const allPins = rows.flatMap((r) => [
      (r.from_pin_code ?? "").trim(),
      (r.to_pin_code ?? "").trim(),
    ]);
    pinToId = await ensureLocationsForPins(allPins, pinToId);

    const resolve = (name: string, pin: string) => {
      const n = (name ?? "").trim().toLowerCase();
      const p = (pin ?? "").trim();
      const id = pinToId.get(p) ?? nameToId.get(n) ?? null;
      return { id, pin: p || (id ? (pinById.get(id) ?? "") : "") };
    };

    const payload = rows.map((r) => {
      const freight_route_range_type =
        (r.freight_range_type ?? "weight").trim().toLowerCase() === "quantity"
          ? "quantity"
          : "weight";
      const freight_route_ranges: RouteRange[] = [];
      for (let i = 1; i <= 20; i++) {
        const start = (r[`f_r${i}_start`] ?? "").trim();
        if (!start) break;
        const working = (r[`f_r${i}_working`] ?? "rate").trim().toLowerCase();
        freight_route_ranges.push({
          start,
          end: (r[`f_r${i}_end`] ?? "").trim(),
          working: working === "fixed" ? "fixed" : "rate",
          value: (r[`f_r${i}_value`] ?? "").trim(),
        });
      }
      const loading_route_range_type =
        (r.loading_range_type ?? "weight").trim().toLowerCase() === "quantity"
          ? "quantity"
          : "weight";
      const loading_route_ranges: RouteRange[] = [];
      for (let i = 1; i <= 20; i++) {
        const start = (r[`l_r${i}_start`] ?? "").trim();
        if (!start) break;
        const working = (r[`l_r${i}_working`] ?? "rate").trim().toLowerCase();
        loading_route_ranges.push({
          start,
          end: (r[`l_r${i}_end`] ?? "").trim(),
          working: working === "fixed" ? "fixed" : "rate",
          value: (r[`l_r${i}_value`] ?? "").trim(),
        });
      }
      const from = resolve(r.from_location ?? "", r.from_pin_code ?? "");
      const to = resolve(r.to_location ?? "", r.to_pin_code ?? "");
      return {
        transporter_id: transporter.id,
        source_id: sourceId,
        mode: ["ROAD", "RAIL", "AIR", "SHIP"].includes((r.mode ?? "ROAD").trim().toUpperCase())
          ? (r.mode ?? "ROAD").trim().toUpperCase()
          : "ROAD",
        from_location_id: from.id,
        to_location_id: to.id,
        from_pin_code: from.pin,
        to_pin_code: to.pin,
        freight_route_range_type,
        freight_route_ranges,
        loading_route_range_type,
        loading_route_ranges,
      };
    });
    if (payload.length === 0) return { inserted: 0, failed: rows.length };
    const { error, count } = await supabase
      .from(TABLE)
      .insert(payload as never, { count: "exact" });
    if (error) {
      toast.error(error.message);
      return { inserted: 0, failed: payload.length };
    }
    await loadEntries();
    return { inserted: count ?? payload.length, failed: rows.length - payload.length };
  }

  const exportRows = entries.map((e) => {
    const row: Record<string, unknown> = {
      mode: e.mode ?? "ROAD",
      from_location: e.from_location_id ? (locNames[e.from_location_id] ?? "") : "",
      from_pin_code: e.from_pin_code,
      to_location: e.to_location_id ? (locNames[e.to_location_id] ?? "") : "",
      to_pin_code: e.to_pin_code,
      freight_range_type: e.freight_route_range_type ?? "weight",
    };
    (e.freight_route_ranges ?? []).forEach((r: RouteRange, i: number) => {
      row[`f_r${i + 1}_start`] = r.start;
      row[`f_r${i + 1}_end`] = r.end ?? "";
      row[`f_r${i + 1}_working`] = r.working;
      row[`f_r${i + 1}_value`] = r.value;
    });
    row.loading_range_type = e.loading_route_range_type ?? "weight";
    (e.loading_route_ranges ?? []).forEach((r: RouteRange, i: number) => {
      row[`l_r${i + 1}_start`] = r.start;
      row[`l_r${i + 1}_end`] = r.end ?? "";
      row[`l_r${i + 1}_working`] = r.working;
      row[`l_r${i + 1}_value`] = r.value;
    });
    return row;
  });

  async function remove(id: string) {
    if (!window.confirm("Delete this transporter route entry? This cannot be undone.")) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Entry removed");
    void loadEntries();
  }

  if (editing && owner && selectedSource) {
    return (
      <ContractEntryForm
        contract={owner}
        initial={{ ...editing, source_id: selectedSource.id, transporter_id: transporter.id }}
        table="ltms_transporter_entries"
        ownerKey="transporter_id"
        hidePerManifest
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void loadEntries();
        }}
      />
    );
  }

  if (!selectedSource) {
    return (
      <div className="animate-fade-up space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="size-4" /> Transporters
            </Button>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {transporter.transporter_name}
              </h2>
              <p className="text-sm text-muted-foreground">
                Create or select a source before adding route entries.
              </p>
            </div>
          </div>
          <Button onClick={openSourceDialog}>
            <Plus className="size-4" /> New source
          </Button>
        </div>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : sources.length === 0 ? (
          <div className="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
            <FileText className="size-8 text-primary" />
            <p className="mt-4 text-sm font-medium">No transporter sources yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a source and map its source liability, Freight expenditure and Loading expenditure ledgers for this branch.
            </p>
            <Button className="mt-5" onClick={openSourceDialog}>
              <Plus className="size-4" /> New source
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-1 rounded-xl bg-muted/50 p-1 w-fit">
              {(["active", "inactive", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${filter === value ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {value} (
                  {
                    sources.filter(
                      (item) =>
                        value === "all" ||
                        (value === "active" ? item.is_active !== false : item.is_active === false),
                    ).length
                  }
                  )
                </button>
              ))}
            </div>
            <ul className="space-y-3">
              {sources
                .filter(
                  (source) =>
                    filter === "all" ||
                    (filter === "active" ? source.is_active !== false : source.is_active === false),
                )
                .map((source) => (
                  <li
                    key={source.id}
                    className={`surface-card flex items-center gap-4 p-4 ${source.is_active === false ? "opacity-60" : ""}`}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <FileText className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{source.source_name}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${source.is_active === false ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-700"}`}
                        >
                          {source.is_active === false ? "Inactive" : "Active"}
                        </span>
                        {source.is_active === false && source.inactive_at ? (
                          <span className="text-[10px] text-muted-foreground">
                            since {new Date(source.inactive_at).toLocaleDateString("en-IN")}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        Source ledger: {source.liability_ledger?.account_name ?? "—"} · Freight: {source.freight_expenditure_ledger?.account_name ?? "—"} · Loading: {source.loading_expenditure_ledger?.account_name ?? "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void toggleSource(source)}
                      >
                        {source.is_active === false ? "Reactivate" : "Deactivate"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openSourceDialog(source)}
                      >
                        <Pencil className="mr-1.5 size-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant={source.is_active === false ? "outline" : "default"}
                        onClick={() => setSourceId(source.id)}
                      >
                        Open source
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </>
        )}
        <Dialog open={sourceDialog} onOpenChange={setSourceDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingSourceId ? "Edit / rename transporter source" : "Create transporter source"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Source Name *</Label>
                <Input
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                  placeholder="e.g. North Zone Contract"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Transporter Source Ledger *</Label>
                <Select value={liabilityLedgerId} onValueChange={setLiabilityLedgerId}>
                  <SelectTrigger><SelectValue placeholder="Select liability ledger" /></SelectTrigger>
                  <SelectContent>{ledgers.filter((ledger) => ledger.ledger_type === "liability").map((ledger) => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Freight Expenditure Ledger *</Label>
                <Select value={freightLedgerId} onValueChange={setFreightLedgerId}>
                  <SelectTrigger><SelectValue placeholder="Select Freight expenditure ledger" /></SelectTrigger>
                  <SelectContent>{ledgers.filter((ledger) => ledger.ledger_type === "expenditure").map((ledger) => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Loading Expenditure Ledger *</Label>
                <Select value={loadingLedgerId} onValueChange={setLoadingLedgerId}>
                  <SelectTrigger><SelectValue placeholder="Select Loading expenditure ledger" /></SelectTrigger>
                  <SelectContent>{ledgers.filter((ledger) => ledger.ledger_type === "expenditure").map((ledger) => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSourceDialog(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveSource()} disabled={savingSource}>
                {savingSource ? "Saving…" : editingSourceId ? "Save changes" : "Create source"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSourceId(null)}>
            <ArrowLeft className="size-4" /> Sources
          </Button>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {transporter.transporter_name} · {selectedSource.source_name}
            </h2>
            <p className="text-sm text-muted-foreground">
              Source ledger: {selectedSource.liability_ledger?.account_name ?? "—"} · Freight: {selectedSource.freight_expenditure_ledger?.account_name ?? "—"} · Loading: {selectedSource.loading_expenditure_ledger?.account_name ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvIO
            entityLabel="Transporter entries"
            filename={`${transporter.transporter_name.replace(/\s+/g, "_")}-${selectedSource.source_name.replace(/\s+/g, "_")}-entries`}
            columns={entryColumns}
            rows={exportRows}
            onImport={onImport}
            readOnly={selectedSource.is_active === false}
          />
          {selectedSource.is_active !== false && (
          <Button
            onClick={() =>
              setEditing({
                ...emptyEntry(transporter.id),
                contract_id: undefined,
                transporter_id: transporter.id,
                source_id: selectedSource.id,
              })
            }
          >
            <Plus className="size-4" /> New entry
          </Button>
          )}
        </div>
      </div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <FileText className="size-8 text-primary" />
          <p className="mt-4 text-sm font-medium">No entries yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add route-wise freight/loading rates under this source.
          </p>
          <Button
            className="mt-5"
            onClick={() =>
              setEditing({
                ...emptyEntry(transporter.id),
                contract_id: undefined,
                transporter_id: transporter.id,
                source_id: selectedSource.id,
              })
            }
          >
            <Plus className="size-4" /> New entry
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => {
            const freight = entry.freight_route_ranges?.[0];
            return (
              <li key={entry.id} className="surface-card flex items-center gap-4 p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <FileText className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {entry.mode} · {entry.from_pin_code || "—"} → {entry.to_pin_code || "—"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Freight{" "}
                    {freight
                      ? `${entry.freight_route_range_type} ≥${freight.start}: ${freight.value || "—"}`
                      : "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setEditing(entry)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => entry.id && void remove(entry.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
