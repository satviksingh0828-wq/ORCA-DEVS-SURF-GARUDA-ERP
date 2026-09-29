import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  ShieldCheck,
  ScrollText,
  Wrench,
  Zap,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { ErrorPanel } from "@/components/system/ErrorPanel";
import { DatabaseStats } from "@/components/system/DatabaseStats";
import { SecurityPanel } from "@/components/system/SecurityPanel";
import { CorrectionPanel } from "@/components/system/CorrectionPanel";
import { LogsPanel } from "@/components/users/LogsPanel";
import { useSession } from "@/lib/session";
import { TemporaryEwayBillPanel } from "@/components/system/TemporaryEwayBillPanel";

export const Route = createFileRoute("/system")({
  head: () => ({
    meta: [
      { title: "System — Garuda Logistics Solutions" },
      {
        name: "description",
        content: "Admin system panel: error detection, database stats, and project info.",
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
    id: "corrections",
    label: "Correction Panel",
    desc: "Safely correct archived trip data",
    icon: Wrench,
  },
  {
    id: "errors",
    label: "Error Panel",
    desc: "Timestamp inconsistencies in closed trips",
    icon: AlertTriangle,
  },
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
  const [tab, setTab] = useState<TabId>("errors");
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
          <nav className="app-sidebar-scroll hidden lg:block lg:sticky lg:top-0 lg:h-[calc(100dvh-5rem)] lg:w-[220px] lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              System
            </p>
            <ul className="space-y-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                const isActive = t.id === tab;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${
                        isActive
                          ? "bg-primary-soft text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                      <span className="leading-tight min-w-0">
                        <span className="block text-sm font-medium truncate">{t.label}</span>
                        <span className="block text-[11px] opacity-70 truncate">{t.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Mobile dropdown navigation */}
        <MobileTabDropdown tabs={TABS} activeId={safeTab} label="System" onChange={setTab} />

        {/* Content area */}
        <div key={tab} className={`animate-fade-in min-w-0 ${navOpen ? "lg:col-start-2" : ""}`}>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>

          {tab === "errors" && <ErrorPanel />}
          {tab === "temporary-eway" && <TemporaryEwayBillPanel />}
          {tab === "corrections" && <CorrectionPanel />}
          {tab === "db" && <DatabaseStats />}
          {tab === "security" && <SecurityPanel />}
          {tab === "logs" && <LogsPanel />}
        </div>
      </div>
    </AppShell>
  );
}
