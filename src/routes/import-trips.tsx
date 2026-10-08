import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { TripImport } from "@/components/import/TripImport";

export const Route = createFileRoute("/import-trips")({
  component: () => (
    <RequireAuth>
      <TripImport />
    </RequireAuth>
  ),
});
