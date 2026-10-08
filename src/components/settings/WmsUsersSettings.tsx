import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlink2,
  UserRound,
  Users,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import {
  serverLoadWmsUserLinks,
  serverSaveWmsUserLink,
  type WmsLinkSettingsData,
} from "@/lib/wms-user-links";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function WmsUsersSettings() {
  const { user } = useSession();
  const sessionToken = user?.sessionToken;
  const [data, setData] = useState<WmsLinkSettingsData | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    if (!sessionToken) {
      setError("Your administrator session is unavailable. Sign in again.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await serverLoadWmsUserLinks({ data: { sessionToken } });
      setData(result);
      setSelections(
        Object.fromEntries(
          result.links.map((link) => [link.erp_user_id, String(link.wms_user_id)]),
        ),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load WMS user links.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  const erpUserById = useMemo(
    () => new Map((data?.erpUsers ?? []).map((erpUser) => [erpUser.id, erpUser])),
    [data?.erpUsers],
  );
  const linkByErpUser = useMemo(
    () => new Map((data?.links ?? []).map((link) => [link.erp_user_id, link])),
    [data?.links],
  );
  const linkByWmsUser = useMemo(
    () => new Map((data?.links ?? []).map((link) => [link.wms_user_id, link])),
    [data?.links],
  );
  const wmsUserById = useMemo(
    () => new Map((data?.wmsUsers ?? []).map((wmsUser) => [wmsUser.user_id, wmsUser])),
    [data?.wmsUsers],
  );
  const visibleErpUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data?.erpUsers ?? [];
    return (data?.erpUsers ?? []).filter((erpUser) => {
      const link = linkByErpUser.get(erpUser.id);
      const linkedWmsUser = link ? wmsUserById.get(link.wms_user_id) : undefined;
      return [
        erpUser.full_name,
        erpUser.username,
        erpUser.role,
        linkedWmsUser?.full_name,
        linkedWmsUser?.username,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }, [data?.erpUsers, linkByErpUser, search, wmsUserById]);

  async function saveLink(erpUserId: string) {
    if (!sessionToken) return;
    const selected = selections[erpUserId] ?? "";
    const wmsUserId = selected ? Number(selected) : null;
    setSavingUserId(erpUserId);
    setError(null);
    try {
      await serverSaveWmsUserLink({ data: { sessionToken, erpUserId, wmsUserId } });
      toast.success(wmsUserId === null ? "WMS account unlinked." : "WMS account linked.");
      await loadLinks();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save the WMS user link.";
      setError(message);
      toast.error(message);
    } finally {
      setSavingUserId(null);
    }
  }

  const linkedCount = data?.links.length ?? 0;
  const erpUserCount = data?.erpUsers.length ?? 0;
  const availableCount = Math.max(0, erpUserCount - linkedCount);

  return (
    <div className="animate-fade-up space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Link2 className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              WMS Settings
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">ERP user access</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Connect ERP users to existing WMS accounts. Each WMS account can be linked only once;
              passwords and sign-in remain separate.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadLinks()}
          disabled={loading || savingUserId !== null}
          className="shrink-0"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <section aria-label="User access summary" className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="ERP users"
          value={data ? erpUserCount : "—"}
          detail="Accounts available"
          icon={Users}
        />
        <SummaryCard
          label="Linked accounts"
          value={data ? linkedCount : "—"}
          detail="ERP users connected to WMS"
          icon={Link2}
          accent
        />
        <SummaryCard
          label="Available to link"
          value={data ? availableCount : "—"}
          detail={`${data?.wmsUsers.length ?? 0} WMS accounts found`}
          icon={Warehouse}
        />
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadLinks()}
            className="shrink-0 font-semibold underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      )}

      <section className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold">Account assignments</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose an existing WMS account, then save the link.
            </p>
          </div>
          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users or accounts"
              aria-label="Search ERP and WMS users"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>

        {loading && !data ? (
          <div className="space-y-3 p-4 sm:p-5" aria-label="Loading user assignments">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="grid animate-pulse gap-4 rounded-xl border border-border p-4 md:grid-cols-[minmax(190px,1fr)_minmax(240px,1.25fr)_auto] md:items-center"
              >
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-muted" />
                  <div className="space-y-2">
                    <div className="h-3 w-28 rounded bg-muted" />
                    <div className="h-2.5 w-20 rounded bg-muted" />
                  </div>
                </div>
                <div className="h-10 rounded-lg bg-muted" />
                <div className="h-9 w-28 rounded-lg bg-muted" />
              </div>
            ))}
          </div>
        ) : data && data.erpUsers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No ERP users found"
            description="There are no ERP accounts available to link to WMS."
          />
        ) : data && data.wmsUsers.length === 0 ? (
          <EmptyState
            icon={Warehouse}
            title="No WMS accounts found"
            description="Create or import a WMS account first, then return here to connect it to an ERP user."
          />
        ) : data && visibleErpUsers.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matching users"
            description="Try another name, username, role, or WMS account."
          />
        ) : data ? (
          <div className="space-y-3 p-4 sm:p-5">
            {visibleErpUsers.map((erpUser) => {
              const currentLink = linkByErpUser.get(erpUser.id);
              const selected = selections[erpUser.id] ?? "";
              const unchanged = selected === (currentLink ? String(currentLink.wms_user_id) : "");
              const busy = savingUserId === erpUser.id;
              const linkedWmsUser = currentLink
                ? wmsUserById.get(currentLink.wms_user_id)
                : undefined;
              const displayName = erpUser.full_name || erpUser.username;

              return (
                <article
                  key={erpUser.id}
                  className="grid gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/25 hover:bg-muted/10 md:grid-cols-[minmax(190px,1fr)_minmax(240px,1.25fr)_auto] md:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                      {initials(displayName) || <UserRound className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{displayName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        @{erpUser.username} <span className="px-1">·</span> {erpUser.role}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label
                      htmlFor={`wms-user-${erpUser.id}`}
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      WMS account
                    </label>
                    <select
                      id={`wms-user-${erpUser.id}`}
                      aria-label={`WMS account for ${erpUser.username}`}
                      value={selected}
                      onChange={(event) =>
                        setSelections((existing) => ({
                          ...existing,
                          [erpUser.id]: event.target.value,
                        }))
                      }
                      disabled={loading || busy}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                      <option value="">Not linked</option>
                      {data.wmsUsers.map((wmsUser) => {
                        const assignedLink = linkByWmsUser.get(wmsUser.user_id);
                        const assignedElsewhere =
                          assignedLink !== undefined && assignedLink.erp_user_id !== erpUser.id;
                        const assignedErpUser = assignedLink
                          ? erpUserById.get(assignedLink.erp_user_id)
                          : undefined;
                        return (
                          <option
                            key={wmsUser.user_id}
                            value={String(wmsUser.user_id)}
                            disabled={assignedElsewhere}
                          >
                            {wmsUser.full_name || wmsUser.username} (@{wmsUser.username}) ·{" "}
                            {wmsUser.role}
                            {assignedElsewhere
                              ? ` — linked to ${assignedErpUser?.username ?? "another ERP user"}`
                              : wmsUser.is_active
                                ? ""
                                : " — inactive"}
                          </option>
                        );
                      })}
                    </select>
                    <div className="mt-1.5 flex min-h-4 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {currentLink ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <Check className="size-3" />
                          Linked{linkedWmsUser ? ` to @${linkedWmsUser.username}` : ""}
                        </span>
                      ) : (
                        <span>No WMS account linked</span>
                      )}
                      {!erpUser.is_active && <span>ERP account inactive</span>}
                      {!unchanged && (
                        <span className="font-medium text-amber-700 dark:text-amber-400">
                          Unsaved selection
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 md:justify-end">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        currentLink
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {currentLink ? "Linked" : "Not linked"}
                    </span>
                    <Button
                      type="button"
                      onClick={() => void saveLink(erpUser.id)}
                      disabled={
                        loading ||
                        busy ||
                        unchanged ||
                        (selected !== "" && !Number.isSafeInteger(Number(selected)))
                      }
                      className="min-w-28"
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : selected ? (
                        <Link2 className="size-4" />
                      ) : (
                        <Unlink2 className="size-4" />
                      )}
                      {selected ? "Save link" : "Unlink"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : !error ? (
          <EmptyState
            icon={ShieldCheck}
            title="Account data unavailable"
            description="The ERP and WMS user lists could not be displayed. Refresh to try again."
          />
        ) : null}

        {data && (
          <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
            Showing {visibleErpUsers.length} of {erpUserCount} ERP users
            <span className="px-1.5">·</span>
            {linkedCount} linked
            <span className="px-1.5">·</span>
            {data.wmsUsers.length} WMS accounts
          </footer>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Users;
  accent?: boolean;
}) {
  return (
    <article className="surface-card flex items-center gap-3 p-4">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
          accent ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
        <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </article>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Users;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <h4 className="mt-3 text-sm font-semibold">{title}</h4>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
