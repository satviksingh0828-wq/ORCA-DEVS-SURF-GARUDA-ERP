import { useEffect, useState } from "react";
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
import { ContractEntryForm, emptyEntry, type EntryRow } from "./ContractEntryForm";
import type { ContractRow } from "./ContractForm";

type Transporter = { id: string; transporter_name: string; branch_id?: string | null };
type Source = {
  id: string;
  source_name: string;
  branch_id: string;
  liability_ledger_id: string | null;
  liability_ledger?: { account_name?: string | null } | null;
  is_active: boolean;
  inactive_at: string | null;
};
type Ledger = { id: string; account_name: string };
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
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [sourceDialog, setSourceDialog] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [liabilityLedgerId, setLiabilityLedgerId] = useState("");
  const [savingSource, setSavingSource] = useState(false);
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active");
  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const owner = selectedSource
    ? ({
        id: transporter.id,
        contract_name: `${transporter.transporter_name} · ${selectedSource.source_name}`,
      } as ContractRow)
    : null;

  async function loadSources() {
    setLoading(true);
    let query = supabase
      .from("ltms_transporter_sources" as never)
      .select(
        "id,source_name,branch_id,liability_ledger_id,is_active,inactive_at,liability_ledger:ledger_accounts(account_name)",
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
    setEntries((data ?? []) as EntryRow[]);
    setLoading(false);
  }

  async function loadLiabilityLedgers() {
    if (!transporter.branch_id) return;
    const { data, error } = await supabase
      .from("ledger_accounts" as never)
      .select("id,account_name")
      .eq("branch_id", transporter.branch_id)
      .eq("ledger_type", "liability")
      .eq("is_active", true)
      .order("account_name");
    if (error) toast.error(`Could not load branch liability ledgers: ${error.message}`);
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
    void loadLiabilityLedgers();
    setSourceDialog(true);
  }

  async function saveSource() {
    if (!transporter.branch_id) return toast.error("Assign the transporter to a branch first");
    if (!sourceName.trim()) return toast.error("Source name is required");
    if (!liabilityLedgerId) return toast.error("Select the branch liability ledger");
    setSavingSource(true);
    const payload = {
      transporter_id: transporter.id,
      branch_id: transporter.branch_id,
      source_name: sourceName.trim(),
      liability_ledger_id: liabilityLedgerId,
    };
    const query = editingSourceId
      ? supabase
          .from("ltms_transporter_sources" as never)
          .update(payload)
          .eq("id", editingSourceId)
      : supabase.from("ltms_transporter_sources" as never).insert(payload);
    const { data, error } = await query
      .select(
        "id,source_name,branch_id,liability_ledger_id,is_active,inactive_at,liability_ledger:ledger_accounts(account_name)",
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
              Create a source and link it to a liability ledger for this branch.
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
                        Liability ledger: {source.liability_ledger?.account_name ?? "—"}
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
                <Label>Branch Liability Ledger *</Label>
                <Select value={liabilityLedgerId} onValueChange={setLiabilityLedgerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select liability ledger" />
                  </SelectTrigger>
                  <SelectContent>
                    {ledgers.map((ledger) => (
                      <SelectItem key={ledger.id} value={ledger.id}>
                        {ledger.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
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
              Liability ledger: {selectedSource.liability_ledger?.account_name ?? "—"}
            </p>
          </div>
        </div>
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
