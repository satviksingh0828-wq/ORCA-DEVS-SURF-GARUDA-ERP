import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Database, DollarSign, FileCog, FileText, Truck, Wallet } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { WorkspaceModulePage } from "@/components/WorkspaceModulePage";

export const Route = createFileRoute("/tms")({
  component: () => (
    <RequireAuth>
      <WorkspaceModulePage
        eyebrow="Workspace / TMS"
        title="TMS"
        description="Operations, masters, dashboards and reports for transport management."
        tiles={[
          {
            key: "operation",
            label: "Operation",
            desc: "Trips, consignments & dispatch",
            icon: Truck,
            to: "/operations",
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
            desc: "Vehicles, drivers, transporters & locations",
            icon: Database,
            to: "/masters",
          },
          {
            key: "dashboard",
            label: "Dashboard",
            desc: "Profit & loss, revenue overview",
            icon: BarChart3,
            to: "/dashboard",
            roles: ["admin"],
          },
          {
            key: "reports",
            label: "Reports",
            desc: "P&L comparison & period reports",
            icon: FileText,
            to: "/reports",
          },
          {
            key: "cash-reports",
            label: "Cash Reports",
            desc: "Cash ledger, receipts & transporter payments",
            icon: Wallet,
            to: "/cash-reports",
            roles: ["admin", "semi_admin", "viewer"],
          },
        ]}
      />
    </RequireAuth>
  ),
});
