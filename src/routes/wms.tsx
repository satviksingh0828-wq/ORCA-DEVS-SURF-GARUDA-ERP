import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Loader2, PackageOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { serverHasWmsAccess } from "@/lib/wms-user-links";

export const Route = createFileRoute("/wms")({
  head: () => ({
    meta: [
      { title: "WMS — ORCA DEVS SURF" },
      { name: "description", content: "Warehouse management inside the ERP workspace." },
    ],
  }),
  component: () => (
    <RequireAuth>
      <WmsPage />
    </RequireAuth>
  ),
});

function WmsPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const wmsUrl = (import.meta.env.VITE_WMS_APP_URL as string | undefined)
    ?.trim()
    .replace(/\/$/, "");

  useEffect(() => {
    let cancelled = false;
    if (!user?.sessionToken) return undefined;
    serverHasWmsAccess({ data: { sessionToken: user.sessionToken } })
      .then(({ enabled }) => {
        if (cancelled) return;
        setAllowed(enabled);
        setCheckingAccess(false);
        if (!enabled) {
          toast.error("Your ERP account is not linked to a WMS user.");
          navigate({ to: "/home", replace: true });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCheckingAccess(false);
        toast.error("Could not verify WMS access.");
        navigate({ to: "/home", replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, user?.sessionToken]);

  if (checkingAccess || !allowed) {
    return (
      <AppShell variant="ltms" shellTitle="WMS">
        <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking WMS access…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell variant="ltms" shellTitle="WMS">
      <section className="flex min-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <PackageOpen className="size-6" />
            </span>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                Warehouse Management System
              </h1>
              <p className="text-xs text-muted-foreground">
                Available because your ERP account is linked to a WMS user.
              </p>
            </div>
          </div>
          {wmsUrl && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href={wmsUrl} target="_blank" rel="noreferrer">
                Open in new tab <ExternalLink className="size-4" />
              </a>
            </Button>
          )}
        </header>
        {wmsUrl ? (
          <iframe
            title="WMS application"
            src={wmsUrl}
            className="min-h-[calc(100vh-13rem)] w-full flex-1 border-0"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Set <code className="mx-1 rounded bg-muted px-1.5 py-0.5">VITE_WMS_APP_URL</code> to the
            WMS application URL to display the merged WMS workspace.
          </div>
        )}
      </section>
    </AppShell>
  );
}
