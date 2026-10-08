import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { FinancePage } from "@/routes/finance";

export const Route = createFileRoute("/ltms_/finance")({
  head: () => ({
    meta: [
      { title: "LTMS Finance — ORCA DEVS SURF" },
      {
        name: "description",
        content: "LTMS income, expenditure, payroll, fixed income and vehicle costs.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <FinancePage ltmsMode />
    </RequireAuth>
  ),
});

export default Route;
