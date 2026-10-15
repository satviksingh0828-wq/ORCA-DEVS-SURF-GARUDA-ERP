import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { WmsStandalone } from "@/components/WmsStandalone";

export const Route = createFileRoute("/picking-tickets/print-all")({
  component: () => (
    <RequireAuth>
      <WmsStandalone />
    </RequireAuth>
  ),
});
