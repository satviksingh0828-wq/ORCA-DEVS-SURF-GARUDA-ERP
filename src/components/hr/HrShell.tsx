import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { HrSectionNav, type HrArea } from "@/components/hr/HrSectionNav";

const areaLabels: Record<HrArea, string> = {
  master: "HR Master",
  attendance: "HR Attendance",
  payroll: "HR Payroll",
};

/** Shared page shell for each independent HR workspace module. */
export function HrShell({ area, children }: { area: HrArea; children: ReactNode }) {
  const label = areaLabels[area];
  const [navOpen, setNavOpen] = useState(true);

  return (
    <AppShell
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
        className={`grid gap-6 ${navOpen ? "xl:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {navOpen && <HrSectionNav area={area} desktop />}
        <div className="min-w-0">
          <HrSectionNav area={area} />
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          </header>
          {children}
        </div>
      </div>
    </AppShell>
  );
}
