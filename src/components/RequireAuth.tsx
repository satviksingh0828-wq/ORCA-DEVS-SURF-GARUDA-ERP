import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { ModuleLoadingScreen } from "@/components/ModuleLoadingScreen";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const shellTitle = pathname.startsWith("/wms")
    ? "WMS"
    : ["/employees", "/attendance", "/payroll", "/hr-data", "/hr-dashboard", "/dashboard"].some(
          (path) => pathname === path || pathname.startsWith(`${path}/`),
        )
      ? "HRMS"
      : pathname.startsWith("/accounts")
        ? "Accounts"
        : pathname.startsWith("/settings")
          ? "Settings"
          : pathname.startsWith("/users") || pathname.startsWith("/system")
            ? "System"
            : ["/operations", "/masters", "/finance", "/reports", "/cash-reports", "/ltms"].some(
                  (path) => pathname === path || pathname.startsWith(`${path}/`),
                )
              ? "LTMS"
              : "Garuda Logistics Solutions";

  useEffect(() => {
    if (ready && !user) navigate({ to: "/", replace: true });
  }, [ready, user, navigate]);

  if (!ready || !user) {
    return <ModuleLoadingScreen shellTitle={shellTitle} />;
  }

  return <>{children}</>;
}
