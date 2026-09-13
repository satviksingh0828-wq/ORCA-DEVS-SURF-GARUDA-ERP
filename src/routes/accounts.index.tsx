import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, Database, FileText, BookOpen } from "lucide-react";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { WorkspaceModulePage } from "@/components/WorkspaceModulePage";

export const Route = createFileRoute("/accounts/")({
  component: () => (
    <AccountsAccessGuard>
      <WorkspaceModulePage
        eyebrow="Workspace / Accounts"
        title="Accounts"
        description="Maintain the bank and cash account records for every branch."
        tiles={[
          {
            key: "masters",
            label: "Masters",
            desc: "Branch bank and cash account records",
            icon: Database,
            to: "/accounts/masters",
          },
          {
            key: "journal",
            label: "Journal",
            desc: "Balanced journal entries and vouchers",
            icon: FileText,
            to: "/accounts/journal",
          },
          {
            key: "final-accounts",
            label: "Final Accounts",
            desc: "Balance Sheet and Profit & Loss reports",
            icon: BarChart3,
            to: "/accounts/final",
          },
        ]}
      />
    </AccountsAccessGuard>
  ),
});
