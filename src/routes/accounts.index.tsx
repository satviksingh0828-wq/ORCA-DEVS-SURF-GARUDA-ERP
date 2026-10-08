import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";

export const Route = createFileRoute("/accounts/")({
  component: () => (
    <AccountsAccessGuard>
      <Navigate to="/accounts/masters/bank" replace />
    </AccountsAccessGuard>
  ),
});
