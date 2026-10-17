import type { ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { HrSectionNav, type HrArea } from "@/components/hr/HrSectionNav";
import { LtmsSidebar, type LtmsSidebarGroup } from "@/components/ltms/LtmsSidebar";

const areaLabels: Record<HrArea, string> = {
  master: "HR Master",
  attendance: "HR Attendance",
  payroll: "HR Payroll",
};

export const HR_SIDEBAR_GROUPS: LtmsSidebarGroup[] = [
  {
    section: "hr-master",
    label: "HR Master",
    items: [
      { id: "employees", label: "Employees", to: "/employees" },
      { id: "add-employee", label: "Add Employee", to: "/employees/new" },
      { id: "departments", label: "Departments", to: "/employees/departments" },
      { id: "add-department", label: "Add Department", to: "/employees/departments/new" },
    ],
  },
  {
    section: "hr-attendance",
    label: "HR Attendance",
    items: [
      { id: "mark-attendance", label: "Mark Attendance", to: "/attendance/mark" },
      { id: "attendance-history", label: "Attendance History", to: "/attendance/history" },
      { id: "holidays", label: "Holidays", to: "/attendance/holidays" },
    ],
  },
  {
    section: "hr-dashboard",
    label: "HR Dashboard",
    items: [
      { id: "employee-dashboard", label: "Employee Dashboard", to: "/dashboard/employee" },
      { id: "attendance-dashboard", label: "Attendance Dashboard", to: "/dashboard/attendance" },
      { id: "payroll-dashboard", label: "Payroll Dashboard", to: "/dashboard/payroll" },
      { id: "hierarchy-dashboard", label: "Hierarchy Dashboard", to: "/dashboard/hierarchy" },
    ],
  },
  {
    section: "hr-payroll",
    label: "HR Payroll",
    items: [
      { id: "generate-payroll", label: "Generate Payroll", to: "/payroll/generate" },
      { id: "payroll-history", label: "Payroll History", to: "/payroll/history" },
      { id: "payroll-ledger", label: "Payroll Ledger", to: "/payroll/ledger" },
      { id: "loans", label: "Loans", to: "/payroll/loans" },
      { id: "advances", label: "Advances", to: "/payroll/advances" },
      { id: "deductions", label: "Deductions", to: "/payroll/deductions" },
      { id: "incentives", label: "Incentives", to: "/payroll/incentives" },
    ],
  },
];

/** Shared page shell for each independent HR workspace module. */
export function HrShell({ area, children }: { area: HrArea; children: ReactNode }) {
  const label = areaLabels[area];
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const areaGroup = HR_SIDEBAR_GROUPS.find((group) => group.section === `hr-${area}`);
  const activeItemId =
    areaGroup?.items.find((item) =>
      item.to ? pathname === item.to || pathname.startsWith(`${item.to}/`) : false,
    )?.id ?? (area === "master" ? "employees" : "");

  return (
    <AppShell
      variant="ltms"
      shellTitle="HRMS"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <Link to="/hrms" className="hover:text-foreground">
            HRMS
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">{label}</span>
        </span>
      }
    >
      <div className="ltms-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
        <LtmsSidebar
          label="HRMS navigation"
          groups={HR_SIDEBAR_GROUPS}
          section={`hr-${area}`}
          activeTabId={activeItemId}
          onSelectTab={(tabId) => {
            const target = areaGroup?.items.find((item) => item.id === tabId)?.to;
            if (target) navigate({ to: target as "/" });
          }}
        />
        <div className="ltms-reference-content min-w-0">
          <HrSectionNav area={area} />
          {children}
        </div>
      </div>
    </AppShell>
  );
}
