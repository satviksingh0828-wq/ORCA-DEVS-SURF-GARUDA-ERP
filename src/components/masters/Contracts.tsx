import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvIO } from "@/components/CsvIO";
import type { RouteRange } from "@/lib/contract-ranges";
import { fetchAll } from "@/lib/fetch-all";
import { ensureLocationsForPins } from "@/lib/ensure-location";
import { logAction } from "@/lib/log-actions";
import { ItemLogsButton } from "@/components/shared/ItemLogsDrawer";
import { ContractForm, EMPTY_CONTRACT, type ContractRow } from "./ContractForm";
import { ContractEntryForm, emptyEntry, type EntryRow } from "./ContractEntryForm";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { useBranches } from "@/lib/use-branches";

const CONTRACT_COLUMNS = [
  "contract_name",
  "branch_id",
  "source_asset_ledger_id",
  "freight_income_ledger_id",
  "loading_income_ledger_id",
  "unloading_income_ledger_id",
  "fixed_monthly_charge",
  "fixed_monthly_charge_note",
  "fixed_yearly_charge",
  "fixed_yearly_charge_note",
  "company_name",
  "legal_business_name",
  "company_type",
  "industry",
  "pan",
  "gstin",
  "cin",
  "msme_udyam",
  "tan",
  "iec",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "country",
  "pin_code",
  "mobile_number",
  "telephone_number",
  "email",
  "website",
];

type View =
  | { kind: "list" }
  | { kind: "new-contract" }
  | { kind: "edit-contract"; contract: ContractRow }
  | { kind: "entries"; contract: ContractRow }
  | { kind: "new-entry"; contract: ContractRow }
  | { kind: "edit-entry"; contract: ContractRow; entry: EntryRow };

