import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronRight,
  ClipboardList,
  FileBarChart,
  FilePenLine,
  Package,
  ReceiptText,
  Truck,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { MonthlyMISReport } from "@/components/reports/MonthlyMISReport";
import { MonthlyMIS } from "@/components/operations/MonthlyMIS";
import { UpdateConsignmentReport } from "@/components/reports/UpdateConsignmentReport";
import { ConsignmentIncomeReport } from "@/components/reports/ConsignmentIncomeReport";
import { TransporterExpenditureReport } from "@/components/reports/TransporterExpenditureReport";
import { LoadingChargesReport } from "@/components/reports/LoadingChargesReport";
import { TripExpenditureReport } from "@/components/reports/TripExpenditureReport";

const TABS = [
  {
    id: "admin-mis",
    label: "ADMIN MIS",
    desc: "Depot submissions and compliance overview",
    icon: FileBarChart,
  },
  {
    id: "monthly-mis",
    label: "Monthly MIS",
    desc: "Branch-wise date-wise MIS submission calendar",
    icon: ClipboardList,
  },
  {
    id: "update-consignment",
    label: "Update Consignment",
    desc: "Update delivery and transporter LR details",
    icon: FilePenLine,
  },
  {
    id: "consignment-income",
    label: "Consignment Income",
    desc: "Freight and loading by source, mode and route",
    icon: Package,
  },
  {
    id: "transporter-expenditure",
    label: "Transporter Expenditure",
    desc: "Third-party freight and loading by transporter and route",
    icon: ReceiptText,
  },
  {
    id: "loading-charges",
    label: "Loading Charges",
    desc: "Package-rate loading with deductions and additions",
    icon: Package,
  },
  {
    id: "trip-expenditure",
    label: "Trip Expenditure",
    desc: "Allocate trip costs by consignment package weight",
    icon: Truck,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/ltms_/reports")({
  head: () => ({
    meta: [
      { title: "LTMS Reports — Garuda Logistics Solutions | ORCA DEVS SURF" },
      {
        name: "description",
        content: "LTMS ADMIN MIS and management reports.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <ReportsPage />
    </RequireAuth>
  ),
});

export default Route;

function ReportsPage() {
  const [tab, setTab] = useState<TabId>("admin-mis");
  const [navOpen, setNavOpen] = useState(true);
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

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
          <span className="text-foreground">Reports</span>
        </span>
      }
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen((value) => !value)}
          title={navOpen ? "Hide sidebar" : "Show sidebar"}
          className="hidden items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
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
      <div className={`grid gap-6 ${navOpen ? "lg:grid-cols-[220px_1fr]" : "grid-cols-1"}`}>
        {navOpen && (
          <nav className="app-sidebar-scroll hidden lg:sticky lg:top-0 lg:block lg:h-[calc(100dvh-5rem)] lg:w-[220px] lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Reports
            </p>
            <ul className="space-y-1">
              {TABS.map((item) => {
                const Icon = item.icon;
                const selected = item.id === tab;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ${selected ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      <Icon className={`size-4 shrink-0 ${selected ? "text-primary" : ""}`} />
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-sm font-medium">{item.label}</span>
                        <span className="block truncate text-[11px] opacity-70">{item.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <MobileTabDropdown tabs={TABS} activeId={tab} label="Reports" onChange={setTab} />
        <div className={`animate-fade-in min-w-0 ${navOpen ? "lg:col-start-2" : ""}`}>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {tab === "admin-mis" && <MonthlyMISReport />}
          {tab === "monthly-mis" && <MonthlyMIS />}
          {tab === "update-consignment" && <UpdateConsignmentReport />}
          {tab === "consignment-income" && <ConsignmentIncomeReport />}
          {tab === "transporter-expenditure" && <TransporterExpenditureReport />}
          {tab === "loading-charges" && <LoadingChargesReport />}
          {tab === "trip-expenditure" && <TripExpenditureReport />}
        </div>
      </div>
    </AppShell>
  );
}
