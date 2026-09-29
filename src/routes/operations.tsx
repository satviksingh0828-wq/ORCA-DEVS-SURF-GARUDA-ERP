import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  BarChart2,
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  ChevronRight,
  CreditCard,
  FileText,
  FilePenLine,
  PanelLeftClose,
  PanelLeftOpen,
  Route as RouteIcon,
  TrendingDown,
  TrendingUp,
  Truck,
  Upload,
  Users,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { SharedSidebar } from "@/components/SharedSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { TabErrorBoundary } from "@/components/TabErrorBoundary";
import { Trips } from "@/components/operations/Trips";
import { TripAveragesPanel } from "@/components/operations/TripAveragesPanel";
import { TripDetailsPanel } from "@/components/operations/TripDetailsPanel";
import { TripImport } from "@/components/import/TripImport";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { FastagLedger } from "@/components/reports/FastagLedger";
import { ApprovalChargeAdvanceReport } from "@/components/reports/ApprovalChargeAdvanceReport";
import { ReportFiltersContext } from "@/lib/report-filters";
import { ShipmentList } from "@/components/operations/ShipmentList";
import { ConsignmentList } from "@/components/operations/ConsignmentList";
import { LorryReceiptList } from "@/components/operations/LorryReceiptList";
import { MovementList } from "@/components/operations/MovementList";
import { ManifestList } from "@/components/operations/ManifestList";
import { LtmsManifestList } from "@/components/operations/LtmsManifestList";
import { OutwardPOD } from "@/components/operations/OutwardPOD";

