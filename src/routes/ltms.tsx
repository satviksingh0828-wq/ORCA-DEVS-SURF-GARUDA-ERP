import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, Database, DollarSign } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { WorkspaceModulePage } from "@/components/WorkspaceModulePage";

export const Route = createFileRoute("/ltms")({
  component: () => (
    <RequireAuth>
      <WorkspaceModulePage
        eyebrow="Workspace / LTMS"
        title="LTMS"
        description="Logistics operations, finance and transport-management support tools."
        allowedRoles={["admin", "semi_admin", "basic", "viewer"]}
        tiles={[
          {
            key: "operations",
            label: "Operations",
            desc: "Monthly MIS and E-Way Bill management",
            icon: ClipboardList,
            to: "/ltms/operations",
          },
          {
            key: "finance",
            label: "Finance",
            desc: "Income, expenses, payroll & schedules",
            icon: DollarSign,
            to: "/finance",
          },
          {
            key: "masters",
            label: "Masters",
            desc: "Vehicles, drivers & locations",
            icon: Database,
            to: "/ltms/masters",
          },
        ]}
      />
    </RequireAuth>
  ),
});

export default Route;
