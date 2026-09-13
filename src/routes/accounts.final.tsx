import { createFileRoute } from "@tanstack/react-router";
import { FinalAccountsPage } from "@/components/accounts/FinalAccountsPage";

export const Route = createFileRoute("/accounts/final")({
  component: FinalAccountsPage,
});
