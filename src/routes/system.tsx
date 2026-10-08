import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  ShieldCheck,
  ScrollText,
  Zap,
} from "lucide-react";
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
  const [navOpen, setNavOpen] = useState(true);

  // Admin-equivalent guard; Settings and Users remain separate Admin-only routes.
  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "semi_admin")
      navigate({ to: "/home", replace: true });
  }, [user, navigate]);

  if (user?.role !== "admin" && user?.role !== "semi_admin") return null;

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const safeTab = active.id;

  return (
    <AppShell
      variant="ltms"
      shellTitle="System"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">System</span>
        </span>
      }
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          title={navOpen ? "Hide sidebar" : "Show sidebar"}
          className="hidden lg:flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {navOpen ? (
            <>
              <PanelLeftClose className="size-3.5" />
              <span>Hide sidebar</span>
            </>
          ) : (
            <>
              <PanelLeftOpen className="size-3.5" />
              <span>Show sidebar</span>
            </>
          )}
        </button>
      }
    >
      <div
        className={`grid gap-6 ${navOpen ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {/* Desktop left nav */}
        {navOpen && (
          <LtmsSidebar
            open={navOpen}
            label="System"
            section="system"
            activeTabId={tab}
            onSelectTab={(id) => setTab(id as TabId)}
            groups={[
              {
                section: "system",
                label: "System",
                items: TABS.map(({ id, label }) => ({ id, label })),
              },
            ]}
          />
        )}
        {/* Mobile dropdown navigation */}
        <MobileTabDropdown tabs={TABS} activeId={safeTab} label="System" onChange={setTab} />

        {/* Content area */}
        <div key={tab} className="animate-fade-in min-w-0">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>

          {tab === "temporary-eway" && <TemporaryEwayBillPanel />}
          {tab === "db" && <DatabaseStats />}
          {tab === "security" && <SecurityPanel />}
          {tab === "logs" && <LogsPanel />}
        </div>
      </div>
    </AppShell>
  );
}
