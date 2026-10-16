import { createFileRoute } from "@tanstack/react-router";
import { AccountsGstRoute } from "@/components/accounts/AccountsGstPage";
export const Route = createFileRoute("/accounts/gst")({ component: AccountsGstRoute });
