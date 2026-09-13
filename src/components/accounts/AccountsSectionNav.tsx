import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRightLeft, Banknote, BookOpen, Landmark, List, Plus, Settings2, ShieldCheck, Users } from "lucide-react";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";

export type LedgerTab = "capital" | "create" | "list" | "view";
type SectionMode = "masters" | "ledger" | "journal" | "auto-rules";
export type JournalTab = "create" | "transfer" | "list";
export type AutoRulesTab = "verify" | "base" | "rules";

const masterLinks = [
  { label: "Bank", description: "Branch bank accounts", to: "/accounts/masters/bank", icon: Landmark },
  { label: "Cash", description: "Branch cash accounts", to: "/accounts/masters/cash", icon: Banknote },
] as const;

const autoRulesLinks = [
  { key: "verify", label: "VERIFY", description: "Review pending HRMS entries", icon: ShieldCheck },
  { key: "base", label: "HRMS BASE", description: "Assign employee accounting branches", icon: Users },
  { key: "rules", label: "HRMS RULES", description: "Configure the three posting rules", icon: Settings2 },
] as const;

const ledgerLinks = [
  { key: "capital", label: "Capital", description: "Branch default capital", icon: Landmark },
  { key: "create", label: "Create", description: "Create revenue ledger", icon: Plus },
  { key: "list", label: "List", description: "Browse ledgers", icon: List },
  { key: "view", label: "View", description: "View statement", icon: BookOpen },
] as const;

const masterMobileTabs = masterLinks.map((item) => ({ id: item.to, label: item.label, desc: item.description, icon: item.icon }));
const autoRulesMobileTabs = autoRulesLinks.map((item) => ({ id: item.key, label: item.label, desc: item.description, icon: item.icon }));
const ledgerMobileTabs = ledgerLinks.map((item) => ({ id: item.key, label: item.label, desc: item.description, icon: item.icon }));

const journalLinks = [
  { key: "create", label: "Create", description: "Post journal entry", icon: Plus },
  { key: "transfer", label: "Transfer", description: "Move bank / cash", icon: ArrowRightLeft },
  { key: "list", label: "List", description: "Browse journal entries", icon: List },
] as const;
const journalMobileTabs = journalLinks.map((item) => ({ id: item.key, label: item.label, desc: item.description, icon: item.icon }));

function activeFor(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
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
  const title = mode === "masters" ? "Master tabs" : mode === "ledger" ? "Ledger tabs" : mode === "journal" ? "Journal tabs" : "Auto Rules tabs";

  if (desktop) {
    return (
      <nav aria-label={title} className="app-sidebar-scroll hidden lg:fixed lg:left-[max(1.5rem,calc((100vw-1280px)/2+1.5rem))] lg:top-20 lg:block lg:h-[calc(100dvh-5rem)] lg:w-[220px] lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
        <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
        <div className="space-y-1">
          {mode === "masters" && masterLinks.map(({ label, description, to, icon: Icon }) => {
            const active = activeFor(pathname, to);
            return <Link key={to} to={to} aria-current={active ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${active ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} /><span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold">{label}</span><span className="block truncate text-[11px] opacity-70">{description}</span></span></Link>;
          })}
          {mode === "auto-rules" && autoRulesLinks.map(({ key, label, description, icon: Icon }) => <button key={key} type="button" onClick={() => onAutoRulesTabChange?.(key)} aria-current={autoRulesTab === key ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${autoRulesTab === key ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon className={`size-4 shrink-0 ${autoRulesTab === key ? "text-primary" : ""}`} /><span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold">{label}</span><span className="block truncate text-[11px] opacity-70">{description}</span></span></button>)}
          {mode === "ledger" && ledgerLinks.map(({ key, label, description, icon: Icon }) => <button key={key} type="button" onClick={() => onLedgerTabChange?.(key)} aria-current={ledgerTab === key ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${ledgerTab === key ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon className={`size-4 shrink-0 ${ledgerTab === key ? "text-primary" : ""}`} /><span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold">{label}</span><span className="block truncate text-[11px] opacity-70">{description}</span></span></button>)}
          {mode === "journal" && journalLinks.map(({ key, label, description, icon: Icon }) => <button key={key} type="button" onClick={() => onJournalTabChange?.(key)} aria-current={journalTab === key ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${journalTab === key ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon className={`size-4 shrink-0 ${journalTab === key ? "text-primary" : ""}`} /><span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold">{label}</span><span className="block truncate text-[11px] opacity-70">{description}</span></span></button>)}
        </div>
      </nav>
    );
  }

  const selectedMaster = masterLinks.find((item) => activeFor(pathname, item.to));
  if (mode === "masters") return <MobileTabDropdown tabs={masterMobileTabs} activeId={selectedMaster?.to ?? masterMobileTabs[0].id} label="Master tabs" onChange={(to) => window.location.assign(to)} />;
  if (mode === "auto-rules") return <MobileTabDropdown tabs={autoRulesMobileTabs} activeId={autoRulesTab} label="Auto Rules tabs" onChange={(tab) => onAutoRulesTabChange?.(tab as AutoRulesTab)} />;
  if (mode === "journal") return <MobileTabDropdown tabs={journalMobileTabs} activeId={journalTab} label="Journal tabs" onChange={(tab) => onJournalTabChange?.(tab as JournalTab)} />;
  return <MobileTabDropdown tabs={ledgerMobileTabs} activeId={ledgerTab} label="Ledger tabs" onChange={(tab) => onLedgerTabChange?.(tab as LedgerTab)} />;
}
