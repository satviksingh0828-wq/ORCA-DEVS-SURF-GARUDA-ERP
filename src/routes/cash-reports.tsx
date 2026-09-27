import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Truck, Wallet } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { CashLedger } from "@/components/reports/CashLedger";
import { useSession } from "@/lib/session";
import { ReportFiltersContext } from "@/lib/report-filters";
import { useBranches } from "@/lib/use-branches";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/cash-reports")({
  component: () => (
    <RequireAuth>
      <CashReportsPage />
    </RequireAuth>
  ),
});
const TABS = [
  {
    id: "cash-ledger",
    label: "Cash Ledger",
    desc: "Received income and paid cash expenditure",
    icon: Wallet,
  },
] as const;
type TabId = (typeof TABS)[number]["id"];

function CashReportsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("cash-ledger");
  const [navOpen, setNavOpen] = useState(true);
  const [branchId, setBranchId] = useState("all");
  const branches = useBranches();
  useEffect(() => {
    if (user && !["admin", "semi_admin", "viewer"].includes(user.role))
      navigate({ to: "/home", replace: true });
  }, [user, navigate]);
  if (!user || !["admin", "semi_admin", "viewer"].includes(user.role)) return null;
  const active = TABS.find((t) => t.id === tab)!;
  return (
    <AppShell
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home">Workspace</Link>
          <ChevronRight className="size-3.5" />
          <Link to="/tms">TMS</Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">CASH REPORTS</span>
        </span>
      }
      headerEnd={
        <button
          onClick={() => setNavOpen((v) => !v)}
          className="hidden lg:flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs"
        >
          {navOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          {navOpen ? "Hide sidebar" : "Show sidebar"}
        </button>
      }
    >
      <div className={`grid gap-6 ${navOpen ? "lg:grid-cols-[260px_1fr]" : "grid-cols-1"}`}>
        {navOpen && (
          <nav className="hidden lg:block">
            <p className="mb-3 px-2 text-[11px] font-semibold tracking-[.18em] text-muted-foreground">
              CASH REPORTS
            </p>
            <ul className="space-y-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => setTab(t.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${tab === t.id ? "bg-primary-soft" : "text-muted-foreground hover:bg-muted"}`}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{t.label}</span>
                        <span className="block whitespace-nowrap text-[11px] opacity-70">
                          {t.desc}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        <MobileTabDropdown tabs={TABS} activeId={tab} label="CASH REPORTS" onChange={setTab} />
        <ReportFiltersContext.Provider value={{ branchId, financialYear: "none" }}>
          <main className={navOpen ? "min-w-0 lg:col-start-2" : "min-w-0"}>
            <header className="mb-6">
              <h1 className="text-2xl font-semibold">{active.label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
            </header>
            {tab !== "cash-ledger" && (
              <div className="mb-4">
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.branch_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tab === "cash-ledger" && <CashLedger />}
          </main>
        </ReportFiltersContext.Provider>
      </div>
    </AppShell>
  );
}
