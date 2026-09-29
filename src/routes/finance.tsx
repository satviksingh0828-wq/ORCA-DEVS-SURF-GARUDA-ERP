import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarCheck,
  ChevronRight,
  DollarSign,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { TabErrorBoundary } from "@/components/TabErrorBoundary";
import { FinanceList } from "@/components/operations/FinanceList";
import { FixedIncomeList } from "@/components/operations/FixedIncomeList";
import { EmiScheduler } from "@/components/operations/EmiScheduler";
import { DriverPayroll } from "@/components/operations/DriverPayroll";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { CoverageLedger } from "@/components/reports/CoverageLedger";

export const Route = createFileRoute("/finance")({
  head: () => ({
    meta: [
      { title: "Finance — Garuda Logistics Solutions | ORCA DEVS SURF" },
      {
        name: "description",
        content:
          "Income, expenditure, driver payroll, fixed income, yearly expenses and EMI schedules.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <FinancePage />
    </RequireAuth>
  ),
});

const ALL_TABS = [
  {
    id: "income",
    label: "Income",
    desc: "Other income, branch-wise",
    icon: TrendingUp,
    adminOnly: false,
  },
  {
    id: "expenditure",
    label: "Expenditure",
    desc: "Other spend, branch-wise",
    icon: TrendingDown,
    adminOnly: false,
  },
  {
    id: "driver-payroll",
    label: "Driver Payroll",
    desc: "Salary, advances & deductions",
    icon: Users,
    adminOnly: false,
  },
  {
    id: "fixed-income",
    label: "Fixed Income",
    desc: "Contract recurring charges",
    icon: DollarSign,
    adminOnly: true,
  },
  {
    id: "emi-scheduler",
    label: "EMI Scheduler",
    desc: "Vehicle loan & EMI tracker",
    icon: CalendarCheck,
    adminOnly: true,
  },
  {
    id: "insurance-expenses",
    label: "Insurance Premium",
    desc: "Vehicle insurance expenses",
    icon: FileText,
    adminOnly: true,
  },
  {
    id: "road-tax-expenses",
    label: "Road Tax",
    desc: "Vehicle road tax expenses",
    icon: FileText,
    adminOnly: true,
  },
] as const;
type TabId = (typeof ALL_TABS)[number]["id"];

function FinancePage() {
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";
  const isBasic = user?.role === "basic";
  const tabs = isAdmin
    ? ALL_TABS
    : isViewer
      ? ALL_TABS
      : ALL_TABS.filter(
          (tab) => isBasic && ["income", "expenditure", "driver-payroll"].includes(tab.id),
        );
  const [tab, setTab] = useState<TabId>("income");
  const [navOpen, setNavOpen] = useState(true);
  const safeTab = (tabs.find((item) => item.id === tab) ? tab : "income") as TabId;
  const active = tabs.find((item) => item.id === safeTab) ?? tabs[0];

  return (
    <AppShell
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <Link to="/ltms" className="hover:text-foreground">
            LTMS
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Finance</span>
        </span>
      }
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen((value) => !value)}
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
        className={`grid items-start gap-6 ${navOpen ? "lg:grid-cols-[220px_1fr]" : "grid-cols-1"}`}
      >
        {navOpen && (
          <nav className="app-sidebar-scroll hidden lg:block lg:sticky lg:top-0 lg:h-[calc(100dvh-5rem)] lg:w-[220px] lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <ul className="space-y-1">
              {tabs.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === safeTab;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${isActive ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      <Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                      <span className="leading-tight min-w-0">
                        <span className="block text-sm font-medium truncate">{item.label}</span>
                        <span className="block text-[11px] opacity-70 truncate">{item.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        <MobileTabDropdown tabs={tabs} activeId={safeTab} label="Finance" onChange={setTab} />
        <div className={`animate-fade-in min-w-0 ${navOpen ? "lg:col-start-2" : ""}`}>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active?.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active?.desc}</p>
          </header>
          {safeTab === "income" && (
            <TabErrorBoundary label="Income">
              <FinanceList kind="income" />
            </TabErrorBoundary>
          )}
          {safeTab === "expenditure" && (
            <TabErrorBoundary label="Expenditure">
              <FinanceList kind="expenditure" />
            </TabErrorBoundary>
          )}
          {safeTab === "driver-payroll" && (
            <TabErrorBoundary label="Driver Payroll">
              <DriverPayroll />
            </TabErrorBoundary>
          )}
          {safeTab === "fixed-income" && (isAdmin || isViewer) && (
            <TabErrorBoundary label="Fixed Income">
              <FixedIncomeList />
            </TabErrorBoundary>
          )}
          {safeTab === "emi-scheduler" && (isAdmin || isViewer) && (
            <TabErrorBoundary label="EMI Scheduler">
              <EmiScheduler />
            </TabErrorBoundary>
          )}
          {safeTab === "insurance-expenses" && (isAdmin || isViewer) && (
            <TabErrorBoundary label="Insurance Premium">
              <CoverageLedger type="insurance" />
            </TabErrorBoundary>
          )}
          {safeTab === "road-tax-expenses" && (isAdmin || isViewer) && (
            <TabErrorBoundary label="Road Tax">
              <CoverageLedger type="road_tax" />
            </TabErrorBoundary>
          )}
        </div>
      </div>
    </AppShell>
  );
}
