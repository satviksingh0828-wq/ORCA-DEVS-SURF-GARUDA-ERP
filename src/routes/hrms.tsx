import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { LtmsSidebar } from "@/components/ltms/LtmsSidebar";
import { HR_SIDEBAR_GROUPS } from "@/components/hr/HrShell";

export const Route = createFileRoute("/hrms")({
  component: () => (
    <RequireAuth>
      <HrmsLanding />
    </RequireAuth>
  ),
});

function HrmsLanding() {
  return (
    <AppShell variant="ltms" shellTitle="HRMS">
      <div className="grid min-h-0 gap-6 xl:grid-cols-[192px_minmax(0,1fr)]">
        <LtmsSidebar
          label="HRMS navigation"
          groups={HR_SIDEBAR_GROUPS}
          section="hr-dashboard"
          activeTabId=""
          onSelectTab={() => undefined}
        />
        <main className="min-w-0 overflow-y-auto">
          <div className="ltms-reference-page-header mb-6">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">HRMS</p>
            <h1>Human Resources Management</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Manage employees, attendance, payroll, and HR insights from one workspace.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {HR_SIDEBAR_GROUPS.map((group) => (
              <section key={group.section} className="ltms-reference-sidebar-card rounded-xl p-4">
                <h2 className="ltms-reference-group-label rounded-lg">{group.label}</h2>
                <div className="mt-2 grid gap-1">
                  {group.items.map((item) => (
                    <a
                      key={item.id}
                      href={item.to}
                      className="ltms-reference-sidebar-link rounded-lg"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
