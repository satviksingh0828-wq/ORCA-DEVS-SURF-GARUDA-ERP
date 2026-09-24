import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { MastersPage } from "@/routes/masters";

export const Route = createFileRoute("/ltms_/masters")({
  component: () => (
    <RequireAuth>
      <MastersPage ltmsMode />
    </RequireAuth>
  ),
});

export default Route;
