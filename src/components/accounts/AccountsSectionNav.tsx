import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  Banknote,
  BookOpen,
  Landmark,
  List,
  PanelLeftOpen,
  PanelLeftClose,
  Plus,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { LtmsSidebar, type LtmsSidebarGroup } from "@/components/ltms/LtmsSidebar";

export type LedgerTab = "capital" | "create" | "list" | "view";
type SectionMode = "masters" | "ledger" | "journal" | "auto-rules";
export type JournalTab = "create" | "transfer" | "list";
export type AutoRulesTab = "verify" | "base" | "rules";

const masterLinks = [
  {
    label: "Bank",
    description: "Branch bank accounts",
    to: "/accounts/masters/bank",
    icon: Landmark,
  },
  {
    label: "Cash",
    description: "Branch cash accounts",
    to: "/accounts/masters/cash",
    icon: Banknote,
  },
] as const;

const autoRulesLinks = [
  { key: "verify", label: "VERIFY", description: "Review pending HRMS entries", icon: ShieldCheck },
  {
    key: "base",
    label: "HRMS BASE",
    description: "Assign employee accounting branches",
    icon: Users,
  },
  {
    key: "rules",
    label: "HRMS RULES",
    description: "Configure the three posting rules",
    icon: Settings2,
  },
] as const;

const ledgerLinks = [
  { key: "capital", label: "Capital", description: "Branch default capital", icon: Landmark },
  { key: "create", label: "Create", description: "Create revenue ledger", icon: Plus },
  { key: "list", label: "List", description: "Browse ledgers", icon: List },
  { key: "view", label: "View", description: "View statement", icon: BookOpen },
] as const;

const masterMobileTabs = masterLinks.map((item) => ({
  id: item.to,
  label: item.label,
  desc: item.description,
  icon: item.icon,
}));
const autoRulesMobileTabs = autoRulesLinks.map((item) => ({
  id: item.key,
  label: item.label,
  desc: item.description,
  icon: item.icon,
}));
const ledgerMobileTabs = ledgerLinks.map((item) => ({
  id: item.key,
  label: item.label,
  desc: item.description,
  icon: item.icon,
}));

const journalLinks = [
  { key: "create", label: "Create", description: "Post journal entry", icon: Plus },
  { key: "transfer", label: "Transfer", description: "Move bank / cash", icon: ArrowRightLeft },
  { key: "list", label: "List", description: "Browse journal entries", icon: List },
] as const;
const journalMobileTabs = journalLinks.map((item) => ({
  id: item.key,
  label: item.label,
  desc: item.description,
  icon: item.icon,
}));

