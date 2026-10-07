import { createFileRoute, redirect } from "@tanstack/react-router";
import { BarChart3, CalendarCheck, Users, Wallet } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { WorkspaceModulePage } from "@/components/WorkspaceModulePage";

export const Route = createFileRoute("/hrms")({
  beforeLoad: () => {
    throw redirect({ to: "/employees" });
  },
  component: () => (
    <RequireAuth>
      <WorkspaceModulePage
        eyebrow="Workspace / HRMS"
        title="HRMS"
        description="Employees, attendance, payroll and HR dashboards."
        tiles={[
          {
            key: "hr-master",
            label: "HR Master",
            desc: "Employees, departments & positions",
            icon: Users,
            to: "/employees",
          },
          {
            key: "hr-attendance",
            label: "HR Attendance",
            desc: "Marking, history & holidays",
            icon: CalendarCheck,
            to: "/attendance",
          },
          {
            key: "hr-payroll",
            label: "HR Payroll",
            desc: "Salary, loans & deductions",
            icon: Wallet,
            to: "/payroll",
          },
          {
            key: "hr-dashboard",
            label: "Dashboard",
            desc: "Employee, attendance, payroll & hierarchy insights",
            icon: BarChart3,
            to: "/dashboard/employee",
          },
        ]}
      />
    </RequireAuth>
  ),
});
