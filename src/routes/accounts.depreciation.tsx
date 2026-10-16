import { createFileRoute } from "@tanstack/react-router";
import { AccountsDepreciationRoute } from "@/components/accounts/AccountsDepreciationPage";

export const Route = createFileRoute("/accounts/depreciation")({
  component: AccountsDepreciationRoute,
});
