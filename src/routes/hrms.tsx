import { createFileRoute, Navigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";

export const Route = createFileRoute("/hrms")({
  component: () => (
    <RequireAuth>
      <Navigate to="/employees" replace />
    </RequireAuth>
  ),
});
