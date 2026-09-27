import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "@/lib/user-auth";

const payloadSchema = z.record(z.string(), z.unknown());

export const serverGenerateTemporaryEwayBill = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string().min(1),
      branchId: z.string().uuid(),
      payload: payloadSchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await verifyAppToken(data.token);
    if (!session) throw new Error("Unauthorized");
    if (session.role !== "admin" && session.role !== "semi_admin") {
      throw new Error("Only administrators can generate temporary E-Way Bills");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: branch, error: branchError } = await supabaseAdmin
      .from("branches")
      .select("id")
      .eq("id", data.branchId)
      .maybeSingle();
    if (branchError) throw new Error(branchError.message);
    if (!branch) throw new Error("Selected branch was not found");

    const baseUrl = process.env.EWB_RENDER_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.EWB_RENDER_API_KEY?.trim();
    if (!baseUrl || !apiKey) {
      throw new Error(
        "EWB_RENDER_URL and EWB_RENDER_API_KEY are not configured on the ORCA server",
      );
    }

    const path =
      process.env.EWB_GENERATE_PATH?.trim() || "/v1/branches/:branchId/ewaybills/generate";
    const endpoint = path.replace(":branchId", encodeURIComponent(data.branchId));
    const response = await fetch(
      `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(data.payload),
      },
    );
    const body = await response.json().catch(() => null);
    if (
      !response.ok ||
      (body && typeof body === "object" && (body as Record<string, unknown>).ok === false)
    ) {
      const error =
        body && typeof body === "object" ? (body as Record<string, unknown>).error : null;
      const message =
        error && typeof error === "object" ? (error as Record<string, unknown>).message : null;
      throw new Error(
        `${String(message ?? "Temporary E-Way Bill generation failed")} (HTTP ${response.status})`,
      );
    }
    return { response: body, endpoint };
  });
