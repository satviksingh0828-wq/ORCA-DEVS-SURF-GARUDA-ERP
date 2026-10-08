import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/ltms")({
  beforeLoad: () => {
    throw redirect({ to: "/ltms/operations", replace: true });
  },
});

export default Route;
