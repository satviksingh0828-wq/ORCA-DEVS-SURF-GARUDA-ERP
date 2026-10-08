import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";

export const Route = createFileRoute("/accounts")({
  component: () => (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  ),
});
