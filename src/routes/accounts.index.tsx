import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { useSession } from "@/lib/session";

function AccountsIndex() {
  const { user } = useSession();
  return user?.role === "basic" ? (
    <AccountsAccessGuard allowBasicFinance>
      <Navigate to="/accounts/finance" replace />
    </AccountsAccessGuard>
  ) : (
    <AccountsAccessGuard>
      <Navigate to="/accounts/masters/bank" replace />
    </AccountsAccessGuard>
  );
}
export const Route = createFileRoute("/accounts/")({
  component: AccountsIndex,
});