export const Route = createFileRoute("/operations")({
  head: () => ({
    meta: [
      { title: "Operations — Garuda Logistics Solutions | ORCA DEVS SURF" },
      {
        name: "description",
        content:
          "Plan and record trips with manifests, contract-based freight, other income, expenses and a profit summary.",
      },
      { property: "og:title", content: "Operations — Garuda Logistics Solutions" },
      {
        property: "og:description",
        content: "Trips, manifests, income and expenses for Garuda Logistics Solutions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <OperationsPage />
    </RequireAuth>
  ),
});

const ALL_TABS = [
  {
    id: "trip",
    label: "Trip",
    desc: "Manifests, income & expenses",
    icon: RouteIcon,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "shipments",
    label: "Shipments",
    desc: "E-Way Bills and Part A goods",
    icon: FileText,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "consignment",
    label: "Consignment",
    desc: "Create shipments from E-Way Bills",
    icon: FileText,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "movements",
    label: "Movements",
    desc: "Monthly consignment routes and load details",
    icon: Truck,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "lr",
    label: "LR",
    desc: "Combine shipments into Lorry Receipts",
    icon: Truck,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "manifest",
    label: "Manifest",
    desc: "Delivery manifests and LR links",
    icon: ClipboardList,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "ltms-manifest",
    label: "Manifest",
    desc: "Update transporter on consignment E-Way Bills",
    icon: ClipboardList,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "outward-pod",
    label: "Outward POD",
    desc: "Create and view outward proof of delivery",
    icon: FilePenLine,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "trip-averages",
    label: "Trip Averages",
    desc: "Monthly distribution analysis",
    icon: BarChart2,
    adminOnly: true,
    dividerBefore: false,
  },
  {
    id: "trip-details",
    label: "Booking Report",
    desc: "Your branch booking and expense report",
    icon: FileText,
    adminOnly: false,
    basicOnly: true,
    dividerBefore: false,
  },
  {
    id: "fastag-report",
    label: "Fastag Balance",
    desc: "Live vehicle balances & recharges",
    icon: CreditCard,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "rental-advance",
    label: "Rental Advance",
    desc: "Live rental paid and outstanding balances",
    icon: TrendingUp,
    adminOnly: false,
    dividerBefore: false,
  },
  {
    id: "import-trips",
    label: "Import Trips",
    desc: "Bulk import historical trips",
    icon: Upload,
    adminOnly: true,
    dividerBefore: true,
  },
] as const;

type TabId = (typeof ALL_TABS)[number]["id"];

export type OperationsMode = "tms" | "ltms";

export function OperationsPage({ mode = "tms" }: { mode?: OperationsMode } = {}) {
  const { user } = useSession();
  const isAdmin = isAdminLike(user?.role);
  const isViewer = user?.role === "viewer";

  const TABS = ALL_TABS.filter((t) => {
    const isLtmsTab =
      t.id === "trip" ||
      t.id === "shipments" ||
      t.id === "consignment" ||
      t.id === "movements" ||
      t.id === "ltms-manifest" ||
      t.id === "outward-pod" ||
      t.id === "fastag-report" ||
      t.id === "rental-advance";
    if (mode === "ltms" && !isLtmsTab) return false;
    if (mode === "tms" && isLtmsTab) return false;
    if ("basicOnly" in t && t.basicOnly && user?.role !== "basic") return false;
    return isViewer ? t.id !== "import-trips" : isAdmin || !t.adminOnly;
  });
  const [tab, setTab] = useState<TabId>(mode === "ltms" ? "trip" : "lr");
  const [navOpen, setNavOpen] = useState(true);
  const [consignmentCreateOpen, setConsignmentCreateOpen] = useState(false);
  const [tripFormOpen, setTripFormOpen] = useState(false);

  const defaultTab: TabId = mode === "ltms" ? "trip" : "lr";
  const safeTab: TabId = (TABS.find((t) => t.id === tab) ? tab : defaultTab) as TabId;
  const active = TABS.find((t) => t.id === safeTab) ?? TABS[0];
  const fullBleedConsignment = safeTab === "consignment" && consignmentCreateOpen;
  // Trip forms hide the sidebar but keep the standard page width and margins.
  const fullBleed = fullBleedConsignment;

  return (
    <AppShell
      mainClassName={fullBleed ? "w-full max-w-none px-1 py-1 sm:px-1 sm:py-1" : undefined}
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <Link to={mode === "ltms" ? "/ltms" : "/tms"} className="hover:text-foreground">
            {mode === "ltms" ? "LTMS" : "TMS"}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Operations</span>
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
        className={`grid items-start ${fullBleed ? "gap-0" : "gap-6"} ${navOpen ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {/* Desktop left nav */}
        {navOpen && (
          <SharedSidebar open={navOpen} width="220px" label="Operations">
            <ul className="space-y-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                const isActive = t.id === safeTab;
                return (
                  <li key={t.id}>
                    {t.dividerBefore && <div className="my-2 border-t border-border" />}
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
          </SharedSidebar>
        )}

        {/* Mobile dropdown navigation */}
        {!fullBleed && (
          <MobileTabDropdown tabs={TABS} activeId={safeTab} label="Operations" onChange={setTab} />
        )}

        <div className={`animate-fade-in min-w-0 ${navOpen ? "lg:col-start-2" : ""}`}>
          {!fullBleed && (
            <header className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">{active?.label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{active?.desc}</p>
            </header>
          )}
          {safeTab === "trip" && (
            <TabErrorBoundary label="Trip">
              <Trips
                onSidebarVisibilityChange={(visible) => {
                  setNavOpen(visible);
                  setTripFormOpen(!visible);
                }}
              />
            </TabErrorBoundary>
          )}
          {safeTab === "shipments" && (
            <TabErrorBoundary label="Shipments">
              <ShipmentList canCreate={false} />
            </TabErrorBoundary>
          )}
          {safeTab === "consignment" && (
            <TabErrorBoundary label="Consignment">
              <ConsignmentList
                onSidebarVisibilityChange={setNavOpen}
                onCreateModeChange={setConsignmentCreateOpen}
              />
            </TabErrorBoundary>
          )}
          {safeTab === "movements" && (
            <TabErrorBoundary label="Movements">
              <MovementList />
            </TabErrorBoundary>
          )}
          {safeTab === "lr" && (
            <TabErrorBoundary label="LR">
              <LorryReceiptList />
            </TabErrorBoundary>
          )}
          {safeTab === "manifest" && (
            <TabErrorBoundary label="Manifest">
              <ManifestList />
            </TabErrorBoundary>
          )}
          {safeTab === "ltms-manifest" && (
            <TabErrorBoundary label="Manifest">
              <LtmsManifestList onSidebarVisibilityChange={setNavOpen} />
            </TabErrorBoundary>
          )}
          {safeTab === "outward-pod" && (
            <TabErrorBoundary label="Outward POD">
              <OutwardPOD />
            </TabErrorBoundary>
          )}
          {safeTab === "trip-averages" && (isAdmin || isViewer) && (
            <TabErrorBoundary label="Trip Averages">
              <TripAveragesPanel />
            </TabErrorBoundary>
          )}
          {safeTab === "trip-details" && user?.role === "basic" && (
            <TabErrorBoundary label="Booking Report">
              <TripDetailsPanel />
            </TabErrorBoundary>
          )}
          {safeTab === "fastag-report" && (
            <TabErrorBoundary label="Fastag Balance">
              <ReportFiltersContext.Provider value={{ branchId: "all", financialYear: "none" }}>
                <FastagLedger />
              </ReportFiltersContext.Provider>
            </TabErrorBoundary>
          )}
          {safeTab === "rental-advance" && (
            <TabErrorBoundary label="Rental Advance">
              <ApprovalChargeAdvanceReport />
            </TabErrorBoundary>
          )}
          {safeTab === "import-trips" && isAdmin && (
            <TabErrorBoundary label="Import Trips">
              <TripImport embedded />
            </TabErrorBoundary>
          )}
        </div>
      </div>
    </AppShell>
  );
}
