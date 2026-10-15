import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/wms/auth.jsx";
import { WarehouseProvider } from "@/wms/warehouse.jsx";
import WmsApp from "@/wms/App.jsx";
import "@/wms/App.scoped.css";
import { useSession } from "@/lib/session";

export function WmsStandalone() {
  const { user } = useSession();
  return (
    <BrowserRouter>
      <AuthProvider erpSessionToken={user?.sessionToken ?? ""} embedded>
        <WarehouseProvider>
          <WmsApp />
        </WarehouseProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
