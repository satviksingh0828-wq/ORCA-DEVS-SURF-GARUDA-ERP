import { createFileRoute } from "@tanstack/react-router";
import { handleLtmsReportMcpRequest } from "@/lib/ltms-report-mcp.server";

export const Route = createFileRoute("/api/mcp/ltms-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => handleLtmsReportMcpRequest(request),
    },
  },
});
