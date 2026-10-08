import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronRight,
  FileText,
  ReceiptText,
  Truck,
  Package,
  Banknote,
  CircleDollarSign,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { TripBilling } from "@/components/reports/TripBilling";
import { SourceBilling } from "@/components/reports/SourceBilling";
import { TransporterBilling } from "@/components/reports/TransporterBilling";
import { WorkmenBilling } from "@/components/reports/WorkmenBilling";
import { UnloadingReceived } from "@/components/reports/UnloadingReceived";
import { ApprovalIncome } from "@/components/reports/ApprovalIncome";
import { useSession } from "@/lib/session";

const TABS = [
  {
    id: "trip-billing",
    label: "Trip Billing",
    desc: "Closed-trip income and expenditure",
    icon: ReceiptText,
  },
  {
    id: "source-billing",
    label: "Source Billing",
    desc: "Bill consignments by source",
    icon: FileText,
  },
  {
    id: "unloading-received",
    label: "Unloading Received",
    desc: "Post Stock Inward unloading receipts",
    icon: Banknote,
  },
  {
    id: "approval-income",
    label: "Approval Income",
    desc: "Post Stock Inward approval charges",
    icon: CircleDollarSign,
  },
  {
    id: "transporter-billing",
    label: "Transporter Bill",
    desc: "Bill transporter-source expenditure",
    icon: Truck,
  },
  {
    id: "workmen-billing",
    label: "Workmen Billing",
    desc: "Bill loading and unloading workmen charges",
    icon: Package,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/ltms_/billing")({
  head: () => ({
    meta: [
      { title: "LTMS Billing — ORCA DEVS SURF" },
      {
        name: "description",
        content: "Closed-trip billing and income/expenditure details.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <BillingPage />
    </RequireAuth>
  ),
});

export default Route;

function BillingPage() {
  const { user } = useSession();
  const visibleTabs =
    user?.role === "basic" ? TABS.filter((item) => item.id !== "source-billing") : TABS;
  const [tab, setTab] = useState<TabId>("trip-billing");
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
      items: visibleTabs.map((item) => ({
        id: item.id,
        label: item.label,
        active: item.id === safeTab,
        onSelect: () => setTab(item.id),
      })),
    },
    {
      label: "Reports",
      items: [{ id: "reports", label: "Reports", to: "/ltms/reports" as const }],
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
          <span className="text-foreground">Billing</span>
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
        {navOpen && <LtmsSidebar groups={ltmsSidebarGroups} open={navOpen} label="LTMS billing" />}
        <MobileTabDropdown
          tabs={visibleTabs}
          activeId={safeTab}
          label="Billing"
          onChange={setTab}
        />
        <div className="animate-fade-in min-w-0 ltms-reference-content">
          <header className="mb-6 ltms-reference-page-header">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {safeTab === "trip-billing" && <TripBilling />}
          {safeTab === "source-billing" && <SourceBilling />}
          {safeTab === "unloading-received" && <UnloadingReceived />}
          {safeTab === "approval-income" && <ApprovalIncome />}
          {safeTab === "transporter-billing" && <TransporterBilling />}
          {safeTab === "workmen-billing" && <WorkmenBilling />}
        </div>
      </div>
    </AppShell>
  );
}
