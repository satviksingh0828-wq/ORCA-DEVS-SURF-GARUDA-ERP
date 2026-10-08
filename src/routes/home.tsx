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

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Workspace — ORCA DEVS SURF" },
      {
        name: "description",
        content:
          "ORCA DEVS SURF workspace: operations, masters, dashboard, reports, users and settings modules.",
      },
      { property: "og:title", content: "Workspace — ORCA DEVS SURF" },
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
    key: "ltms",
    label: "LTMS",
    desc: "Branch operations, finance, reports, billing & masters",
    icon: Truck,
    active: true,
    to: "/ltms" as const,
    roles: ["basic"] as const,
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
    key: "ltms",
    label: "LTMS",
    desc: "Logistics finance, income & expenditure",
    icon: Truck,
    active: true,
    to: "/ltms" as const,
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
    <AppShell variant="ltms" shellTitle="Garuda ERP">
      <div className="grid w-full grid-cols-1 gap-3 px-1 pt-4 sm:grid-cols-2 sm:px-2 lg:grid-cols-4">
        {loading
          ? Array.from({ length: MODULES.length }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
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
                  className="group surface-card animate-fade-up relative flex h-36 flex-col items-start p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
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
                  <span className="mt-3 text-base font-semibold tracking-tight">{m.label}</span>
                  <span className="mt-1 text-sm text-muted-foreground">{m.desc}</span>
                  <span className="absolute right-4 top-4 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
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
    </AppShell>
  );
}
