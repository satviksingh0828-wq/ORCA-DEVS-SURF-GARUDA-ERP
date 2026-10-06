import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronRight,
  FileText,
  ReceiptText,
  Truck,
  Package,
  Banknote,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { SharedSidebar } from "@/components/SharedSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { TripBilling } from "@/components/reports/TripBilling";
import { SourceBilling } from "@/components/reports/SourceBilling";
import { TransporterBilling } from "@/components/reports/TransporterBilling";
import { WorkmenBilling } from "@/components/reports/WorkmenBilling";
import { UnloadingReceived } from "@/components/reports/UnloadingReceived";

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
  const [tab, setTab] = useState<TabId>("trip-billing");
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
        className={`grid gap-6 ${navOpen ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {navOpen && (
          <SharedSidebar open={navOpen} width="220px" label="LTMS billing">
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
        <MobileTabDropdown tabs={TABS} activeId={tab} label="Billing" onChange={setTab} />
        <div className="animate-fade-in min-w-0">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {tab === "trip-billing" && <TripBilling />}
          {tab === "source-billing" && <SourceBilling />}
          {tab === "unloading-received" && <UnloadingReceived />}
          {tab === "transporter-billing" && <TransporterBilling />}
          {tab === "workmen-billing" && <WorkmenBilling />}
        </div>
      </div>
    </AppShell>
  );
}
