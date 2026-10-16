import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { LtmsDashboard } from "@/components/ltms/LtmsDashboard";
import { LtmsWorkbook } from "@/components/ltms/LtmsWorkbook";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { useState } from "react";

export const Route = createFileRoute("/ltms_/dashboard")({
  head: () => ({ meta: [{ title: "LTMS Dashboard — ORCA DEVS SURF" }] }),
  component: () => (
    <RequireAuth>
      <DashboardPage />
    </RequireAuth>
  ),
});
export default Route;

function DashboardPage() {
  const { user } = useSession();
  const [activeTab, setActiveTab] = useState("data");
  if (!isAdminLike(user?.role)) {
    return (
      <AppShell variant="ltms">
        <div className="rounded-xl border bg-card p-6">
          <h1 className="text-xl font-semibold">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The LTMS Dashboard is available to administrators only.
          </p>
        </div>
      </AppShell>
    );
  }
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
          <span className="text-foreground">Dashboard</span>
        </span>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[192px_minmax(0,1fr)] ltms-reference-shell">
        <LtmsSidebar
          section="dashboard"
          activeTabId={activeTab}
          onSelectTab={setActiveTab}
          label="LTMS Dashboard"
        />
        <main className="min-w-0 ltms-reference-content">
          <header className="mb-5 ltms-reference-page-header">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              LTMS income and expenditure overview
            </p>
          </header>
          <div className="mb-5 border-b" role="tablist" aria-label="LTMS Dashboard tabs">
            {[
              { id: "data", label: "Data" },
              { id: "workbook", label: "Workbook" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div hidden={activeTab !== "data"} role="tabpanel" aria-label="Data">
            <LtmsDashboard />
          </div>
          {activeTab === "workbook" && (
            <div role="tabpanel" aria-label="Workbook">
              <LtmsWorkbook />
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
