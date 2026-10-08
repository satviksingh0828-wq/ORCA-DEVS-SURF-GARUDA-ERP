import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  Banknote,
  BookOpen,
  Landmark,
  List,
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
  { key: "verify", label: "Verify", description: "Review pending HRMS entries", icon: ShieldCheck },
  {
    key: "base",
    label: "HRMS Base",
    description: "Assign employee accounting branches",
    icon: Users,
  },
  {
    key: "rules",
    label: "HRMS Rules",
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
] as const;

const ACCOUNTS_PENDING_TAB_KEY = "accounts.pending-sidebar-tab";

export function queueAccountsTabNavigation(section: string, tabId: string) {
  if (typeof window === "undefined" || section === "masters") return;
  try {
    window.sessionStorage.setItem(ACCOUNTS_PENDING_TAB_KEY, JSON.stringify({ section, tabId }));
  } catch {
    // Ignore storage restrictions; the destination will use its regular default tab.
  }
}

export function consumeAccountsTabNavigation(section: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.sessionStorage.getItem(ACCOUNTS_PENDING_TAB_KEY);
    if (!saved) return null;
    const pending = JSON.parse(saved) as { section?: string; tabId?: string };
    if (pending.section !== section || typeof pending.tabId !== "string") return null;
    window.sessionStorage.removeItem(ACCOUNTS_PENDING_TAB_KEY);
    return pending.tabId;
  } catch {
    return null;
  }
}

export type AccountsArea = "masters" | "journal" | "ledger" | "final" | "auto-rules";

export const ACCOUNTS_SIDEBAR_GROUPS: LtmsSidebarGroup[] = [
  {
    section: "masters",
    label: "Masters",
    description: "Branch bank and cash account records",
    items: masterLinks.map(({ label, to }) => ({ id: to, label, to })),
  },
  {
    section: "journal",
    label: "Journal",
    description: "Balanced journal entries and vouchers",
    items: journalLinks.map(({ key, label }) => ({ id: key, label, to: "/accounts/journal" })),
  },
  {
    section: "ledger",
    label: "Ledger",
    description: "Create, list and view ledger statements",
    items: ledgerLinks.map(({ key, label }) => ({ id: key, label, to: "/accounts/ledger" })),
  },
  {
    section: "final",
    label: "Final Accounts",
    description: "Balance Sheet and Profit & Loss reports",
    items: [
      { id: "trial-balance", label: "Trial Balance", to: "/accounts/final" },
      { id: "balance-sheet", label: "Balance Sheet", to: "/accounts/final" },
      { id: "profit-loss", label: "Profit & Loss", to: "/accounts/final" },
      { id: "cash-flow", label: "Cash Flow", to: "/accounts/final" },
    ],
  },
];

export function AccountsSidebar({
  mode,
  activeTabId,
  onSelectTab,
}: {
  mode: AccountsArea;
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
}) {
  return (
    <LtmsSidebar
      label="Accounts navigation"
      section={mode}
      activeTabId={activeTabId}
      onSelectTab={onSelectTab}
      onCrossGroupNavigate={queueAccountsTabNavigation}
      groups={ACCOUNTS_SIDEBAR_GROUPS}
      showCustomMobileNav={false}
    />
  );
}

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
  const selectedMaster = masterLinks.find((item) => activeFor(pathname, item.to));
  if (desktop)
    return (
      <AccountsSidebar
        mode={mode}
        activeTabId={
          mode === "masters"
            ? (selectedMaster?.to ?? masterLinks[0].to)
            : mode === "ledger"
              ? ledgerTab
              : mode === "journal"
                ? journalTab
                : autoRulesTab
        }
        onSelectTab={(id) => {
          if (mode === "masters") window.location.assign(id);
          if (mode === "ledger") onLedgerTabChange?.(id as LedgerTab);
          if (mode === "journal") onJournalTabChange?.(id as JournalTab);
          if (mode === "auto-rules") onAutoRulesTabChange?.(id as AutoRulesTab);
        }}
      />
    );
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
