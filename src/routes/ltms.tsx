import { createFileRoute } from "@tanstack/react-router";
import { DollarSign } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { WorkspaceModulePage } from "@/components/WorkspaceModulePage";

export const Route = createFileRoute("/ltms")({
  component: () => (
    <RequireAuth>
      <WorkspaceModulePage
        eyebrow="Workspace / LTMS"
        title="LTMS"
        description="Logistics finance and transport-management support tools."
        allowedRoles={["admin", "semi_admin", "basic", "viewer"]}
        tiles={[
          {
            key: "finance",
            label: "Finance",
            desc: "Income, expenses, payroll & schedules",
            icon: DollarSign,
            to: "/finance",
          },
        ]}
      />
    </RequireAuth>
  ),
});

export default Route;
