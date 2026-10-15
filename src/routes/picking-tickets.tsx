import { createFileRoute } from "@tanstack/react-router";
import { WmsStandalone } from "@/components/WmsStandalone";

export const Route = createFileRoute("/picking-tickets")({
  component: WmsStandalone,
});
