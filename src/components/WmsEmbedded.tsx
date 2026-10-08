import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/wms/auth.jsx";
import { WarehouseProvider } from "@/wms/warehouse.jsx";
import WmsApp from "@/wms/App.jsx";
import "@/wms/App.css";

export function WmsEmbedded({ erpSessionToken }: { erpSessionToken: string }) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <AuthProvider erpSessionToken={erpSessionToken}>
        <WarehouseProvider>
          <WmsApp embedded />
        </WarehouseProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}
