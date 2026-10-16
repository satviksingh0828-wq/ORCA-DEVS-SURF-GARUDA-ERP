import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthProtectedResourceMetadata } from "@/lib/ltms-report-mcp-oauth.server";

export const Route = createFileRoute("/api/oauth/resource")({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthProtectedResourceMetadata(request),
    },
  },
});
