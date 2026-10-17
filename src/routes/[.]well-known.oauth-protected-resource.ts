import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthProtectedResourceMetadata } from "@/lib/ltms-report-mcp-oauth.server";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthProtectedResourceMetadata(request),
    },
  },
});
