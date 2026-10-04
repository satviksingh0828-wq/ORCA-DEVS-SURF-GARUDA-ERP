import { createFileRoute } from "@tanstack/react-router";
import { ScreenControlConnectionHost } from "@/components/ScreenControlConnectionHost";

export const Route = createFileRoute("/screen-control-host")({
  component: ScreenControlConnectionHost,
});
