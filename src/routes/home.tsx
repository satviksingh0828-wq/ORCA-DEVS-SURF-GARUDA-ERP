import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Landmark,
  CalendarCheck,
  Database,
  FileText,
  Settings2,
  Truck,
  Users,
  Wallet,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/session";
import { PoweredBy } from "@/components/PoweredBy";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Workspace — Garuda Logistics Solutions | ORCA DEVS SURF" },
      {
        name: "description",
        content:
          "Garuda Logistics Solutions workspace: operations, masters, dashboard, reports, users and settings modules.",
      },
      { property: "og:title", content: "Workspace — Garuda Logistics Solutions" },
      {
        property: "og:description",
        content: "Operations, masters, dashboard, reports, users and settings in one workspace.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <HomePage />
    </RequireAuth>
  ),
});

const BASIC_MODULES = [
  {
    key: "finance",
    label: "Finance",
    desc: "Submit income and expenditure for approval",
    icon: Landmark,
    active: true,
    to: "/finance" as const,
    roles: ["basic"] as const,
  },
  {
    key: "operation",
    label: "Operation",
    desc: "Trips, consignments & dispatch",
    icon: Truck,
    active: true,
    to: "/operations" as const,
    roles: ["admin", "basic", "viewer"] as const,
  },
  {
    key: "masters",
    label: "Masters",
    desc: "Vehicles, drivers, transporters & locations",
    icon: Database,
    active: true,
    to: "/masters" as const,
    roles: ["admin", "basic", "viewer"] as const,
  },
  {
    key: "hr-master",
    label: "HR Master",
    desc: "Employees, departments & positions",
    icon: Users,
    active: true,
    to: "/employees" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "hr-attendance",
    label: "HR Attendance",
    desc: "Marking, history & holidays",
    icon: CalendarCheck,
    active: true,
    to: "/attendance" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "hr-payroll",
    label: "HR Payroll",
    desc: "Salary, loans & deductions",
    icon: Wallet,
    active: true,
    to: "/payroll" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "hr-data",
    label: "HR Data",
    desc: "Your profile, attendance & payroll",
    icon: UserRound,
    active: true,
    to: "/hr-data" as const,
    roles: ["basic"] as const,
  },
  {
    key: "dashboard",
    label: "Dashboard",
    desc: "Profit & loss, revenue overview",
    icon: BarChart3,
    active: true,
    to: "/dashboard" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "reports",
    label: "Reports",
    desc: "P&L comparison & period reports",
    icon: FileText,
    active: true,
    to: "/reports" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "users",
    label: "Users",
    desc: "Roles, access & activity log",
    icon: Users,
    active: true,
    to: "/users" as const,
    roles: ["admin"] as const,
  },
  {
    key: "settings",
    label: "Settings",
    desc: "Company, branches, departments & appearance",
    icon: Settings2,
    active: true,
    to: "/settings" as const,
    roles: ["admin"] as const,
  },
] as const;

const ADMIN_VIEWER_MODULES = [
  {
    key: "tms",
    label: "TMS",
    desc: "Operations, masters, dashboards & reports",
    icon: Truck,
    active: true,
    to: "/tms" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "hrms",
    label: "HRMS",
    desc: "Employees, attendance, payroll & HR dashboards",
    icon: Users,
    active: true,
    to: "/hrms" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "accounts",
    label: "Accounts",
    desc: "Branch bank & cash account masters",
    icon: Landmark,
    active: true,
    to: "/accounts" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
  },
  {
    key: "settings",
    label: "Settings",
    desc: "Universal theme & passkey security",
    icon: Settings2,
    active: true,
    to: "/settings" as const,
    roles: ["admin"] as const,
  },
  {
    key: "users",
    label: "Users",
    desc: "Users, devices & activity logs",
    icon: Users,
    active: true,
    to: "/users" as const,
    roles: ["admin"] as const,
  },
] as const;

function HomePage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 700);
    return () => clearTimeout(t);
  }, []);

  const role = user?.role ?? "basic";
  const moduleSource = role === "basic" ? BASIC_MODULES : ADMIN_VIEWER_MODULES;
  const MODULES = moduleSource.filter((m) => (m.roles as readonly string[]).includes(role));

  return (
    <AppShell>
      <div className="animate-fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">Workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Garuda Logistics Solutions</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {role === "admin" ? "Select a module" : "Select a module"}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {loading
          ? Array.from({ length: MODULES.length }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))
          : MODULES.map((m, i) => {
              const Icon = m.icon;
              const enabled = "active" in m && m.active;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() =>
                    enabled && "to" in m && m.to
                      ? navigate({ to: m.to })
                      : toast.info(`${m.label} module is coming soon`)
                  }
                  style={{ animationDelay: `${i * 55}ms` }}
                  className="group surface-card animate-fade-up relative flex h-40 flex-col items-start p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
                >
                  <span
                    className={`flex size-11 items-center justify-center rounded-xl transition-colors ${
                      enabled
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                    }`}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="mt-4 text-base font-semibold tracking-tight">{m.label}</span>
                  <span className="mt-1 text-sm text-muted-foreground">{m.desc}</span>
                  <span className="absolute right-5 top-6 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {enabled ? (
                      <ArrowRight className="size-4 text-primary transition-transform group-hover:translate-x-1" />
                    ) : (
                      "Soon"
                    )}
                  </span>
                </button>
              );
            })}
      </div>

      <PoweredBy className="mt-12 text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50" />
    </AppShell>
  );
}
