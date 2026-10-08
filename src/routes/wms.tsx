import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/lib/session";
import { WmsEmbedded, WmsLoadingScreen } from "@/components/WmsEmbedded";

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
    return <WmsLoadingScreen />;
  }

  if (!wmsEnabled) return null;

  return <WmsEmbedded erpSessionToken={user?.sessionToken ?? ""} />;
}
