import { createFileRoute } from "@tanstack/react-router";
import { verifyMobileCredentials } from "@/lib/outward-pod-mobile-api.server";

export const Route = createFileRoute("/api/mobile/verify")({
  server: { handlers: { POST: ({ request }) => verifyMobileCredentials(request) } },
});
