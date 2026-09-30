import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { OperationsPage } from "@/routes/operations";

export const Route = createFileRoute("/ltms_/operations")({
  head: () => ({
    meta: [
      { title: "LTMS Operations — ORCA DEVS SURF" },
      {
        name: "description",
        content: "E-Way Bill management for logistics operations.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <OperationsPage mode="ltms" />
    </RequireAuth>
  ),
});

export default Route;
