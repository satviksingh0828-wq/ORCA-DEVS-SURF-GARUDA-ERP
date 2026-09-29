import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ContractEntryForm, emptyEntry, type EntryRow } from "./ContractEntryForm";
import type { ContractRow } from "./ContractForm";

type Transporter = { id: string; transporter_name: string };
const TABLE = "ltms_transporter_entries" as never;

export function TransporterEntries({
  transporter,
  onBack,
}: {
  transporter: Transporter;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const owner = { id: transporter.id, contract_name: transporter.transporter_name } as ContractRow;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("transporter_id", transporter.id)
      .order("created_at", { ascending: true });
    if (error) toast.error(`Could not load transporter entries: ${error.message}`);
    setEntries((data ?? []) as EntryRow[]);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, [transporter.id]);

  async function remove(id: string) {
    if (!window.confirm("Delete this transporter route entry? This cannot be undone.")) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Entry removed");
    void load();
  }

  if (editing) {
    return (
      <ContractEntryForm
        contract={owner}
        initial={editing}
        table="ltms_transporter_entries"
        ownerKey="transporter_id"
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" /> Transporters
          </Button>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{transporter.transporter_name}</h2>
            <p className="text-sm text-muted-foreground">Route-wise transporter charges</p>
          </div>
        </div>
        <Button
          onClick={() =>
            setEditing({
              ...emptyEntry(transporter.id),
              contract_id: undefined,
              transporter_id: transporter.id,
            })
          }
        >
          <Plus className="size-4" /> New entry
        </Button>
      </div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <FileText className="size-6" />
          </span>
          <p className="mt-4 text-sm font-medium">No entries yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add From PIN, To PIN, mode and trip-wise freight/loading rates for this transporter.
          </p>
          <Button
            className="mt-5"
            onClick={() =>
              setEditing({
                ...emptyEntry(transporter.id),
                contract_id: undefined,
                transporter_id: transporter.id,
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
                    {entry.per_manifest_amount
                      ? ` · Per manifest ₹${entry.per_manifest_amount}`
                      : ""}
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
