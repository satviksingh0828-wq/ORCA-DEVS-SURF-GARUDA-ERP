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
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
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
import { UnloadingIncomeReport } from "@/components/reports/UnloadingIncomeReport";
import { useSession } from "@/lib/session";

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
    id: "unloading-income",
    label: "Unloading Income",
    desc: "Stock Inward unloading receipts and additional income",
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
  const { user } = useSession();
  const visibleTabs =
    user?.role === "basic"
      ? TABS.filter((item) => item.id !== "consignment-income" && item.id !== "consignment-net")
      : TABS;
  const [tab, setTab] = useState<TabId>("eway-bill");
  const [navOpen, setNavOpen] = useState(true);
  const safeTab = visibleTabs.some((item) => item.id === tab) ? tab : visibleTabs[0].id;
  const active = visibleTabs.find((item) => item.id === safeTab) ?? visibleTabs[0];
  const ltmsSidebarGroups = [
    {
      label: "Operations of LTMS",
      items: [{ id: "operations", label: "Operations", to: "/ltms/operations" as const }],
    },
    {
      label: "Billing",
      items: [{ id: "billing", label: "Billing", to: "/ltms/billing" as const }],
    },
    {
      label: "Reports",
      items: visibleTabs.map((item) => ({
        id: item.id,
        label: item.label,
        active: item.id === safeTab,
        onSelect: () => setTab(item.id),
      })),
    },
    {
      label: "Masters",
      items: [{ id: "masters", label: "Masters", to: "/ltms/masters" as const }],
    },
    { label: "Finance", items: [{ id: "finance", label: "Finance", to: "/finance" as const }] },
  ];

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
        className={`grid gap-6 ${navOpen ? "lg:grid-cols-[192px_minmax(0,1fr)]" : "grid-cols-1"} ltms-reference-shell`}
      >
        {navOpen && <LtmsSidebar groups={ltmsSidebarGroups} open={navOpen} label="LTMS reports" />}

        <MobileTabDropdown
          tabs={visibleTabs}
          activeId={safeTab}
          label="Reports"
          onChange={setTab}
        />
        <div className="animate-fade-in min-w-0 ltms-reference-content">
          <header className="mb-6 ltms-reference-page-header">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {safeTab === "eway-bill" && <EwayBillList />}
          {safeTab === "movements" && <MovementList />}
          {safeTab === "update-consignment" && <UpdateConsignmentReport />}
          {safeTab === "consignment-income" && <ConsignmentIncomeReport />}
          {safeTab === "transporter-expenditure" && <TransporterExpenditureReport />}
          {safeTab === "unloading-income" && <UnloadingIncomeReport />}
          {safeTab === "loading-charges" && <LoadingChargesReport />}
          {safeTab === "trip-expenditure" && <TripExpenditureReport />}
          {safeTab === "consignment-net" && <ConsignmentNetReport />}
          {safeTab === "sources" && <SourcesReport />}
        </div>
      </div>
    </AppShell>
  );
}
