import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/lib/session";
import { serverHasWmsAccess } from "@/lib/wms-user-links";
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
  const { user } = useSession();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [allowed, setAllowed] = useState(false);

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

  return <WmsEmbedded erpSessionToken={user?.sessionToken ?? ""} />;
}
