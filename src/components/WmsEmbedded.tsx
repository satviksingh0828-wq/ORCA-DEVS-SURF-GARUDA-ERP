import { MemoryRouter } from "react-router-dom";
import { ModuleLoadingScreen } from "@/components/ModuleLoadingScreen";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthProvider, useAuth } from "@/wms/auth.jsx";
import { WarehouseProvider } from "@/wms/warehouse.jsx";
import WmsApp from "@/wms/App.jsx";
import "@/wms/App.scoped.css";

export function WmsEmbedded({ erpSessionToken }: { erpSessionToken: string }) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider erpSessionToken={erpSessionToken} embedded>
        <WarehouseProvider>
          <WmsEmbeddedContent />
        </WarehouseProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

function WmsEmbeddedContent() {
  const { loading, embeddedAuthError, retryBootstrap } = useAuth();
  if (loading) return <WmsLoadingScreen />;
  if (embeddedAuthError) {
    return (
      <main className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">WMS sign-in through ERP failed</h1>
        <p className="text-sm text-muted-foreground">
          {typeof embeddedAuthError === "string" && embeddedAuthError
            ? embeddedAuthError
            : "Your ERP session could not be verified by WMS. Check the WMS API deployment and ERP account link."}
        </p>
        <button
          type="button"
          onClick={retryBootstrap}
          className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry WMS connection
        </button>
      </main>
    );
  }
  return <WmsApp embedded />;
}

export function WmsLoadingScreen() {
  return (
    <ModuleLoadingScreen
      shellTitle="WMS"
      headerEnd={
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="text-xs text-muted-foreground">Warehouse</span>
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
      }
    />
  );
}
