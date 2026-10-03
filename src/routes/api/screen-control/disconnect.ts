import { createFileRoute } from "@tanstack/react-router";
import { endScreenControlSessionsForToken } from "@/lib/screen-control.server";

export const Route = createFileRoute("/api/screen-control/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
          return Response.json({ error: "Origin not allowed" }, { status: 403 });
        try {
          const body = (await request.json()) as { sessionToken?: string };
          if (!body.sessionToken)
            return Response.json({ error: "Missing session" }, { status: 400 });
          await endScreenControlSessionsForToken(body.sessionToken, "tab_closed_or_reloaded");
          return new Response(null, { status: 204 });
        } catch {
          // Best-effort teardown: the peer connection and screen-capture tracks
          // also close when the owning browser tab is destroyed.
          return new Response(null, { status: 204 });
        }
      },
    },
  },
});
