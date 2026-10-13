import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/driver/theme")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("app_settings")
            .select("theme")
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          return Response.json({ theme: data?.theme ?? "garuda" });
        } catch {
          // Mirrors the web ThemeProvider fallback when settings are unavailable.
          return Response.json({ theme: "garuda" });
        }
      },
    },
  },
});
