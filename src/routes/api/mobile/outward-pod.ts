import { createFileRoute } from "@tanstack/react-router";
import { handleOutwardPODGet, handleOutwardPODPost } from "@/lib/outward-pod-mobile-api.server";

export const Route = createFileRoute("/api/mobile/outward-pod")({
  server: {
    handlers: {
      GET: ({ request }) => handleOutwardPODGet(request),
      POST: ({ request }) => handleOutwardPODPost(request),
    },
  },
});
