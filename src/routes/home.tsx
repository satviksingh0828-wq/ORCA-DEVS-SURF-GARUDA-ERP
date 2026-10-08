import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Landmark,
  CalendarCheck,
  Database,
  FileText,
  PackageOpen,
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
import { serverHasWmsAccess } from "@/lib/wms-user-links";

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
  {
    key: "wms",
    label: "WMS",
    desc: "Warehouse management system",
    icon: PackageOpen,
    active: true,
    to: "/wms" as const,
    roles: ["basic"] as const,
    linkedOnly: true,
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
  {
    key: "wms",
    label: "WMS",
    desc: "Warehouse management system",
    icon: PackageOpen,
    active: true,
    to: "/wms" as const,
    roles: ["admin", "semi_admin", "viewer"] as const,
    linkedOnly: true,
  },
] as const;

function HomePage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [wmsEnabled, setWmsEnabled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.sessionToken) return undefined;
    serverHasWmsAccess({ data: { sessionToken: user.sessionToken } })
      .then(({ enabled }) => {
        if (!cancelled) setWmsEnabled(enabled);
      })
      .catch(() => {
        if (!cancelled) setWmsEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.sessionToken]);

  const role = user?.role ?? "basic";
  const moduleSource = role === "basic" ? BASIC_MODULES : ADMIN_VIEWER_MODULES;
  const MODULES = moduleSource.filter(
    (m) =>
      (m.roles as readonly string[]).includes(role) &&
      (!("linkedOnly" in m) || !m.linkedOnly || wmsEnabled),
  );

  return (
    <AppShell variant="ltms" shellTitle="Garuda ERP">
      <div className="grid w-full grid-cols-3 gap-x-2 gap-y-3 px-1 pt-3 sm:grid-cols-4 sm:px-2 md:grid-cols-6 lg:grid-cols-8">
        {loading
          ? Array.from({ length: MODULES.length }).map((_, i) => (
              <div key={i} className="flex min-h-[106px] flex-col items-center gap-2 p-2">
                <Skeleton className="size-12 rounded-2xl" />
                <Skeleton className="h-3 w-16 rounded-full" />
              </div>
            ))
          : MODULES.map((m, i) => {
              const Icon = m.icon;
              const enabled = "active" in m && m.active;
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-label={`${m.label}${enabled ? "" : " (coming soon)"}`}
                  onClick={() =>
                    enabled && "to" in m && m.to
                      ? navigate({ to: m.to })
                      : toast.info(`${m.label} module is coming soon`)
                  }
                  style={{ animationDelay: `${i * 55}ms` }}
                  className="group animate-fade-up flex min-h-[106px] flex-col items-center justify-start rounded-xl p-2 text-center transition-colors duration-200 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={`flex size-12 items-center justify-center rounded-2xl transition-colors ${
                      enabled
                        ? "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-6" />
                  </span>
                  <span className="mt-2 max-w-full text-xs font-medium leading-tight tracking-tight">
                    {m.label}
                  </span>
                  {!enabled && (
                    <span className="mt-1 text-[10px] font-medium text-muted-foreground">Soon</span>
                  )}
                </button>
              );
            })}
      </div>
    </AppShell>
  );
}
