import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { BasicHrDataPage } from "@/components/hr/BasicHrDataPage";

export const Route = createFileRoute("/hr-data")({
  component: () => (
    <RequireAuth>
      <AppShell>
        <BasicHrDataPage />
      </AppShell>
    </RequireAuth>
  ),
});
