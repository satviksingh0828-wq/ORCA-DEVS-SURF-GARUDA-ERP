import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Database,
  FileText,
  Landmark,
  Settings2,
  Truck,
  Users,
  UserRound,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/session";
import { PoweredBy } from "@/components/PoweredBy";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Workspace — Garuda ERP" },
      { name: "description", content: "Choose a Garuda ERP workspace module." },
    ],
  }),
  component: () => (
    <RequireAuth>
      <HomePage />
    </RequireAuth>
  ),
});

const CORE_MODULES = [
  {
    key: "tms",
    label: "TMS",
    eyebrow: "Transport management",
    desc: "Operations, trips, masters, reports and dispatch",
    icon: Truck,
    to: "/tms",
    color: "red",
  },
  {
    key: "hrms",
    label: "HRMS",
    eyebrow: "People operations",
    desc: "Employees, attendance, payroll and HR dashboards",
    icon: Users,
    to: "/hrms",
    color: "blue",
  },
  {
    key: "accounts",
    label: "Accounts",
    eyebrow: "Finance workspace",
    desc: "Ledgers, journals, bank, cash and final accounts",
    icon: Landmark,
    to: "/accounts",
    color: "amber",
  },
];
const SUPPORT_MODULES = [
  {
    key: "ltms",
    label: "LTMS",
    desc: "Logistics operations, billing and masters",
    icon: Database,
    to: "/ltms",
    roles: ["admin", "semi_admin", "basic", "viewer"],
  },
  {
    key: "dashboard",
    label: "Analytics",
    desc: "Profit, loss and business dashboards",
    icon: BarChart3,
    to: "/dashboard",
    roles: ["admin", "semi_admin", "viewer"],
  },
  {
    key: "reports",
    label: "Reports",
    desc: "Period reports and comparisons",
    icon: FileText,
    to: "/reports",
    roles: ["admin", "semi_admin", "viewer"],
  },
  {
    key: "settings",
    label: "Settings",
    desc: "Company, branches and appearance",
    icon: Settings2,
    to: "/settings",
    roles: ["admin"],
  },
  {
    key: "users",
    label: "Users",
    desc: "Roles, access and activity logs",
    icon: UserRound,
    to: "/users",
    roles: ["admin"],
  },
];

function HomePage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 450);
    return () => clearTimeout(timer);
  }, []);
  const role = user?.role ?? "basic";
  const modules = CORE_MODULES.filter((item) => role !== "basic" || item.key !== "accounts");
  const supportModules = SUPPORT_MODULES.filter((item) => item.roles.includes(role));
  return (
    <AppShell>
      <div className="erp-page-intro animate-fade-up">
        <div>
          <p className="erp-kicker">GARUDA WORKSPACE</p>
          <h1>Choose a module</h1>
          <p>One admin experience for every part of your logistics business.</p>
        </div>
        <div className="erp-intro-meta">
          <span className="erp-live-dot" /> {user?.fullName ?? user?.username}{" "}
          <span className="erp-role-chip">{role.replace("_", " ")}</span>
        </div>
      </div>
      <section className="mt-8">
        <div className="erp-section-heading">
          <h2>Core modules</h2>
          <span>Choose where you want to work</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {loading
            ? modules.map((item) => <Skeleton key={item.key} className="h-48 rounded-xl" />)
            : modules.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate({ to: item.to as never })}
                    style={{ animationDelay: `${index * 70}ms` }}
                    className={`erp-module-card erp-module-${item.color} animate-fade-up`}
                  >
                    <span className="erp-module-icon">
                      <Icon className="size-6" />
                    </span>
                    <span className="erp-module-eyebrow">{item.eyebrow}</span>
                    <span className="erp-module-title">{item.label}</span>
                    <span className="erp-module-desc">{item.desc}</span>
                    <ArrowRight className="erp-module-arrow size-5" />
                  </button>
                );
              })}
        </div>
      </section>
      <section className="mt-10">
        <div className="erp-section-heading">
          <h2>All workspaces</h2>
          <span>Existing Garuda tools stay available</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {supportModules.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate({ to: item.to as never })}
                className="erp-support-card"
              >
                <span className="erp-support-icon">
                  <Icon className="size-4" />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.desc}</small>
                </span>
                <ArrowRight className="ml-auto size-4" />
              </button>
            );
          })}
        </div>
      </section>
      <PoweredBy className="mt-12 text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50" />
    </AppShell>
  );
}
