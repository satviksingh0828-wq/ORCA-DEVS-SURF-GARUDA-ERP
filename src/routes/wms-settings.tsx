import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { WmsSystemSettings } from "@/components/WmsSystemSettings";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/wms-settings")({
  head: () => ({ meta: [{ title: "WMS Settings — ORCA DEVS SURF" }] }),
  component: () => (
    <RequireAuth>
      <WmsSettingsPage />
    </RequireAuth>
  ),
});

function WmsSettingsPage() {
  const navigate = useNavigate();
  const { user, wmsAccessReady, wmsEnabled } = useSession();

  useEffect(() => {
    if (!wmsAccessReady) return;
    if (user?.role !== "admin") {
      toast.error("Administrator access is required for WMS Settings.");
      navigate({ to: "/home", replace: true });
      return;
    }
    if (!wmsEnabled) {
      toast.error("WMS is not enabled for this ERP account.");
      navigate({ to: "/home", replace: true });
    }
  }, [navigate, user?.role, wmsAccessReady, wmsEnabled]);

  if (!wmsAccessReady) {
    return (
      <AppShell variant="ltms" shellTitle="WMS Settings">
        <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparing WMS Settings…
        </div>
      </AppShell>
    );
  }

  if (user?.role !== "admin" || !wmsEnabled || !user.sessionToken) return null;

  return (
    <AppShell variant="ltms" shellTitle="WMS Settings">
      <div className="ltms-reference-shell ltms-single-pane-reference-shell min-w-0">
        <div className="ltms-reference-content min-w-0">
          <div className="mb-5">
            <h1 className="text-lg font-semibold tracking-tight">WMS Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage WMS company configuration, users, integrations and operational settings.
            </p>
          </div>
          <WmsSystemSettings erpSessionToken={user.sessionToken} />
        </div>
      </div>
    </AppShell>
  );
}
