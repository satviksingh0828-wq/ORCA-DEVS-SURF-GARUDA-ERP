import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Database, ShieldCheck, ScrollText, Zap } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { DatabaseStats } from "@/components/system/DatabaseStats";
import { SecurityPanel } from "@/components/system/SecurityPanel";
import { LogsPanel } from "@/components/users/LogsPanel";
import { useSession } from "@/lib/session";
import { TemporaryEwayBillPanel } from "@/components/system/TemporaryEwayBillPanel";

export const Route = createFileRoute("/system")({
  head: () => ({
    meta: [
      { title: "System — ORCA DEVS SURF" },
      {
        name: "description",
        content: "Admin system panel: database stats, security, logs, and project tools.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <SystemPage />
    </RequireAuth>
  ),
});

const TABS = [
  {
    id: "temporary-eway",
    label: "Temporary E-Way Bill",
    desc: "Generate an E-Way Bill from JSON for testing",
    icon: Zap,
  },
  {
    id: "db",
    label: "Database Stats",
    desc: "PostgreSQL system stats & storage",
    icon: Database,
  },
  {
    id: "security",
    label: "Security",
    desc: "Passkeys, sessions & failed logins",
    icon: ShieldCheck,
  },
  {
    id: "logs",
    label: "Activity Logs",
    desc: "Full app and HR audit trail",
    icon: ScrollText,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

function SystemPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("temporary-eway");

  // Admin-equivalent guard; Settings and Users remain separate Admin-only routes.
  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "semi_admin")
      navigate({ to: "/home", replace: true });
  }, [user, navigate]);

  if (user?.role !== "admin" && user?.role !== "semi_admin") return null;

  return (
    <AppShell variant="ltms" shellTitle="System">
      <div className="ltms-reference-shell ltms-single-pane-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
        <LtmsSidebar
          label="System navigation"
          section="system"
          activeTabId={tab}
          onSelectTab={(id) => setTab(id as TabId)}
          showCustomMobileNav={false}
          groups={[
            {
              section: "system",
              label: "System",
              items: TABS.map(({ id, label }) => ({ id, label })),
            },
          ]}
        />
        <div className="ltms-reference-content min-w-0">
          <MobileTabDropdown tabs={TABS} activeId={tab} label="System" onChange={setTab} compact />
          <div key={tab} className="animate-fade-in min-w-0">
            {tab === "temporary-eway" && <TemporaryEwayBillPanel />}
            {tab === "db" && <DatabaseStats />}
            {tab === "security" && <SecurityPanel />}
            {tab === "logs" && <LogsPanel />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
