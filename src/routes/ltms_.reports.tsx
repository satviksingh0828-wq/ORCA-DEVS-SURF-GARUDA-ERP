import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  FilePenLine,
  FileSearch,
  Package,
  ReceiptText,
  Truck,
  Scale,
  FileSpreadsheet,
  Images,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { consumeLtmsTabNavigation, LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { UpdateConsignmentReport } from "@/components/reports/UpdateConsignmentReport";
import { ConsignmentIncomeReport } from "@/components/reports/ConsignmentIncomeReport";
import { CompactConsignmentReport } from "@/components/reports/CompactConsignmentReport";
import { PodImageReport } from "@/components/reports/PodImageReport";
import { TransporterExpenditureReport } from "@/components/reports/TransporterExpenditureReport";
import { LoadingChargesReport } from "@/components/reports/LoadingChargesReport";
import { TripExpenditureReport } from "@/components/reports/TripExpenditureReport";
import { EwayBillList } from "@/components/operations/EwayBillList";
import { ConsignmentNetReport } from "@/components/reports/ConsignmentNetReport";
import { SourcesReport } from "@/components/reports/SourcesReport";
import { MovementList } from "@/components/operations/MovementList";
import { UnloadingIncomeReport } from "@/components/reports/UnloadingIncomeReport";
import { useSession } from "@/lib/session";
import { TableViewMode } from "@/components/ui/table-view-mode";

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
    id: "compact-consignment",
    label: "Consignment Report",
    desc: "Compact 26-column consignment data with role-controlled exports",
    icon: FileSpreadsheet,
  },
  {
    id: "pod-images",
    label: "POD Image Report",
    desc: "Outward POD front, back and signature copies with Excel export",
    icon: Images,
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

/** Main-table columns retained in Compact mode; Complete always displays all.
 * Totals, expandable rows, buttons and existing exports stay untouched.
 */
const COMPACT_REPORT_COLUMNS: Partial<Record<TabId, readonly number[]>> = {
  "movements": [1, 2, 4, 5, 6, 8, 9, 10],
  "eway-bill": [1, 2, 3, 5, 7, 8],
  "pod-images": [1, 2, 3, 4, 7, 8, 9, 10, 11, 13],
  "update-consignment": [1, 2, 4, 5, 7],
  "consignment-income": [1, 2, 3, 7, 8, 9, 11],
  "transporter-expenditure": [1, 2, 3, 4, 9, 10, 13, 14],
  "unloading-income": [1, 2, 3, 4, 7],
  "loading-charges": [1, 2, 3, 4, 6, 7, 10, 11, 12],
  "trip-expenditure": [1, 3, 5, 6, 7, 8, 11],
  "consignment-net": [1, 2, 3, 7, 8],
  "sources": [1, 2, 3, 4, 5, 7],
};

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
      ? TABS.filter(
          (item) =>
            item.id !== "consignment-income" &&
            item.id !== "consignment-net" &&
            item.id !== "sources",
        )
      : TABS;
  const [tab, setTab] = useState<TabId>("eway-bill");
  const availableTabIds = visibleTabs.map((item) => item.id).join("|");
  useEffect(() => {
    const pendingTab = consumeLtmsTabNavigation("reports");
    if (pendingTab && availableTabIds.split("|").includes(pendingTab)) setTab(pendingTab as TabId);
  }, [availableTabIds]);
  const safeTab = visibleTabs.some((item) => item.id === tab) ? tab : visibleTabs[0].id;
  const active = visibleTabs.find((item) => item.id === safeTab) ?? visibleTabs[0];

  return (
    <AppShell
      variant="ltms"
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
    >
      <div className="grid gap-6 lg:grid-cols-[192px_minmax(0,1fr)] ltms-reference-shell">
        <LtmsSidebar
          section="reports"
          activeTabId={safeTab}
          onSelectTab={(id) => setTab(id as TabId)}
          label="LTMS reports"
        />

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
          <TableViewMode key={safeTab} compactColumns={COMPACT_REPORT_COLUMNS[safeTab] ?? []}
            label={active.label}>
          {safeTab === "eway-bill" && <EwayBillList />}
          {safeTab === "movements" && <MovementList />}
          {safeTab === "update-consignment" && <UpdateConsignmentReport />}
          {safeTab === "compact-consignment" && <CompactConsignmentReport />}
          {safeTab === "pod-images" && <PodImageReport />}
          {safeTab === "consignment-income" && <ConsignmentIncomeReport />}
          {safeTab === "transporter-expenditure" && <TransporterExpenditureReport />}
          {safeTab === "unloading-income" && <UnloadingIncomeReport />}
          {safeTab === "loading-charges" && <LoadingChargesReport />}
          {safeTab === "trip-expenditure" && <TripExpenditureReport />}
          {safeTab === "consignment-net" && <ConsignmentNetReport />}
          {safeTab === "sources" && <SourcesReport />}
          </TableViewMode>
        </div>
      </div>
    </AppShell>
  );
}
