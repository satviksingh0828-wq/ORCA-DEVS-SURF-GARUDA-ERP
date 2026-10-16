import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthAuthorizationServerMetadata } from "@/lib/ltms-report-mcp-oauth.server";

export const Route = createFileRoute("/api/oauth/authorization-server")({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthAuthorizationServerMetadata(request),
    },
  },
});