function activeFor(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export const accountModules = [
  { id: "masters", label: "Masters", to: "/accounts/masters/bank", prefix: "/accounts/masters" },
  { id: "journal", label: "Journal", to: "/accounts/journal", prefix: "/accounts/journal" },
  { id: "ledger", label: "Ledger", to: "/accounts/ledger", prefix: "/accounts/ledger" },
  { id: "final", label: "Final Accounts", to: "/accounts/final", prefix: "/accounts/final" },
  { id: "auto-rules", label: "Auto Rules", to: "/accounts/auto-rules", prefix: "/accounts/auto-rules" },
] as const;

export function AccountsMobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="ltms-reference-mobile-nav lg:hidden" aria-label="Accounts modules">
      {accountModules.map(({ label, to, prefix }) => {
        const active = pathname.startsWith(prefix);
        return (
          <Link
            key={to}
            to={to}
            className={`ltms-reference-mobile-link${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AccountsSectionNav({
  desktop = false,
  mode,
  ledgerTab = "create",
  onLedgerTabChange,
  journalTab = "create",
  onJournalTabChange,
  autoRulesTab = "verify",
  onAutoRulesTabChange,
}: {
  desktop?: boolean;
  mode: SectionMode;
  ledgerTab?: LedgerTab;
  onLedgerTabChange?: (tab: LedgerTab) => void;
  journalTab?: JournalTab;
  onJournalTabChange?: (tab: JournalTab) => void;
  autoRulesTab?: AutoRulesTab;
  onAutoRulesTabChange?: (tab: AutoRulesTab) => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const title =
    mode === "masters"
      ? "Master tabs"
      : mode === "ledger"
        ? "Ledger tabs"
        : mode === "journal"
          ? "Journal tabs"
          : "Auto Rules tabs";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const layoutRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!desktop) return;
    const layout = sidebarRef.current?.parentElement ?? layoutRef.current;
    if (!layout) return;
    layoutRef.current = layout;
    layout.style.gridTemplateColumns = sidebarOpen ? "220px minmax(0, 1fr)" : "1fr";
    const content = layout.children[1] as HTMLElement | undefined;
    if (content) content.style.gridColumnStart = sidebarOpen ? "2" : "1";
    return () => {
      layout.style.removeProperty("grid-template-columns");
      if (content) content.style.removeProperty("grid-column-start");
    };
  }, [desktop, sidebarOpen]);
  useEffect(() => {
    if (desktop) setHeaderTarget(document.querySelector("[data-app-shell-header-actions]"));
  }, [desktop]);

  if (desktop) {
    return (
      <>
        {sidebarOpen ? (
          <LtmsSidebar
            open={sidebarOpen}
            label={title}
            showCustomMobileNav={false}
              section={mode}
            activeTabId={
              mode === "masters"
                ? pathname
                : mode === "ledger"
                  ? ledgerTab
                  : mode === "journal"
                    ? journalTab
                    : autoRulesTab
            }
            onSelectTab={(id) => {
              if (mode === "ledger") onLedgerTabChange?.(id as LedgerTab);
              if (mode === "journal") onJournalTabChange?.(id as JournalTab);
              if (mode === "auto-rules") onAutoRulesTabChange?.(id as AutoRulesTab);
            }}
            groups={
              [
                {
                  section: "accounts-modules",
                  label: "Accounts",
                  items: accountModules.map(({ id, label, to }) => ({ id, label, to })),
                },
                {
                  section: mode,
                  label: title,
                  items:
                    mode === "masters"
                      ? masterLinks.map(({ label, to }) => ({ id: to, label, to }))
                      : mode === "ledger"
                        ? ledgerLinks.map(({ key, label }) => ({ id: key, label }))
                        : mode === "journal"
                          ? journalLinks.map(({ key, label }) => ({ id: key, label }))
                          : autoRulesLinks.map(({ key, label }) => ({ id: key, label })),
                },
              ] as LtmsSidebarGroup[]
            }
            activeItems={{ "accounts-modules": mode }}
          />
        ) : null}
        {headerTarget &&
          createPortal(
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              className="hidden items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
            >
              {sidebarOpen ? (
                <>
                  <PanelLeftClose className="size-3.5" />
                  <span>Hide sidebar</span>
                </>
              ) : (
                <>
                  <PanelLeftOpen className="size-3.5" />
                  <span>Show sidebar</span>
                </>
              )}
            </button>,
            headerTarget,
          )}
      </>
    );
  }

  const selectedMaster = masterLinks.find((item) => activeFor(pathname, item.to));
  if (mode === "masters")
    return (
      <>
        <AccountsMobileNav pathname={pathname} />
        <MobileTabDropdown
          tabs={masterMobileTabs}
          activeId={selectedMaster?.to ?? masterMobileTabs[0].id}
          label="Master tabs"
          onChange={(to) => window.location.assign(to)}
          compact
        />
      </>
    );
  if (mode === "auto-rules")
    return (
      <>
        <AccountsMobileNav pathname={pathname} />
        <MobileTabDropdown
          tabs={autoRulesMobileTabs}
          activeId={autoRulesTab}
          label="Auto Rules tabs"
          onChange={(tab) => onAutoRulesTabChange?.(tab as AutoRulesTab)}
          compact
        />
      </>
    );
  if (mode === "journal")
    return (
      <>
        <AccountsMobileNav pathname={pathname} />
        <MobileTabDropdown
          tabs={journalMobileTabs}
          activeId={journalTab}
          label="Journal tabs"
          onChange={(tab) => onJournalTabChange?.(tab as JournalTab)}
          compact
        />
      </>
    );
  return (
    <>
      <AccountsMobileNav pathname={pathname} />
      <MobileTabDropdown
        tabs={ledgerMobileTabs}
        activeId={ledgerTab}
        label="Ledger tabs"
        onChange={(tab) => onLedgerTabChange?.(tab as LedgerTab)}
        compact
      />
    </>
  );
}
