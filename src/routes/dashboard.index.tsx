import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Car,
  ChevronRight,
  Route as RouteIcon,
  TrendingUp,
  Users,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { HR_SIDEBAR_GROUPS } from "@/components/hr/HrShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { ProfitLossPanel } from "@/components/dashboard/ProfitLossPanel";
import { EntityPnLPanel } from "@/components/dashboard/EntityPnLPanel";
import { TripSummaryPanel } from "@/components/dashboard/TripSummaryPanel";
import { OwnVehicleTransporterComparison } from "@/components/dashboard/OwnVehicleTransporterComparison";
import { EmployeeDashboard } from "@/components/hr/employee-dashboard";
import { AttendanceDashboard } from "@/components/hr/attendance-dashboard";
import { PayrollDashboard } from "@/components/hr/payroll-dashboard";
import { HierarchyView } from "@/components/hr/hierarchy-view";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Dashboard — ORCA DEVS SURF" },
      {
        name: "description",
        content: "Profit & Loss overview with branch-wise breakdown and monthly trend charts.",
      },
      { property: "og:title", content: "Dashboard — ORCA DEVS SURF" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <DashboardPage />
    </RequireAuth>
  ),
});

const TABS = [
  { id: "pnl", label: "Profit & Loss", desc: "Revenue, costs & net P&L", icon: TrendingUp },
  { id: "vehicles", label: "Vehicles", desc: "Vehicle-wise P&L & distribution", icon: Car },
  { id: "drivers", label: "Drivers", desc: "Driver-wise P&L & performance", icon: Users },
  { id: "transporters", label: "Transporters", desc: "Transporter-wise P&L", icon: BarChart3 },
  { id: "trips", label: "Trips", desc: "All trips — income & net", icon: RouteIcon },
  {
    id: "own-vs-transporter",
    label: "Own vs Transporter",
    desc: "Compare own vehicles and hired transporters",
    icon: Car,
  },
  {
    id: "employee",
    label: "Employee dashboard",
    desc: "Employee and department insights",
    icon: Users,
    hr: true,
  },
  {
    id: "attendance",
    label: "Attendance Dashboard",
    desc: "Attendance trends and summaries",
    icon: Users,
    hr: true,
  },
  {
    id: "payroll",
    label: "Payroll dashboard",
    desc: "Salary, loans and deductions",
    icon: BarChart3,
    hr: true,
  },
  {
    id: "hierarchy",
    label: "Hierarchy",
    desc: "Department reporting structure",
    icon: Users,
    hr: true,
  },
] as const;

export type DashboardTabId = (typeof TABS)[number]["id"];
export type DashboardScope = "tms" | "hr";
export function DashboardPage({
  initialTab,
  scope = "tms",
}: {
  initialTab?: DashboardTabId;
  scope?: DashboardScope;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const visibleTabs =
    scope === "hr"
      ? TABS.filter((item) => "hr" in item && item.hr)
      : TABS.filter((item) => !("hr" in item && item.hr));
  const fallbackTab: DashboardTabId = scope === "hr" ? "employee" : "pnl";
  const requestedTab = initialTab ?? fallbackTab;
  const [tab, setTab] = useState<DashboardTabId>(requestedTab);

  const canAccess =
    scope === "tms"
      ? user?.role === "admin"
      : user?.role === "admin" || user?.role === "semi_admin" || user?.role === "viewer";

  useEffect(() => {
    if (user && !canAccess) navigate({ to: "/home", replace: true });
  }, [canAccess, navigate, user]);

  if (!canAccess) return null;

  const safeTab = visibleTabs.some((item) => item.id === tab) ? tab : fallbackTab;
  const active = TABS.find((t) => t.id === safeTab) ?? TABS[0];

  return (
    <AppShell
      variant="ltms"
      shellTitle={scope === "hr" ? "HRMS" : "Dashboard"}
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <Link to={scope === "hr" ? "/hrms" : "/tms"} className="hover:text-foreground">
            {scope === "hr" ? "HRMS" : "TMS"}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Dashboard</span>
        </span>
      }
    >
      <div
        className={
          scope === "hr"
            ? "ltms-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]"
            : "grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"
        }
      >
        {/* ── Left nav (desktop) ── */}
        <LtmsSidebar
          label="Dashboard"
          section={scope === "hr" ? "hr-dashboard" : "dashboard"}
          activeTabId={safeTab}
          onSelectTab={(id) => setTab(id as typeof safeTab)}
          groups={
            scope === "hr"
              ? HR_SIDEBAR_GROUPS.map((group) =>
                  group.section === "hr-dashboard"
                    ? {
                        ...group,
                        items: group.items.map((item) => ({
                          ...item,
                          id: item.id.replace("-dashboard", ""),
                        })),
                      }
                    : group,
                )
              : [
                  {
                    section: "dashboard",
                    label: "Dashboard",
                    items: visibleTabs.map(({ id, label }) => ({ id, label })),
                  },
                ]
          }
        />
        {/* Mobile dropdown navigation */}
        <MobileTabDropdown
          tabs={visibleTabs}
          activeId={safeTab}
          label="Dashboard"
          onChange={setTab}
          compact={scope === "hr"}
        />

        <div
          key={safeTab}
          className={`${scope === "hr" ? "ltms-reference-content" : ""} animate-fade-in min-w-0`}
        >
          {scope !== "hr" && (
            <header className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
            </header>
          )}
          {safeTab === "pnl" && <ProfitLossPanel />}
          {safeTab === "vehicles" && <EntityPnLPanel kind="vehicle" />}
          {safeTab === "drivers" && <EntityPnLPanel kind="driver" />}
          {safeTab === "transporters" && <EntityPnLPanel kind="transporter" />}
          {safeTab === "trips" && <TripSummaryPanel />}
          {safeTab === "own-vs-transporter" && <OwnVehicleTransporterComparison />}
          {safeTab === "employee" && <EmployeeDashboard />}
          {safeTab === "attendance" && <AttendanceDashboard />}
          {safeTab === "payroll" && <PayrollDashboard />}
          {safeTab === "hierarchy" && <HierarchyView />}
        </div>
      </div>
    </AppShell>
  );
}
