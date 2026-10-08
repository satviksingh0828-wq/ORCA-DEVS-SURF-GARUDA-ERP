import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Fingerprint, ScrollText, Users } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { UserList } from "@/components/users/UserList";
import { LogsPanel } from "@/components/users/LogsPanel";
import { DevicesPanel } from "@/components/users/DevicesPanel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Users — ORCA DEVS SURF" },
      {
        name: "description",
        content: "Manage operator accounts and branch access for ORCA DEVS SURF.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <UsersPage />
    </RequireAuth>
  ),
});

const TABS = [
  { id: "users", label: "Users", desc: "Accounts & branch access", icon: Users },
  { id: "devices", label: "Devices", desc: "Windows Hello / Passkey approvals", icon: Fingerprint },
  { id: "logs", label: "Activity Logs", desc: "Full audit trail", icon: ScrollText },
] as const;

type TabId = (typeof TABS)[number]["id"];

function UsersPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("users");

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/home", replace: true });
  }, [user, navigate]);

  if (user?.role !== "admin") return null;

  return (
    <AppShell variant="ltms" shellTitle="Users">
      <div className="ltms-reference-shell ltms-single-pane-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
        <LtmsSidebar
          label="Users navigation"
          section="users"
          activeTabId={tab}
          onSelectTab={(id) => setTab(id as TabId)}
          showCustomMobileNav={false}
          groups={[
            {
              section: "users",
              label: "Users",
              description: "User accounts, devices and audit history",
              items: TABS.map(({ id, label }) => ({ id, label })),
            },
          ]}
        />
        <div className="ltms-reference-content min-w-0">
          <MobileTabDropdown tabs={TABS} activeId={tab} label="Users" onChange={setTab} compact />
          <div key={tab} className="animate-fade-in min-w-0">
            {tab === "users" && <UserList />}
            {tab === "devices" && <DevicesPanel />}
            {tab === "logs" && <LogsPanel />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
