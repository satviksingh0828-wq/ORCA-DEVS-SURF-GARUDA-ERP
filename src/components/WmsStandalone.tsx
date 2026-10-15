import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/wms/auth.jsx";
import { WarehouseProvider } from "@/wms/warehouse.jsx";
import WmsApp from "@/wms/App.jsx";
import "@/wms/App.scoped.css";

/**
 * Standalone WMS pages are opened in a new browser tab. ERP auth is stored in
 * sessionStorage and is intentionally not shared with that tab, so these
 * pages must rely on the WMS HttpOnly session cookie instead of ERP's
 * RequireAuth/session context.
 */
export function WmsStandalone() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WarehouseProvider>
          <WmsApp />
        </WarehouseProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
