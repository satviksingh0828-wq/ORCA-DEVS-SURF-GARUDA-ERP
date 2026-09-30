import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { ReportMasterPage } from "@/components/report-master/ReportMasterPage";

export const Route = createFileRoute("/report-master")({
  head: () => ({ meta: [{ title: "Report Master — ORCA DEVS SURF" }] }),
  component: () => <RequireAuth><ReportMasterPage /></RequireAuth>,
});
