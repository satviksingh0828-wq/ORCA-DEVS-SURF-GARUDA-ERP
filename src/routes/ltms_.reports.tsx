import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MonthlyMISReport } from "@/components/reports/MonthlyMISReport";

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
            <Link to="/home" className="hover:text-foreground">Workspace</Link>
            <ChevronRight className="size-3.5" />
            <Link to="/ltms" className="hover:text-foreground">LTMS</Link>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">Reports</span>
          </span>
        }
      >
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">ADMIN MIS</h1>
          <p className="mt-1 text-sm text-muted-foreground">Depot submissions and compliance reporting for LTMS.</p>
        </header>
        <MonthlyMISReport />
      </AppShell>
    </RequireAuth>
  ),
});

export default Route;
