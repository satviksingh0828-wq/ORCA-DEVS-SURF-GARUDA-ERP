import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Fingerprint,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Users,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
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
  const [navOpen, setNavOpen] = useState(true);

  useEffect(() => {
    if (user && user.role !== "admin") navigate({ to: "/home", replace: true });
  }, [user, navigate]);

  if (user?.role !== "admin") return null;

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <AppShell
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Users</span>
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
              Users
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
        <MobileTabDropdown tabs={TABS} activeId={tab} label="Users" onChange={setTab} />

        <div key={tab} className="animate-fade-in min-w-0">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {tab === "users" && <UserList />}
          {tab === "devices" && <DevicesPanel />}
          {tab === "logs" && <LogsPanel />}
        </div>
      </div>
    </AppShell>
  );
}