export function Contracts() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("active");
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const branches = useBranches();

  async function load() {
    setLoading(true);
    try {
      const rows = await fetchAll<ContractRow>(() =>
        supabase.from("contracts").select("*").order("created_at", { ascending: true }),
      );

      // Auto-expire: if end_date is set and has passed, mark inactive + rename in DB
      const today = new Date().toISOString().slice(0, 10);
      const toExpire = rows.filter(
        (c) => c.status !== "inactive" && c.end_date && c.end_date < today,
      );
      if (toExpire.length > 0) {
        await Promise.all(
          toExpire.map((c) => {
            const base = (c.contract_name ?? "").replace(/-old(-[\d-]*)*$/, "").trimEnd();
            const parts = [base, "old", c.start_date, c.end_date].filter(Boolean);
            const newName = parts.join("-");
            c.status = "inactive";
            c.contract_name = newName;
            return supabase
              .from("contracts")
              .update({ status: "inactive", contract_name: newName } as never)
              .eq("id", c.id!);
          }),
        );
      }

      setContracts(rows);
    } catch {
      toast.error("Could not load sources");
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function removeContract(c: ContractRow) {
    if (!window.confirm(`Delete source "${c.contract_name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("contracts").delete().eq("id", c.id!);
    if (error) return toast.error(error.message);
    logAction("deleted", "contract", { entityId: c.id ?? "", entityLabel: c.contract_name });
    toast.success("Source removed");
    load();
  }

  async function onImportContracts(rows: Record<string, string>[]) {
    const payload = rows
      .filter((r) => (r.contract_name || "").trim() !== "")
      .map((r) => {
        const o: Record<string, unknown> = {};
        for (const k of CONTRACT_COLUMNS) o[k] = r[k] ?? "";
        o.fixed_monthly_charge = r.fixed_monthly_charge ? Number(r.fixed_monthly_charge) : 0;
        o.fixed_yearly_charge = r.fixed_yearly_charge ? Number(r.fixed_yearly_charge) : 0;
        return o;
      });
    if (payload.length === 0) return { inserted: 0, failed: rows.length };
    const { error, count } = await supabase
      .from("contracts")
      .insert(payload as never, { count: "exact" });
    if (error) {
      toast.error(error.message);
      return { inserted: 0, failed: payload.length };
    }
    logAction("imported", "contract", { details: { count: count ?? payload.length } });
    await load();
    return { inserted: count ?? payload.length, failed: rows.length - payload.length };
  }

  const exportRows = contracts as Record<string, unknown>[];

  if (view.kind === "new-contract") {
    return (
      <ContractForm
        initial={{ ...EMPTY_CONTRACT }}
        onCancel={() => setView({ kind: "list" })}
        onSaved={() => {
          setView({ kind: "list" });
          load();
        }}
      />
    );
  }
  if (view.kind === "edit-contract") {
    return (
      <ContractForm
        initial={view.contract}
        onCancel={() => setView({ kind: "list" })}
        onSaved={() => {
          setView({ kind: "list" });
          load();
        }}
      />
    );
  }

  if (view.kind === "entries" || view.kind === "new-entry" || view.kind === "edit-entry") {
    return (
      <EntriesView
        contract={view.contract}
        view={view}
        onBack={() => setView({ kind: "list" })}
        onNew={() => setView({ kind: "new-entry", contract: view.contract })}
        onEdit={(e) => setView({ kind: "edit-entry", contract: view.contract, entry: e })}
        onCancelForm={() => setView({ kind: "entries", contract: view.contract })}
      />
    );
  }

  const activeCount = contracts.filter((c) => c.status !== "inactive").length;
  const inactiveCount = contracts.filter((c) => c.status === "inactive").length;

  const visibleContracts = contracts.filter((c) => {
    if (filter === "active") return c.status !== "inactive";
    if (filter === "inactive") return c.status === "inactive";
    return true;
  });

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sources</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Freight sources with weight or quantity slabs. Open a source to add route-wise entries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvIO
            entityLabel="Contracts"
            filename="contracts"
            columns={CONTRACT_COLUMNS}
            rows={exportRows}
            onImport={onImportContracts}
          />
          <Button onClick={() => setView({ kind: "new-contract" })}>
            <Plus className="size-4" />
            New source
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1 w-fit">
        {(["active", "inactive", "all"] as const).map((f) => {
          const label =
            f === "active"
              ? `Active (${activeCount})`
              : f === "inactive"
                ? `Inactive (${inactiveCount})`
                : `All (${contracts.length})`;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : contracts.length === 0 ? (
        <div className="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <FileText className="size-6" />
          </span>
          <p className="mt-4 text-sm font-medium">No sources yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first source to define weight and quantity slabs.
          </p>
          <Button className="mt-5" onClick={() => setView({ kind: "new-contract" })}>
            <Plus className="size-4" />
            New source
          </Button>
        </div>
      ) : visibleContracts.length === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          No {filter} sources found.
        </p>
      ) : (
        <ul className="space-y-3">
          {visibleContracts.map((c, i) => {
            const inactive = c.status === "inactive";
            return (
              <li
                key={c.id}
                style={{ animationDelay: `${i * 40}ms` }}
                className={`surface-card animate-fade-up flex items-center gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-lift)] ${inactive ? "opacity-60" : ""}`}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${inactive ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary"}`}
                >
                  <FileText className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{c.contract_name}</p>
                    {inactive ? (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Inactive
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    Per-route rate slabs
                    {Number(c.fixed_monthly_charge) > 0 || Number(c.fixed_yearly_charge) > 0
                      ? " · Has fixed charges"
                      : ""}
                    {c.start_date ? ` · From ${c.start_date}` : ""}
                    {c.end_date ? ` · To ${c.end_date}` : ""}
                    {c.branch_id
                      ? ` · ${branches.find((branch) => branch.id === c.branch_id)?.branch_name ?? "Unknown branch"}`
                      : " · No branch"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Admin-only per-row logs */}
                  {isAdmin && c.id ? (
                    <ItemLogsButton
                      entityType="contract"
                      entityId={c.id}
                      entityLabel={c.contract_name}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant={inactive ? "outline" : "default"}
                    onClick={() => setView({ kind: "entries", contract: c })}
                  >
                    {inactive ? "View" : "Open"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setView({ kind: "edit-contract", contract: c })}
                  >
                    {inactive ? "View" : "Edit"}
                  </Button>
                  {!inactive && (
                    <Button variant="ghost" size="sm" onClick={() => removeContract(c)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EntriesView({
  contract,
  view,
  onBack,
  onNew,
  onEdit,
  onCancelForm,
}: {
  contract: ContractRow;
  view: View;
  onBack: () => void;
  onNew: () => void;
  onEdit: (e: EntryRow) => void;
  onCancelForm: () => void;
}) {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [locNames, setLocNames] = useState<Record<string, string>>({});

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
    cols.push("per_manifest_amount", "per_manifest_note");
    return cols;
  }, [entries]);

  async function load() {
    setLoading(true);
    try {
      const rows = await fetchAll<EntryRow>(() =>
        supabase
          .from("contract_entries")
          .select("*")
          .eq("contract_id", contract.id!)
          .order("created_at", { ascending: true }),
      );
      setEntries(rows);
      const ids = Array.from(
        new Set(rows.flatMap((r) => [r.from_location_id, r.to_location_id]).filter(Boolean)),
      ) as string[];
      if (ids.length) {
        const locs = await fetchAll<{ id: string; location_name: string }>(() =>
          supabase.from("locations").select("id,location_name").in("id", ids),
        );
        const map: Record<string, string> = {};
        locs.forEach((l) => {
          map[l.id] = l.location_name;
        });
        setLocNames(map);
      }
    } catch {
      toast.error("Could not load entries");
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, [contract.id]);

  async function remove(id: string) {
    const { error } = await supabase.from("contract_entries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    logAction("deleted", "contract_entry", {
      entityId: id,
      entityLabel: contract.contract_name,
    });
    toast.success("Entry removed");
    load();
  }

  async function onImport(rows: Record<string, string>[]) {
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
        contract_id: contract.id!,
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
        per_manifest_amount: r.per_manifest_amount ?? "",
        per_manifest_note: r.per_manifest_note ?? "",
      };
    });
    if (payload.length === 0) return { inserted: 0, failed: rows.length };
    const { error, count } = await supabase
      .from("contract_entries")
      .insert(payload as never, { count: "exact" });
    if (error) {
      toast.error(error.message);
      return { inserted: 0, failed: payload.length };
    }
    await load();
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
    row.per_manifest_amount = e.per_manifest_amount;
    row.per_manifest_note = e.per_manifest_note;
    return row;
  });

  if (view.kind === "new-entry") {
    return (
      <ContractEntryForm
        contract={contract}
        initial={emptyEntry(contract.id!)}
        onCancel={onCancelForm}
        onSaved={() => {
          onCancelForm();
          load();
        }}
      />
    );
  }
  if (view.kind === "edit-entry") {
    return (
      <ContractEntryForm
        contract={contract}
        initial={view.entry}
        onCancel={onCancelForm}
        onSaved={() => {
          onCancelForm();
          load();
        }}
      />
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Sources
          </Button>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{contract.contract_name}</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvIO
            entityLabel="Entries"
            filename={`${contract.contract_name.replace(/\s+/g, "_")}-entries`}
            columns={entryColumns}
            rows={exportRows}
            onImport={onImport}
          />
          <Button onClick={onNew}>
            <Plus className="size-4" />
            New entry
          </Button>
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
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <FileText className="size-6" />
          </span>
          <p className="mt-4 text-sm font-medium">No entries yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add trip-wise rates for this contract, or import a filled template.
          </p>
          <Button className="mt-5" onClick={onNew}>
            <Plus className="size-4" />
            New entry
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((e, i) => {
            const from = e.from_location_id ? locNames[e.from_location_id] : "";
            const to = e.to_location_id ? locNames[e.to_location_id] : "";
            const fr = (e.freight_route_ranges ?? [])[0];
            const preview = fr
              ? `${e.freight_route_range_type ?? "weight"} · ≥${fr.start}: ${fr.value || "—"} (${fr.working})`
              : "";
            return (
              <li
                key={e.id}
                style={{ animationDelay: `${i * 40}ms` }}
                className="surface-card animate-fade-up flex items-center gap-4 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {(from || "—") + " → " + (to || "—")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      e.mode ?? "ROAD",
                      [e.from_pin_code, e.to_pin_code].filter(Boolean).join(" → "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {preview ? " · " + preview : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(e)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => e.id && remove(e.id)}>
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
