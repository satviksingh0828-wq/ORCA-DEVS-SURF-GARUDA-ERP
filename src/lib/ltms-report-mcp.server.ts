import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { registerLtmsReportTools } from "@/lib/ltms-report-mcp-data.server";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleLtmsReportMcpRequest(request: Request): Promise<Response> {
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(orca_mcp_[A-Za-z0-9_-]{40,60})$/i);
  if (!match) return jsonError("A valid MCP bearer key is required.", 401);

  try {
    const { createHash } = await import("node:crypto");
    const tokenHash = createHash("sha256").update(match[1]).digest("hex");
    // This table is server-only and intentionally omitted from generated database types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: key, error } = await db
      .from("ltms_report_mcp_keys")
      .select("id,created_by")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      console.error("[ltms-report-mcp] Could not validate access key:", error.code);
      return jsonError(
        "MCP access is not configured. An administrator must apply the database migration.",
        503,
      );
    }
    if (!key) return jsonError("The MCP key is invalid or has been revoked.", 401);

    const { data: issuer, error: issuerError } = await db
      .from("app_users")
      .select("id,role,is_active,is_paused")
      .eq("id", key.created_by)
      .maybeSingle();
    if (issuerError) {
      console.error("[ltms-report-mcp] Could not verify key issuer:", issuerError.code);
      return jsonError("MCP access is temporarily unavailable.", 503);
    }
    if (!issuer || issuer.role !== "admin" || !issuer.is_active || issuer.is_paused)
      return jsonError("The key issuer is no longer an active administrator.", 401);

    const { error: usageError } = await db
      .from("ltms_report_mcp_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id)
      .is("revoked_at", null);
    if (usageError) {
      console.error("[ltms-report-mcp] Could not record key usage:", usageError.code);
      return jsonError("MCP access is temporarily unavailable.", 503);
    }

    const server = new McpServer({
      name: "ORCA DEVS SURF LTMS Reports",
      version: "1.0.0",
    });
    registerLtmsReportTools(server, db);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 1024 * 1024,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Vary", "Authorization");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error(
      "[ltms-report-mcp] Request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return jsonError("The MCP request could not be processed.", 500);
  }
}
