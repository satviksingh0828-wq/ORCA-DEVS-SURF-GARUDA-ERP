import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/lib/session";
import { canAccessAccounts } from "@/lib/roles";

export function AccountsAccessGuard({
  children,
  allowBasicFinance = false,
}: {
  children: ReactNode;
  allowBasicFinance?: boolean;
}) {
  const navigate = useNavigate();
  const { ready, user } = useSession();
  const allowed =
    !!user && (canAccessAccounts(user.role) || (allowBasicFinance && user.role === "basic"));

  useEffect(() => {
    if (ready && !allowed) {
      navigate({ to: user?.role === "basic" ? "/accounts/finance" : "/home", replace: true });
    }
  }, [navigate, ready, user, allowed]);

  return <RequireAuth>{ready && allowed ? children : null}</RequireAuth>;
}
