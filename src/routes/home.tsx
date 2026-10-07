import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Database, Landmark, Settings2, Users, UserRound } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

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

const MODULES = [
  {
    key: "ltms",
    label: "LTMS",
    desc: "Logistics operations, finance, billing, masters and reports",
    icon: Database,
    to: "/ltms",
    color: "red",
  },
  {
    key: "hrms",
    label: "HRMS",
    desc: "Employees, attendance, payroll and HR dashboards",
    icon: Users,
    to: "/hrms",
    color: "blue",
  },
  {
    key: "accounts",
    label: "ACCOUNTS",
    desc: "Masters, journals, ledgers and final accounts",
    icon: Landmark,
    to: "/accounts",
    color: "amber",
  },
  {
    key: "users",
    label: "USERS",
    desc: "Roles, access and activity logs",
    icon: UserRound,
    to: "/users",
    color: "slate",
  },
  {
    key: "settings",
    label: "SETTINGS",
    desc: "Company, branches and appearance",
    icon: Settings2,
    to: "/settings",
    color: "slate",
  },
];
function HomePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 350);
    return () => clearTimeout(timer);
  }, []);
  return (
    <AppShell showSidebar={false} showHeader={false}>
      <div className="erp-module-picker">
        <div className="grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? MODULES.map((item) => <Skeleton key={item.key} className="h-36 rounded-lg" />)
            : MODULES.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate({ to: item.to as never })}
                    style={{ animationDelay: `${index * 55}ms` }}
                    className={`erp-module-card erp-module-${item.color} animate-fade-up`}
                  >
                    <span className="erp-module-icon">
                      <Icon className="size-5" />
                    </span>
                    <span className="erp-module-title">{item.label}</span>
                    <ArrowRight className="erp-module-arrow size-4" />
                  </button>
                );
              })}
        </div>
      </div>
    </AppShell>
  );
}
