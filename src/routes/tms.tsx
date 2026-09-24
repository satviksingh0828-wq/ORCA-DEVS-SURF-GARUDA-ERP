import { createFileRoute } from "@tanstack/react-router";
import { FileText, Truck, Wallet } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { WorkspaceModulePage } from "@/components/WorkspaceModulePage";

export const Route = createFileRoute("/tms")({
  component: () => (
    <RequireAuth>
      <WorkspaceModulePage
        eyebrow="Workspace / TMS"
        title="TMS"
        description="Operations, masters, dashboards and reports for transport management."
        allowedRoles={["admin", "semi_admin", "basic", "viewer"]}
        tiles={[
          {
            key: "operation",
            label: "Operation",
            desc: "Trips, consignments & dispatch",
            icon: Truck,
            to: "/operations",
            roles: ["admin", "semi_admin", "viewer"],
          },
          {
            key: "reports",
            label: "Reports",
            desc: "P&L comparison & period reports",
            icon: FileText,
            to: "/reports",
            roles: ["admin", "semi_admin", "viewer"],
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
