import { createFileRoute } from "@tanstack/react-router";
import { handleOAuthClientRegistration } from "@/lib/ltms-report-mcp-oauth.server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/oauth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const response = await handleOAuthClientRegistration(request);
        const headers = new Headers(response.headers);
        Object.entries(cors).forEach(([name, value]) => headers.set(name, value));
        return new Response(response.body, { status: response.status, headers });
      },
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
    },
  },
});
