import { createFileRoute } from "@tanstack/react-router";
import { AccountsFinanceRoute } from "@/components/accounts/AccountsFinancePage";
export const Route = createFileRoute("/accounts/finance")({ component: AccountsFinanceRoute });
