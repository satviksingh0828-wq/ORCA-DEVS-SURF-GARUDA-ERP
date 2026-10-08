import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2, RefreshCw, Unlink2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/session";
import {
  serverLoadWmsUserLinks,
  serverSaveWmsUserLink,
  type WmsLinkSettingsData,
} from "@/lib/wms-user-links";

export function WmsUsersSettings() {
  const { user } = useSession();
  const sessionToken = user?.sessionToken;
  const [data, setData] = useState<WmsLinkSettingsData | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
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

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Link2 className="size-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">WMS user links</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Link an existing Sentry WMS account to an ERP user. Each account can be linked only
                once. This stores an account association only; WMS passwords and sign-in remain
                separate.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadLinks()}
            disabled={loading || savingUserId !== null}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <section className="surface-card overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading accounts…
          </div>
        ) : data && data.erpUsers.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No ERP users are available to link.</p>
        ) : data && data.wmsUsers.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No existing WMS accounts were found.</p>
        ) : data ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    ERP user
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Existing WMS user
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Link
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.erpUsers.map((erpUser) => {
                  const currentLink = linkByErpUser.get(erpUser.id);
                  const selected = selections[erpUser.id] ?? "";
                  const unchanged =
                    selected === (currentLink ? String(currentLink.wms_user_id) : "");
                  const busy = savingUserId === erpUser.id;
                  return (
                    <tr key={erpUser.id}>
                      <td className="px-4 py-3.5">
                        <div className="font-medium">{erpUser.full_name || erpUser.username}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {erpUser.username} · {erpUser.role}
                          {erpUser.is_active ? "" : " · inactive"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <select
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
                                {wmsUser.full_name || wmsUser.username} ({wmsUser.username}) ·{" "}
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
                      </td>
                      <td className="px-4 py-3.5">
                        <button
                          type="button"
                          onClick={() => void saveLink(erpUser.id)}
                          disabled={
                            loading ||
                            busy ||
                            unchanged ||
                            (selected !== "" && !Number.isSafeInteger(Number(selected)))
                          }
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : selected ? (
                            <Link2 className="size-4" />
                          ) : (
                            <Unlink2 className="size-4" />
                          )}
                          {selected ? "Save link" : "Unlink"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <div className="p-6 text-sm text-muted-foreground">Account data is unavailable.</div>
        ) : null}
      </section>

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.links.length} linked of {data.erpUsers.length} ERP users · {data.wmsUsers.length}{" "}
          existing WMS accounts
        </p>
      )}
    </div>
  );
}
