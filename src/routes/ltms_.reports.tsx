import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, FileBarChart } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { MonthlyMISReport } from "@/components/reports/MonthlyMISReport";

const TABS = [
  {
    id: "admin-mis",
    label: "ADMIN MIS",
    desc: "Depot submissions and compliance overview",
    icon: FileBarChart,
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
      >
        <ReportsTabs />
      </AppShell>
    </RequireAuth>
  ),
});

export default Route;

function ReportsTabs() {
  const [tab, setTab] = useState<TabId>("admin-mis");
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
          LTMS / Reports
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{active.label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
      </header>
      <MobileTabDropdown tabs={TABS} activeId={tab} label="Reports" onChange={setTab} />
      <div className="hidden gap-2 rounded-xl border border-border bg-muted/30 p-2 lg:flex">
        {TABS.map((item) => {
          const Icon = item.icon;
          const selected = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-left text-sm transition-colors ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </div>
      <MonthlyMISReport />
    </div>
  );
}
