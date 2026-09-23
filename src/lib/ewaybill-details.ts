import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

const inputSchema = z.object({
  token: z.string().min(1),
  branchId: z.string().uuid(),
  ewayBillNumber: z.string().regex(/^\d{12}$/),
});

export const serverFetchEwayBillDetails = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    const session = await verifyAppToken(data.token);
    if (!session) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (session.role === "basic") {
      const { data: assignment, error: assignmentError } = await supabaseAdmin
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", session.uid)
        .eq("branch_id", data.branchId)
        .maybeSingle();
      if (assignmentError || !assignment) throw new Error("You do not have access to this branch");
    }

    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey) {
      throw new Error("EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured on the ORCA server");
    }

    const url = `${baseUrl}/v1/branches/${encodeURIComponent(data.branchId)}/ewaybills/details?ewbNo=${encodeURIComponent(data.ewayBillNumber)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-API-Key": apiKey },
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || body?.ok === false) {
      const error = body?.error as Record<string, unknown> | undefined;
      const details = error?.details as Record<string, unknown> | undefined;
      const detailText = details ? `: ${JSON.stringify(details)}` : "";
      throw new Error(`${String(error?.message ?? "Could not fetch E-Way Bill details")} (HTTP ${response.status})${detailText}`);
    }
    return body?.data ?? body;
  });
