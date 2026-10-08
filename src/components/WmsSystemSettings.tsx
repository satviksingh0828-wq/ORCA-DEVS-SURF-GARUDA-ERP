import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
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

type WmsSystemSettingsProps = { erpSessionToken: string };

type SystemTab = {
  id: string;
  label: string;
  component: React.ComponentType;
};

const SYSTEM_TABS: SystemTab[] = [
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

export function WmsSystemSettings({ erpSessionToken }: WmsSystemSettingsProps) {
  return (
    <MemoryRouter initialEntries={["/settings"]}>
      <AuthProvider erpSessionToken={erpSessionToken}>
        <WarehouseProvider>
          <div className="wms-embedded-scope">
            <WmsSystemSettingsInner />
          </div>
        </WarehouseProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

function WmsSystemSettingsInner() {
  const [activeId, setActiveId] = useState(SYSTEM_TABS[0].id);
  const activeTab = SYSTEM_TABS.find((tab) => tab.id === activeId) ?? SYSTEM_TABS[0];
  const ActivePage = activeTab.component;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/20 p-2">
        {SYSTEM_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveId(tab.id)}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              tab.id === activeId
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="wms-settings-embedded">
        <ActivePage />
      </div>
    </div>
  );
}
