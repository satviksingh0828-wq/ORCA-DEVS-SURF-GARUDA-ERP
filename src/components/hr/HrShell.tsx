import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { HrSectionNav, type HrArea } from "@/components/hr/HrSectionNav";
import { LtmsSidebar, type LtmsSidebarGroup } from "@/components/ltms/LtmsSidebar";

const areaLabels: Record<HrArea, string> = {
  master: "HR Master",
  attendance: "HR Attendance",
  payroll: "HR Payroll",
};

const HR_SIDEBAR_GROUPS: LtmsSidebarGroup[] = [
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
    section: "hr-payroll",
    label: "HR Payroll",
    items: [
      { id: "generate-payroll", label: "Generate Payroll", to: "/payroll/generate" },
      { id: "payroll-history", label: "Payroll History", to: "/payroll/history" },
      { id: "payroll-ledger", label: "Payroll Ledger", to: "/payroll/ledger" },
      { id: "advances", label: "Advances & Loans", to: "/payroll/advances" },
      { id: "deductions", label: "Deductions", to: "/payroll/deductions" },
      { id: "incentives", label: "Incentives", to: "/payroll/incentives" },
    ],
  },
];

/** Shared page shell for each independent HR workspace module. */
export function HrShell({ area, children }: { area: HrArea; children: ReactNode }) {
  const label = areaLabels[area];
  const [navOpen, setNavOpen] = useState(true);

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
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          title={navOpen ? "Hide sidebar" : "Show sidebar"}
          className="hidden items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:flex"
        >
          {navOpen ? (
            <PanelLeftClose className="size-3.5" />
          ) : (
            <PanelLeftOpen className="size-3.5" />
          )}
          <span>{navOpen ? "Hide sidebar" : "Show sidebar"}</span>
        </button>
      }
    >
      <div
        className={`grid gap-6 ${navOpen ? "xl:grid-cols-[192px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {navOpen && (
          <LtmsSidebar
            open={navOpen}
            label="HRMS navigation"
            groups={HR_SIDEBAR_GROUPS}
            section={`hr-${area}`}
            activeTabId=""
            onSelectTab={() => undefined}
          />
        )}
        <div className="min-w-0">
          <HrSectionNav area={area} />
          {children}
        </div>
      </div>
    </AppShell>
  );
}
