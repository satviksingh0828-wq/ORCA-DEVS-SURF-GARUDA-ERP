import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Car,
  ChevronRight,
  FileBarChart,
  PanelLeftClose,
  PanelLeftOpen,
  Truck,
  Users,
  CalendarRange,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { ProfitLossComparison } from "@/components/reports/ProfitLossComparison";
import { VehicleExpenseReport } from "@/components/reports/VehicleExpenseReport";
import { DriverExpenseReport } from "@/components/reports/DriverExpenseReport";
import { TransporterExpenseReport } from "@/components/reports/TransporterExpenseReport";
import { OtherExpenseReport } from "@/components/reports/OtherExpenseReport";
import { TripDetailsPanel } from "@/components/operations/TripDetailsPanel";
import { useSession } from "@/lib/session";
import { ReportFiltersContext } from "@/lib/report-filters";
import { useBranches } from "@/lib/use-branches";
import { financialYearOptions } from "@/lib/financial-year";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — ORCA DEVS SURF" },
      {
        name: "description",
        content: "Compare P&L between two periods with detailed charts and breakdowns.",
      },
      { property: "og:title", content: "Reports — ORCA DEVS SURF" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <ReportsPage />
    </RequireAuth>
  ),
});

const TABS = [
  {
    id: "booking-report",
    label: "Booking Report",
    desc: "Trip and manifest booking details",
    icon: CalendarRange,
  },
  {
    id: "pnl-compare",
    label: "P&L Comparison",
    desc: "Compare two periods side-by-side",
    icon: FileBarChart,
  },
  {
    id: "vehicle-expenses",
    label: "Vehicle Expenses",
    desc: "Fuel, parking & distance per vehicle",
    icon: Truck,
  },
  {
    id: "driver-expenses",
    label: "Driver Expenses",
    desc: "Bata, morning & night exp per driver",
    icon: Users,
  },
  {
    id: "transporter-expenses",
    label: "TRANSPORTER Expenses",
    desc: "Hire charges & approval charge per transporter",
    icon: Car,
  },
  {
    id: "other-expenses",
    label: "Other Expenses",
    desc: "Dala, unloading, Sunday & other trip costs",
    icon: BarChart3,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

function ReportsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("pnl-compare");
  const [navOpen, setNavOpen] = useState(true);
  const [branchId, setBranchId] = useState("all");
  const [financialYear, setFinancialYear] = useState("none");
  const branches = useBranches();
  const financialYears = financialYearOptions();

  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "semi_admin" && user.role !== "viewer")
      navigate({ to: "/home", replace: true });
    if (user?.role === "viewer" && tab === "pnl-compare") setTab("booking-report");
  }, [user, navigate, tab]);

  if (user?.role !== "admin" && user?.role !== "semi_admin" && user?.role !== "viewer") return null;

  const visibleTabs = user?.role === "viewer" ? TABS.filter((t) => t.id !== "pnl-compare") : TABS;
  const active = visibleTabs.find((t) => t.id === tab) ?? visibleTabs[0];

  return (
    <AppShell
      variant="ltms"
      shellTitle="Reports"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <Link to="/tms" className="hover:text-foreground">
            TMS
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Reports</span>
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
        {/* ── Left nav (desktop) ── */}
        {navOpen && (
          <LtmsSidebar
            open={navOpen}
            label="Reports"
            section="reports"
            activeTabId={tab}
            onSelectTab={(id) => setTab(id as TabId)}
            groups={[
              {
                section: "reports",
                label: "Reports",
                items: visibleTabs.map(({ id, label }) => ({ id, label })),
              },
            ]}
          />
        )}
        {/* Mobile dropdown navigation */}
        <MobileTabDropdown tabs={TABS} activeId={tab} label="Reports" onChange={setTab} />

        <ReportFiltersContext.Provider value={{ branchId, financialYear }}>
          <div key={tab} className="animate-fade-in min-w-0">
            <header className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
            </header>
            {tab !== "pnl-compare" && (
              <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-border bg-muted/30 p-3">
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={financialYear} onValueChange={setFinancialYear}>
                  <SelectTrigger className="h-9 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Financial Year: None</SelectItem>
                    {financialYears.map((fy) => (
                      <SelectItem key={fy.value} value={fy.value}>
                        FY {fy.label} (Apr–Mar)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tab === "pnl-compare" && <ProfitLossComparison />}
            {tab === "booking-report" && <TripDetailsPanel />}
            {tab === "vehicle-expenses" && <VehicleExpenseReport />}
            {tab === "driver-expenses" && <DriverExpenseReport />}
            {tab === "transporter-expenses" && <TransporterExpenseReport />}
            {tab === "other-expenses" && <OtherExpenseReport />}
          </div>
        </ReportFiltersContext.Provider>
      </div>
    </AppShell>
  );
}
