import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/wms/auth.jsx";
import { WarehouseProvider } from "@/wms/warehouse.jsx";
import WmsApp from "@/wms/App.jsx";
import { useTheme } from "@/lib/theme";
import { themeInlineStyles } from "@/lib/theme-studio";
import "@/wms/App.scoped.css";

/**
 * Standalone WMS pages are opened in a new browser tab. ERP auth is stored in
 * sessionStorage and is intentionally not shared with that tab, so these
 * pages must rely on the WMS HttpOnly session cookie instead of ERP's
 * RequireAuth/session context.
 */
export function WmsStandalone() {
  const { profile, resolveModuleTheme } = useTheme();
  return (
    <div className="wms-embedded-scope wms-standalone-scope" data-theme={resolveModuleTheme("wms")} data-custom-theme={Object.keys(profile.colors).length ? "true" : undefined} style={themeInlineStyles(profile)}>
    <BrowserRouter>
      <AuthProvider>
        <WarehouseProvider>
          <WmsApp />
        </WarehouseProvider>
      </AuthProvider>
    </BrowserRouter>
    </div>
  );
}
