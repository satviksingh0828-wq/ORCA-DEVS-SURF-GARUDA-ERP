/**
 * Role-aware notification bell.
 * Backed by Supabase — one admin dismissing a notification clears it for all.
 *
 * Error handling:
 *  - If sync fails, the component shows an error state instead of silently
 *    showing "All clear" (which would be misleading).
 *  - The user can retry by clicking the bell again.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, FileWarning, RefreshCw, ShieldAlert, X } from "lucide-react";
import {
  serverSyncNotifications,
  serverDismissNotification,
  type NotificationItem,
} from "@/lib/notifications";
import { useSession } from "@/lib/session";

// ── Icons per kind ────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: NotificationItem["kind"] }) {
  if (kind === "monthly_mis") return <FileWarning className="size-4 shrink-0 text-emerald-500" />;
  if (kind === "insurance") return <ShieldAlert className="size-4 shrink-0 text-amber-500" />;
  if (kind === "road_tax") return <AlertTriangle className="size-4 shrink-0 text-violet-500" />;
  if (kind === "manifest_date_future")
    return <FileWarning className="size-4 shrink-0 text-purple-500" />;
  if (kind === "manifest_date_old")
    return <FileWarning className="size-4 shrink-0 text-yellow-500" />;
  if (kind === "manifest_date_missing")
    return <FileWarning className="size-4 shrink-0 text-red-500" />;
  return <FileWarning className="size-4 shrink-0 text-rose-500" />;
}

function borderClass(item: NotificationItem) {
  if (item.kind === "manifest_date_future") return "border-l-2 border-purple-500";
  if (item.kind === "manifest_date_old") return "border-l-2 border-yellow-400";
  if (item.kind === "manifest_date_missing") return "border-l-2 border-red-500";
  if (item.days_left != null && item.days_left <= 7) return "border-l-2 border-destructive";
  if (item.days_left != null && item.days_left <= 15) return "border-l-2 border-amber-400";
  if (item.kind === "manifest_zero_income") return "border-l-2 border-rose-400";
  return "border-l-2 border-border";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function load() {
    if (!user?.id) return; // not logged in → skip
    setLoading(true);
    setError(null);
    try {
      const data = await serverSyncNotifications({
        data: { userId: user.id },
      });
      setItems(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[NotificationBell] Sync failed:", msg);
      setError(msg);
      // Keep existing items so the UI doesn't flash empty
    } finally {
      setLoading(false);
    }
  }

  const canDismiss = user?.role === "admin" || user?.role === "semi_admin";

  // Load on mount and every 2 minutes for Admin, Viewer/Manager, and Basic users.
  useEffect(() => {
    if (
      user?.role === "admin" ||
      user?.role === "semi_admin" ||
      user?.role === "viewer" ||
      user?.role === "basic"
    ) {
      load();
    }
    const t = setInterval(() => {
      if (
        user?.role === "admin" ||
        user?.role === "semi_admin" ||
        user?.role === "viewer" ||
        user?.role === "basic"
      )
        load();
    }, 120_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      )
        setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function dismiss(item: NotificationItem) {
    if (!user?.id) return;
    setDismissing((s) => new Set(s).add(item.id));
    try {
      await serverDismissNotification({
        data: {
          userId: user.id,
          id: item.id,
          dismissedBy: user?.username ?? user?.fullName ?? "admin",
        },
      });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setError(null); // clear any lingering error
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[NotificationBell] Dismiss failed:", msg);
      setError(`Dismiss failed: ${msg}`);
    } finally {
      setDismissing((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
    }
  }

  const count = items.length;

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && !error) load();
        }}
        aria-label={`Notifications${count > 0 ? ` (${count})` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex size-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-bold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
        {error && (
          <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-amber-500">
            <AlertTriangle className="size-2 text-white" />
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-3 top-[4.5rem] z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[360px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-primary" />
              <span className="text-sm font-semibold">Notifications</span>
              {count > 0 && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                  {count}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {error && (
                <button
                  type="button"
                  onClick={load}
                  title="Retry"
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[calc(100dvh-10rem)] overscroll-contain overflow-y-auto sm:max-h-[420px]">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                Checking for alerts…
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <AlertTriangle className="size-8 text-amber-500" />
                <p className="text-sm text-muted-foreground">Failed to load notifications</p>
                <p className="text-xs text-muted-foreground/70 max-w-[280px] text-center">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={load}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <RefreshCw className="size-3" />
                  Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10">
                <Bell className="size-8 text-muted-foreground/30" />
                <span className="text-sm text-muted-foreground">All clear — no alerts</span>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-start gap-3 px-4 py-3 ${borderClass(item)}`}
                  >
                    <div className="mt-0.5 shrink-0">
                      <KindIcon kind={item.kind} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{item.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                    {/* Only Admins can dismiss; Viewers/Managers remain read-only. */}
                    {canDismiss && (
                      <button
                        type="button"
                        disabled={dismissing.has(item.id)}
                        onClick={() => dismiss(item)}
                        title="Dismiss for all admins"
                        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer summary */}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              {items.filter((i) => i.kind === "insurance").length > 0 && (
                <span className="flex items-center gap-1">
                  <ShieldAlert className="size-3 text-amber-500" />
                  {items.filter((i) => i.kind === "insurance").length} insurance
                </span>
              )}
              {items.filter((i) => i.kind === "road_tax").length > 0 && (
                <span className="flex items-center gap-1">
                  <AlertTriangle className="size-3 text-violet-500" />
                  {items.filter((i) => i.kind === "road_tax").length} road tax
                </span>
              )}
              {items.filter((i) => i.kind === "manifest_zero_income").length > 0 && (
                <span className="flex items-center gap-1">
                  <FileWarning className="size-3 text-rose-500" />
                  {items.filter((i) => i.kind === "manifest_zero_income").length} ₹0 income
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
