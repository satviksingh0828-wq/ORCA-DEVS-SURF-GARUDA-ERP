import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/wms/auth.jsx";
import { WarehouseProvider } from "@/wms/warehouse.jsx";
import Users from "@/wms/pages/Users.jsx";
import Tokens from "@/wms/pages/Tokens.jsx";
import InboundActivity from "@/wms/pages/InboundActivity.jsx";
import ConsumerGroups from "@/wms/pages/ConsumerGroups.jsx";
import Webhooks from "@/wms/pages/Webhooks.jsx";
import Channels from "@/wms/pages/Channels.jsx";
import Notifications from "@/wms/pages/Notifications.jsx";
import AuditLog from "@/wms/pages/AuditLog.jsx";
import Imports from "@/wms/pages/Imports.jsx";
import Integrations from "@/wms/pages/Integrations.jsx";
import Settings from "@/wms/pages/Settings.jsx";
import { WmsUsersSettings } from "@/components/settings/WmsUsersSettings";
import "@/wms/App.scoped.css";

type WmsSystemSettingsProps = { erpSessionToken: string; activeTabId: string };

type SystemTab = {
  id: string;
  label: string;
  component: React.ComponentType;
};

export const WMS_SYSTEM_TABS: SystemTab[] = [
  { id: "users", label: "Users", component: Users },
  { id: "api-tokens", label: "API tokens", component: Tokens },
  { id: "inbound", label: "Inbound activity", component: InboundActivity },
  { id: "consumer-groups", label: "Consumer groups", component: ConsumerGroups },
  { id: "webhooks", label: "Webhooks", component: Webhooks },
  { id: "channels", label: "Channels", component: Channels },
  { id: "notifications", label: "Notifications", component: Notifications },
  { id: "audit-log", label: "Audit log", component: AuditLog },
  { id: "imports", label: "Import", component: Imports },
  { id: "integrations", label: "Integrations", component: Integrations },
  { id: "user-access", label: "ERP user access", component: WmsUsersSettings },
  { id: "settings", label: "Company & settings", component: Settings },
];

export function WmsSystemSettings({ erpSessionToken, activeTabId }: WmsSystemSettingsProps) {
  return (
    <MemoryRouter initialEntries={["/settings"]}>
      <AuthProvider erpSessionToken={erpSessionToken}>
        <WarehouseProvider>
          <div className="wms-embedded-scope">
            <WmsSystemSettingsInner activeTabId={activeTabId} />
          </div>
        </WarehouseProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

function WmsSystemSettingsInner({ activeTabId }: { activeTabId: string }) {
  const activeTab = WMS_SYSTEM_TABS.find((tab) => tab.id === activeTabId) ?? WMS_SYSTEM_TABS[0];
  const ActivePage = activeTab.component;

  return (
    <div className="min-w-0">
      <div className="wms-settings-embedded">
        <ActivePage />
      </div>
    </div>
  );
}
