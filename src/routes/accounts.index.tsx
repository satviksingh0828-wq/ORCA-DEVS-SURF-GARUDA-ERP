import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, BookOpen, Database, FileText, Settings2 } from "lucide-react";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { WorkspaceModulePage } from "@/components/WorkspaceModulePage";

export const Route = createFileRoute("/accounts/")({
  component: () => (
    <AccountsAccessGuard>
      <WorkspaceModulePage
        shellVariant="ltms"
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
            key: "ledger",
            label: "Ledger",
            desc: "Create, list and view ledger statements",
            icon: BookOpen,
            to: "/accounts/ledger",
          },
          {
            key: "final-accounts",
            label: "Final Accounts",
            desc: "Balance Sheet and Profit & Loss reports",
            icon: BarChart3,
            to: "/accounts/final",
          },
          {
            key: "auto-rules",
            label: "Auto Rules",
            desc: "HRMS accounting and entry verification",
            icon: Settings2,
            to: "/accounts/auto-rules",
          },
        ]}
      />
    </AccountsAccessGuard>
  ),
});
