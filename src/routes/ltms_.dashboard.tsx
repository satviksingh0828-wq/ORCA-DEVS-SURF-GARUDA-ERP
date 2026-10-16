import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { LtmsDashboard } from "@/components/ltms/LtmsDashboard";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";

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
          activeTabId="data"
          onSelectTab={() => {}}
          label="LTMS Dashboard"
        />
        <main className="min-w-0 ltms-reference-content">
          <header className="mb-5 ltms-reference-page-header">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              LTMS income and expenditure overview
            </p>
          </header>
          <div className="mb-5 border-b">
            <div
              className="inline-flex border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
              aria-current="page"
            >
              Data
            </div>
          </div>
          <LtmsDashboard />
        </main>
      </div>
    </AppShell>
  );
}
