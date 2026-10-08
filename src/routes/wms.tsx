import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/lib/session";
import { WmsEmbedded } from "@/components/WmsEmbedded";

export const Route = createFileRoute("/wms")({
  head: () => ({ meta: [{ title: "WMS — ORCA DEVS SURF" }] }),
  component: () => (
    <RequireAuth>
      <WmsPage />
    </RequireAuth>
  ),
});

function WmsPage() {
  const navigate = useNavigate();
  const { user, wmsAccessReady, wmsEnabled } = useSession();

  useEffect(() => {
    if (!wmsAccessReady || wmsEnabled) return;
    toast.error("Your ERP account is not linked to a WMS user.");
    navigate({ to: "/home", replace: true });
  }, [navigate, wmsAccessReady, wmsEnabled]);

  if (!wmsAccessReady) {
    return (
      <AppShell variant="ltms" shellTitle="WMS">
        <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparing WMS…
        </div>
      </AppShell>
    );
  }

  if (!wmsEnabled) return null;

  return <WmsEmbedded erpSessionToken={user?.sessionToken ?? ""} />;
}
