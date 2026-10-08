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
      <AuthProvider erpSessionToken={erpSessionToken}>
        <WarehouseProvider>
          <WmsEmbeddedContent />
        </WarehouseProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

function WmsEmbeddedContent() {
  const { loading } = useAuth();
  return loading ? <WmsLoadingScreen /> : <WmsApp embedded />;
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
