import { createFileRoute, Navigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { useSession } from "@/lib/session";

function HrmsLanding() {
  const { user } = useSession();
  // Basic users cannot open HR dashboards; preserve their employee landing.
  return <Navigate to={user?.role === "basic" ? "/employees" : "/dashboard/attendance"} replace />;
}

export const Route = createFileRoute("/hrms")({
  component: () => (
    <RequireAuth>
      <HrmsLanding />
    </RequireAuth>
  ),
});
