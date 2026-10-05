import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronRight,
  FilePenLine,
  FileSearch,
  Package,
  ReceiptText,
  Truck,
  Scale,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { SharedSidebar } from "@/components/SharedSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { UpdateConsignmentReport } from "@/components/reports/UpdateConsignmentReport";
import { ConsignmentIncomeReport } from "@/components/reports/ConsignmentIncomeReport";
import { TransporterExpenditureReport } from "@/components/reports/TransporterExpenditureReport";
import { LoadingChargesReport } from "@/components/reports/LoadingChargesReport";
import { TripExpenditureReport } from "@/components/reports/TripExpenditureReport";
import { EwayBillList } from "@/components/operations/EwayBillList";
import { ConsignmentNetReport } from "@/components/reports/ConsignmentNetReport";
import { SourcesReport } from "@/components/reports/SourcesReport";
import { MovementList } from "@/components/operations/MovementList";

const TABS = [
  {
    id: "movements",
    label: "Movements",
    desc: "Monthly consignment routes and load details",
    icon: Truck,
  },
  {
    id: "eway-bill",
    label: "E-Way Bill",
    desc: "Saved daily assigned-EWB snapshots",
    icon: FileSearch,
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
    label: "Workmen Charges",
    desc: "Loading and unloading charges with deductions and additions",
    icon: Package,
  },
  {
    id: "trip-expenditure",
    label: "Trip Expenditure",
    desc: "Allocate trip costs by consignment package weight",
    icon: Truck,
  },
  {
    id: "consignment-net",
    label: "Consignment Net",
    desc: "Income, expenditure and net by consignment",
    icon: Scale,
  },
  {
    id: "sources",
    label: "Sources",
    desc: "Consignment source, transporter source and package types",
    icon: FileSearch,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/ltms_/reports")({
  head: () => ({
    meta: [
      { title: "LTMS Reports — ORCA DEVS SURF" },
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
  const [tab, setTab] = useState<TabId>("eway-bill");
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
      <div
        className={`grid gap-6 ${navOpen ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {navOpen && (
          <SharedSidebar open={navOpen} width="220px" label="LTMS reports">
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
          </SharedSidebar>
        )}

        <MobileTabDropdown tabs={TABS} activeId={tab} label="Reports" onChange={setTab} />
        <div className="animate-fade-in min-w-0">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {tab === "eway-bill" && <EwayBillList />}
          {tab === "movements" && <MovementList />}
          {tab === "update-consignment" && <UpdateConsignmentReport />}
          {tab === "consignment-income" && <ConsignmentIncomeReport />}
          {tab === "transporter-expenditure" && <TransporterExpenditureReport />}
          {tab === "loading-charges" && <LoadingChargesReport />}
          {tab === "trip-expenditure" && <TripExpenditureReport />}
          {tab === "consignment-net" && <ConsignmentNetReport />}
          {tab === "sources" && <SourcesReport />}
        </div>
      </div>
    </AppShell>
  );
}
