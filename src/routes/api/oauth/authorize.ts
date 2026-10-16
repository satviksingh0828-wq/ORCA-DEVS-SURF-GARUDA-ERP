import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthAuthorize } from "@/lib/ltms-report-mcp-oauth.server";

export const Route = createFileRoute("/api/oauth/authorize")({
  server: {
    handlers: {
      GET: ({ request }) => handleOAuthAuthorize(request),
      POST: ({ request }) => handleOAuthAuthorize(request),
    },
  },
});
