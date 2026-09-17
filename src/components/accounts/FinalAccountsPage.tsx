import { useEffect, useMemo, useState } from "react";
import { BarChart3, FileDown, FileSpreadsheet, Loader2, Scale } from "lucide-react";
import * as XLSX from "xlsx";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { TrialBalanceView } from "@/components/accounts/TrialBalanceView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { openBrandedTablePdf } from "@/lib/branded-pdf";

// The generated types predate the accounts tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type FinalTab = "trial-balance" | "balance-sheet" | "profit-loss" | "cash-flow";
type CashFilter = "both" | "cash" | "bank";
type AccountType = "asset" | "liability" | "income" | "expenditure" | "capital" | "bank" | "cash";
type Branch = { id: string; branch_name: string };
type Account = {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: AccountType;
  opening_balance: number | string | null;
  opening_balance_side: "dr" | "cr";
};
type Posting = { ledger_account_id: string; debit: number | string | null; credit: number | string | null; entry_date: string; voucher_number?: string | null; description?: string | null; source_module?: string | null };
type ReportRow = { branch_id: string; account_id: string; account_name: string; ledger_type: AccountType; amount: number; debit: number; credit: number; side?: "Dr" | "Cr" };
type CashFlowRow = { branch_id: string; account_id: string; account_name: string; ledger_type: "cash" | "bank"; date: string; voucher: string; description: string; debit: number; credit: number; balance: number; side: "Dr" | "Cr"; kind: "opening" | "movement" | "closing" };

const today = new Date().toISOString().slice(0, 10);
const firstDayOfYear = `${new Date().getFullYear()}-01-01`;
const amount = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pdfMoney = (value: number) => `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN");
const labelType = (value: AccountType) => value === "bank" ? "Bank" : value === "cash" ? "Cash" : value[0].toUpperCase() + value.slice(1);

function FinalAccountsNav({ tab, onTab }: { tab: FinalTab; onTab: (tab: FinalTab) => void }) {
  const items = [
    { key: "trial-balance" as const, label: "Trial Balance", desc: "Debit and credit totals", icon: Scale },
    { key: "balance-sheet" as const, label: "Balance Sheet", desc: "Assets, liabilities and capital", icon: Scale },
    { key: "profit-loss" as const, label: "Profit & Loss", desc: "Income and expenditure for a period", icon: BarChart3 },
    { key: "cash-flow" as const, label: "Cash Flow", desc: "Cash and bank movements", icon: BarChart3 },
  ];
  return (
    <nav aria-label="Final Accounts tabs" className="space-y-1">
      <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Final Accounts</p>
      {items.map(({ key, label, desc, icon: Icon }) => (
        <button key={key} type="button" onClick={() => onTab(key)} aria-current={tab === key ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${tab === key ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
          <Icon className={`size-4 ${tab === key ? "text-primary" : ""}`} /><span><span className="block text-sm font-semibold">{label}</span><span className="block text-[11px] opacity-70">{desc}</span></span>
        </button>
      ))}
    </nav>
  );
}

function MobileFinalNav({ tab, onTab }: { tab: FinalTab; onTab: (tab: FinalTab) => void }) {
  return <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden"><button type="button" onClick={() => onTab("trial-balance")} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm ${tab === "trial-balance" ? "bg-primary-soft" : ""}`}>Trial Balance</button><button type="button" onClick={() => onTab("balance-sheet")} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm ${tab === "balance-sheet" ? "bg-primary-soft" : ""}`}>Balance Sheet</button><button type="button" onClick={() => onTab("profit-loss")} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm ${tab === "profit-loss" ? "bg-primary-soft" : ""}`}>Profit & Loss</button><button type="button" onClick={() => onTab("cash-flow")} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm ${tab === "cash-flow" ? "bg-primary-soft" : ""}`}>Cash Flow</button></div>;
}

export function FinalAccountsRoute() {
  const branches = useBranches() as Branch[];
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const [tab, setTab] = useState<FinalTab>("balance-sheet");
  const [branchId, setBranchId] = useState("all");
  const [asOf, setAsOf] = useState(today);
  const [start, setStart] = useState(firstDayOfYear);
  const [end, setEnd] = useState(today);
  const [cashFilter, setCashFilter] = useState<CashFilter>("both");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [postings, setPostings] = useState<Posting[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadAccountsAndPostings() {
    setLoading(true);
    try {
      const [accountResult, postingResult] = await Promise.all([
        db.from("ledger_accounts").select("id,branch_id,account_name,ledger_type,opening_balance,opening_balance_side").eq("is_active", true).limit(10000),
        db.from("journal_lines").select("ledger_account_id,debit,credit,journal_entry:journal_entries!inner(entry_date,status,voucher_number,description,source_module)").eq("journal_entry.status", "approved").limit(20000),
      ]);
      if (accountResult.error) throw new Error(accountResult.error.message);
      if (postingResult.error) throw new Error(postingResult.error.message);
      setAccounts((accountResult.data as Account[]) ?? []);
      setPostings(((postingResult.data ?? []) as Array<{ ledger_account_id: string; debit: number | string | null; credit: number | string | null; journal_entry?: { entry_date: string; voucher_number?: string | null; description?: string | null; source_module?: string | null } | null }>).map((row) => ({ ledger_account_id: row.ledger_account_id, debit: row.debit, credit: row.credit, entry_date: row.journal_entry?.entry_date ?? "", voucher_number: row.journal_entry?.voucher_number, description: row.journal_entry?.description, source_module: row.journal_entry?.source_module })));
    } catch (error) {
      toast.error(`Could not load final accounts: ${error instanceof Error ? error.message : String(error)}`);
      setAccounts([]); setPostings([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadAccountsAndPostings(); }, []);

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const inScope = (id: string) => branchId === "all" || accountById.get(id)?.branch_id === branchId;
  const balanceRows = useMemo(() => {
    const totals = new Map<string, ReportRow>();
    const firstCapitalEntryDateByBranch = new Map<string, string>();
    const profitLossByBranch = new Map<string, number>();
    for (const posting of postings) {
      if (posting.entry_date > asOf) continue;
      const account = accountById.get(posting.ledger_account_id);
      if (!account || account.ledger_type !== "capital") continue;
      const firstDate = firstCapitalEntryDateByBranch.get(account.branch_id);
      if (!firstDate || posting.entry_date < firstDate) {
        firstCapitalEntryDateByBranch.set(account.branch_id, posting.entry_date);
      }
    }
    for (const posting of postings) {
      if (posting.entry_date > asOf) continue;
      const account = accountById.get(posting.ledger_account_id);
      if (!account || !["income", "expenditure"].includes(account.ledger_type)) continue;
      const firstCapitalEntryDate = firstCapitalEntryDateByBranch.get(account.branch_id);
      if (!firstCapitalEntryDate || posting.entry_date < firstCapitalEntryDate) continue;
      // Normalize both account types to the P&L sign convention: income is
      // positive and expenditure is negative, so the result is income minus
      // expenditure (not the sum of their absolute balances).
      const result = amount(posting.credit) - amount(posting.debit);
      profitLossByBranch.set(account.branch_id, (profitLossByBranch.get(account.branch_id) ?? 0) + result);
    }
    for (const account of accounts) {
      if (branchId !== "all" && account.branch_id !== branchId) continue;
      const isBalanceType = ["asset", "bank", "cash", "liability", "capital"].includes(account.ledger_type);
      if (!isBalanceType) continue;
      // Trial Balance is based on approved journal lines. Opening balances are
      // represented by those journal lines, so do not add ledger master opening
      // values a second time here.
      const current = { branch_id: account.branch_id, account_id: account.id, account_name: account.account_name, ledger_type: account.ledger_type, amount: 0, debit: 0, credit: 0 };
      for (const posting of postings) if (posting.ledger_account_id === account.id && posting.entry_date <= asOf) { current.debit += amount(posting.debit); current.credit += amount(posting.credit); }
      const net = current.debit - current.credit;
      const side = net >= 0 ? "Dr" : "Cr";
      const displayAmount = Math.abs(net);
      if (displayAmount > 0.005) { current.amount = displayAmount; totals.set(account.id, { ...current, side }); }
    }
    for (const [branchKey, profitLoss] of profitLossByBranch) {
      if (branchId !== "all" && branchKey !== branchId) continue;
      if (Math.abs(profitLoss) <= 0.005) continue;
      const branchName = branchById.get(branchKey)?.branch_name ?? "Branch";
      totals.set(`retained-earning-${branchKey}`, {
        branch_id: branchKey,
        account_id: `retained-earning-${branchKey}`,
        account_name: `Retained Earning - ${branchName}`,
        ledger_type: "capital",
        amount: Math.abs(profitLoss),
        debit: profitLoss < 0 ? Math.abs(profitLoss) : 0,
        credit: profitLoss > 0 ? profitLoss : 0,
        side: profitLoss < 0 ? "Dr" : "Cr",
      });
    }
    return [...totals.values()].sort((a, b) => `${branchById.get(a.branch_id)?.branch_name}-${a.account_name}`.localeCompare(`${branchById.get(b.branch_id)?.branch_name}-${b.account_name}`));
  }, [accountById, accounts, asOf, branchId, branchById, postings]);

  const pnlRows = useMemo(() => {
    const totals = new Map<string, ReportRow>();
    for (const posting of postings) {
      if (posting.entry_date < start || posting.entry_date > end || !inScope(posting.ledger_account_id)) continue;
      const account = accountById.get(posting.ledger_account_id);
      if (!account || !["income", "expenditure"].includes(account.ledger_type)) continue;
      const current = totals.get(account.id) ?? { branch_id: account.branch_id, account_id: account.id, account_name: account.account_name, ledger_type: account.ledger_type, amount: 0, debit: 0, credit: 0 };
      current.debit += amount(posting.debit); current.credit += amount(posting.credit); current.amount += amount(posting.debit) - amount(posting.credit); totals.set(account.id, current);
    }
    return [...totals.values()].sort((a, b) => `${branchById.get(a.branch_id)?.branch_name}-${a.account_name}`.localeCompare(`${branchById.get(b.branch_id)?.branch_name}-${b.account_name}`));
  }, [accountById, branchById, end, inScope, postings, start]);

  const balanceTotals = useMemo(() => ({ assets: balanceRows.reduce((sum, row) => sum + row.debit, 0), liabilities: balanceRows.reduce((sum, row) => sum + row.credit, 0) }), [balanceRows]);
  const pnlTotals = useMemo(() => ({ income: pnlRows.filter((row) => row.ledger_type === "income").reduce((sum, row) => sum + (row.credit - row.debit), 0), expenditure: pnlRows.filter((row) => row.ledger_type === "expenditure").reduce((sum, row) => sum + (row.debit - row.credit), 0) }), [pnlRows]);
  const profit = pnlTotals.income - pnlTotals.expenditure;
  const cashFlowRows = useMemo(() => {
    const rows: Array<CashFlowRow> = [];
    for (const account of accounts) {
      if (!(account.ledger_type === "cash" || account.ledger_type === "bank")) continue;
      if (branchId !== "all" && account.branch_id !== branchId) continue;
      if (cashFilter !== "both" && account.ledger_type !== cashFilter) continue;
      const accountPostings = postings.filter((posting) => posting.ledger_account_id === account.id);
      const openingNet = accountPostings.filter((posting) => posting.entry_date < start).reduce((sum, posting) => sum + amount(posting.debit) - amount(posting.credit), 0);
      const periodPostings = accountPostings.filter((posting) => posting.entry_date >= start && posting.entry_date <= end).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      if (Math.abs(openingNet) <= 0.005 && !periodPostings.some((posting) => amount(posting.debit) > 0.005 || amount(posting.credit) > 0.005)) continue;
      const base = { branch_id: account.branch_id, account_id: account.id, account_name: account.account_name, ledger_type: account.ledger_type };
      rows.push({ ...base, date: start, voucher: "OPENING", description: "Opening balance", debit: openingNet > 0 ? openingNet : 0, credit: openingNet < 0 ? Math.abs(openingNet) : 0, balance: Math.abs(openingNet), side: openingNet >= 0 ? "Dr" : "Cr", kind: "opening" });
      let running = openingNet;
      for (const posting of periodPostings) {
        const debit = amount(posting.debit); const credit = amount(posting.credit); running += debit - credit;
        rows.push({ ...base, date: posting.entry_date, voucher: posting.voucher_number ?? "—", description: posting.description ?? posting.source_module ?? "—", debit, credit, balance: Math.abs(running), side: running >= 0 ? "Dr" : "Cr", kind: "movement" });
      }
      rows.push({ ...base, date: end, voucher: "CLOSING", description: "Closing balance", debit: 0, credit: 0, balance: Math.abs(running), side: running >= 0 ? "Dr" : "Cr", kind: "closing" });
    }
    return rows.sort((a, b) => `${branchById.get(a.branch_id)?.branch_name}-${a.account_name}`.localeCompare(`${branchById.get(b.branch_id)?.branch_name}-${b.account_name}`));
  }, [accounts, branchById, branchId, cashFilter, end, postings, start]);

  function exportBalanceExcel() {
    const rows = balanceRows.map((row) => ({ Branch: branchById.get(row.branch_id)?.branch_name ?? "—", Account: row.account_name, Type: labelType(row.ledger_type), Debit: row.debit, Credit: row.credit, Balance: row.amount, Side: row.side ?? "Dr" }));
    rows.push({ Branch: "TOTAL", Account: "Balance Sheet accounts", Type: "", Debit: balanceTotals.assets, Credit: balanceTotals.liabilities, Balance: Math.abs(balanceTotals.assets - balanceTotals.liabilities), Side: balanceTotals.assets >= balanceTotals.liabilities ? "Dr" : "Cr" });
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Balance Sheet"); XLSX.writeFile(workbook, `balance-sheet-${branchId === "all" ? "all-branches" : "branch"}-${asOf}.xlsx`);
  }
  async function exportBalancePdf() {
    const rows = balanceRows.map((row) => [branchById.get(row.branch_id)?.branch_name ?? "—", row.account_name, labelType(row.ledger_type), pdfMoney(row.debit), pdfMoney(row.credit), pdfMoney(row.amount), row.side ?? "Dr"]);
    rows.push(["TOTAL", "Balance Sheet accounts", "", pdfMoney(balanceTotals.assets), pdfMoney(balanceTotals.liabilities), pdfMoney(Math.abs(balanceTotals.assets - balanceTotals.liabilities)), balanceTotals.assets >= balanceTotals.liabilities ? "Dr" : "Cr"]);
    await openBrandedTablePdf({ title: "Balance Sheet", subtitle: `${branchId === "all" ? "All branches" : branchById.get(branchId)?.branch_name ?? "Branch"} · As on ${dateText(asOf)}`, filename: `balance-sheet-${asOf}.pdf`, orientation: "landscape", columns: ["Branch", "Account", "Type", "Debit", "Credit", "Balance", "Side"], rows, summary: [["Total assets", pdfMoney(balanceTotals.assets)], ["Liabilities + capital", pdfMoney(balanceTotals.liabilities)], ["Difference", pdfMoney(Math.abs(balanceTotals.assets - balanceTotals.liabilities))]] });
  }
  function exportPnlExcel() {
    const rows = pnlRows.map((row) => ({ Branch: branchById.get(row.branch_id)?.branch_name ?? "—", Account: row.account_name, Type: labelType(row.ledger_type), Debit: row.debit, Credit: row.credit, Result: row.ledger_type === "income" ? row.credit - row.debit : row.debit - row.credit }));
    rows.push({ Branch: "TOTAL", Account: "Profit / (Loss)", Type: "", Debit: pnlTotals.expenditure, Credit: pnlTotals.income, Result: profit });
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Profit & Loss"); XLSX.writeFile(workbook, `profit-loss-${branchId === "all" ? "all-branches" : "branch"}-${start}-to-${end}.xlsx`);
  }
  async function exportPnlPdf() {
    const rows = pnlRows.map((row) => [branchById.get(row.branch_id)?.branch_name ?? "—", row.account_name, labelType(row.ledger_type), pdfMoney(row.debit), pdfMoney(row.credit), pdfMoney(row.ledger_type === "income" ? row.credit - row.debit : row.debit - row.credit)]);
    rows.push(["TOTAL", "Profit / (Loss)", "", pdfMoney(pnlTotals.expenditure), pdfMoney(pnlTotals.income), pdfMoney(Math.abs(profit)) + (profit >= 0 ? " Profit" : " Loss")]);
    await openBrandedTablePdf({ title: "Profit & Loss", subtitle: `${branchId === "all" ? "All branches" : branchById.get(branchId)?.branch_name ?? "Branch"} · ${dateText(start)} to ${dateText(end)}`, filename: `profit-loss-${start}-to-${end}.pdf`, orientation: "landscape", columns: ["Branch", "Account", "Type", "Debit", "Credit", "Result"], rows, summary: [["Income", pdfMoney(pnlTotals.income)], ["Expenditure", pdfMoney(pnlTotals.expenditure)], [profit >= 0 ? "Net profit" : "Net loss", pdfMoney(Math.abs(profit))]] });
  }
  function exportCashFlowExcel() {
    const rows = cashFlowRows.map((row) => ({ Date: row.date, Branch: branchById.get(row.branch_id)?.branch_name ?? "—", Account: row.account_name, Type: labelType(row.ledger_type), Voucher: row.voucher, Description: row.description, Debit: row.debit, Credit: row.credit, Balance: row.balance, Side: row.side, Line: row.kind }));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Cash Flow"); XLSX.writeFile(workbook, `cash-flow-${branchId === "all" ? "all-branches" : "branch"}-${start}-to-${end}.xlsx`);
  }
  async function exportCashFlowPdf() {
    const rows = cashFlowRows.map((row) => [row.date, branchById.get(row.branch_id)?.branch_name ?? "—", row.account_name, labelType(row.ledger_type), row.voucher, row.description, pdfMoney(row.debit), pdfMoney(row.credit), pdfMoney(row.balance), row.side, row.kind]);
    await openBrandedTablePdf({ title: "Cash Flow", subtitle: `${branchId === "all" ? "All branches" : branchById.get(branchId)?.branch_name ?? "Branch"} · ${cashFilter === "both" ? "Cash + Bank" : cashFilter === "cash" ? "Cash only" : "Bank only"} · ${dateText(start)} to ${dateText(end)}`, filename: `cash-flow-${start}-to-${end}.pdf`, orientation: "landscape", columns: ["Date", "Branch", "Account", "Type", "Voucher", "Description", "Debit", "Credit", "Balance", "Side", "Line"], rows, summary: [["Ledger lines", String(cashFlowRows.length)], ["Period debit", pdfMoney(cashFlowRows.filter((row) => row.kind === "movement").reduce((sum, row) => sum + row.debit, 0))], ["Period credit", pdfMoney(cashFlowRows.filter((row) => row.kind === "movement").reduce((sum, row) => sum + row.credit, 0))]] });
  }

  return <AccountsAccessGuard><AppShell breadcrumb={<span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Link to="/home">Workspace</Link><span>/</span><Link to="/accounts">Accounts</Link><span>/</span><span className="text-foreground">Final Accounts</span></span>}><div className="grid items-start gap-6 lg:grid-cols-[250px_1fr]"><aside className="hidden lg:block lg:sticky lg:top-20"><FinalAccountsNav tab={tab} onTab={setTab} /></aside><main className="min-w-0"><MobileFinalNav tab={tab} onTab={setTab} /><header className="mb-6"><p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">Accounts / Final Accounts</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Final Accounts</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Prepare live branch-wise Balance Sheet, Profit & Loss and Cash Flow reports from approved journal postings.</p></header>{loading ? <div className="surface-card py-16 text-center"><Loader2 className="mx-auto size-6 animate-spin" /></div> : tab === "trial-balance" ? <TrialBalanceView /> : tab === "balance-sheet" ? <BalanceSheetView branches={branches} branchId={branchId} setBranchId={setBranchId} asOf={asOf} setAsOf={setAsOf} rows={balanceRows} totals={balanceTotals} exportExcel={exportBalanceExcel} exportPdf={() => void exportBalancePdf()} /> : tab === "profit-loss" ? <ProfitLossView branches={branches} branchId={branchId} setBranchId={setBranchId} start={start} setStart={setStart} end={end} setEnd={setEnd} rows={pnlRows} totals={pnlTotals} profit={profit} exportExcel={exportPnlExcel} exportPdf={() => void exportPnlPdf()} /> : <CashFlowView branches={branches} branchId={branchId} setBranchId={setBranchId} start={start} setStart={setStart} end={end} setEnd={setEnd} cashFilter={cashFilter} setCashFilter={setCashFilter} rows={cashFlowRows} exportExcel={exportCashFlowExcel} exportPdf={() => void exportCashFlowPdf()} />}</main></div></AppShell></AccountsAccessGuard>;
}

function BranchSelect({ branches, value, onChange }: { branches: Branch[]; value: string; onChange: (value: string) => void }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="all">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}</select>; }
function Controls({ branches, branchId, setBranchId, children }: { branches: Branch[]; branchId: string; setBranchId: (value: string) => void; children: React.ReactNode }) { return <section className="surface-card p-5"><div className="flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Branch</span><BranchSelect branches={branches} value={branchId} onChange={setBranchId} /></label>{children}</div></section>; }
function Actions({ exportExcel, exportPdf, disabled = false }: { exportExcel: () => void; exportPdf: () => void; disabled?: boolean }) { return <div className="flex gap-2"><Button type="button" variant="outline" onClick={exportExcel} disabled={disabled} className="gap-2"><FileSpreadsheet className="size-4" />Excel</Button><Button type="button" variant="outline" onClick={exportPdf} disabled={disabled} className="gap-2"><FileDown className="size-4" />PDF</Button></div>; }
 function BalanceSheetView({ branches, branchId, setBranchId, asOf, setAsOf, rows, totals, exportExcel, exportPdf }: { branches: Branch[]; branchId: string; setBranchId: (value: string) => void; asOf: string; setAsOf: (value: string) => void; rows: ReportRow[]; totals: { assets: number; liabilities: number }; exportExcel: () => void; exportPdf: () => void }) { return <div className="space-y-5 animate-fade-up"><Controls branches={branches} branchId={branchId} setBranchId={setBranchId}><label className="min-w-44 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">As on date</span><Input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><Actions exportExcel={exportExcel} exportPdf={exportPdf} disabled={!rows.length} /></Controls><ReportTable rows={rows} columns={["Branch", "Account", "Type", "Debit", "Credit", "Balance", "Side"]} getValues={(row) => [row.branch_id, row.account_name, labelType(row.ledger_type), money(row.debit), money(row.credit), money(row.amount), row.side ?? "Dr"]} /><div className="grid gap-3 sm:grid-cols-3"><Summary label="Total debit" value={money(totals.assets)} /><Summary label="Total credit" value={money(totals.liabilities)} /><Summary label="Difference" value={money(Math.abs(totals.assets - totals.liabilities))} /></div></div>; }
function ProfitLossView({ branches, branchId, setBranchId, start, setStart, end, setEnd, rows, totals, profit, exportExcel, exportPdf }: { branches: Branch[]; branchId: string; setBranchId: (value: string) => void; start: string; setStart: (value: string) => void; end: string; setEnd: (value: string) => void; rows: ReportRow[]; totals: { income: number; expenditure: number }; profit: number; exportExcel: () => void; exportPdf: () => void }) { return <div className="space-y-5 animate-fade-up"><Controls branches={branches} branchId={branchId} setBranchId={setBranchId}><label className="min-w-40 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Start date</span><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label className="min-w-40 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">End date</span><Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label><Actions exportExcel={exportExcel} exportPdf={exportPdf} disabled={!rows.length} /></Controls><ReportTable rows={rows} columns={["Branch", "Account", "Type", "Debit", "Credit", "Result"]} getValues={(row) => [row.branch_id, row.account_name, labelType(row.ledger_type), money(row.debit), money(row.credit), money(row.ledger_type === "income" ? row.credit - row.debit : row.debit - row.credit)]} /><div className="grid gap-3 sm:grid-cols-3"><Summary label="Income" value={money(totals.income)} /><Summary label="Expenditure" value={money(totals.expenditure)} /><Summary label={profit >= 0 ? "Net profit" : "Net loss"} value={money(Math.abs(profit))} /></div></div>; }
function CashFlowView({ branches, branchId, setBranchId, start, setStart, end, setEnd, cashFilter, setCashFilter, rows, exportExcel, exportPdf }: { branches: Branch[]; branchId: string; setBranchId: (value: string) => void; start: string; setStart: (value: string) => void; end: string; setEnd: (value: string) => void; cashFilter: CashFilter; setCashFilter: (value: CashFilter) => void; rows: CashFlowRow[]; exportExcel: () => void; exportPdf: () => void }) { return <div className="space-y-5 animate-fade-up"><Controls branches={branches} branchId={branchId} setBranchId={setBranchId}><label className="min-w-40 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Start date</span><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label className="min-w-40 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">End date</span><Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label><label className="min-w-36 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Account filter</span><select value={cashFilter} onChange={(event) => setCashFilter(event.target.value as CashFilter)} className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="both">Cash + Bank</option><option value="cash">Cash only</option><option value="bank">Bank only</option></select></label><Actions exportExcel={exportExcel} exportPdf={exportPdf} disabled={!rows.length} /></Controls><CashFlowTable branches={branches} rows={rows} /><div className="grid gap-3 sm:grid-cols-3"><Summary label="Ledger lines" value={String(rows.length)} /><Summary label="Period debit" value={money(rows.filter((row) => row.kind === "movement").reduce((sum, row) => sum + row.debit, 0))} /><Summary label="Period credit" value={money(rows.filter((row) => row.kind === "movement").reduce((sum, row) => sum + row.credit, 0))} /></div></div>; }
function CashFlowTable({ branches, rows }: { branches: Branch[]; rows: CashFlowRow[] }) { const columns = ["Date", "Branch", "Account", "Type", "Voucher", "Description", "Debit", "Credit", "Balance", "Side", "Line"]; return <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{columns.map((column) => <th key={column} className="px-4 py-3">{column}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.length ? rows.map((row, index) => <tr key={`${row.account_id}-${row.kind}-${row.date}-${index}`} className={row.kind === "closing" ? "bg-primary-soft/40 font-semibold" : row.kind === "opening" ? "bg-muted/30" : "hover:bg-muted/30"}><td className="whitespace-nowrap px-4 py-3">{row.date}</td><td className="px-4 py-3">{branches.find((branch) => branch.id === row.branch_id)?.branch_name ?? "—"}</td><td className="px-4 py-3">{row.account_name}</td><td className="px-4 py-3">{labelType(row.ledger_type)}</td><td className="px-4 py-3">{row.voucher}</td><td className="px-4 py-3">{row.description}</td><td className="px-4 py-3 text-right tabular-nums">{row.debit ? money(row.debit) : "—"}</td><td className="px-4 py-3 text-right tabular-nums">{row.credit ? money(row.credit) : "—"}</td><td className="px-4 py-3 text-right tabular-nums">{money(row.balance)}</td><td className="px-4 py-3 text-right">{row.side}</td><td className="px-4 py-3 capitalize">{row.kind}</td></tr>) : <tr><td colSpan={columns.length} className="py-12 text-center text-muted-foreground">No cash or bank transactions for the selected filters.</td></tr>}</tbody></table></div></section>; }
function ReportTable({ rows, columns, getValues }: { rows: ReportRow[]; columns: string[]; getValues: (row: ReportRow) => string[] }) { return <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{columns.map((column) => <th key={column} className="px-4 py-3">{column}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.length ? rows.map((row) => <tr key={row.account_id} className="hover:bg-muted/30">{getValues(row).map((value, index) => <td key={`${row.account_id}-${index}`} className={`px-4 py-3 ${index >= 3 ? "text-right tabular-nums" : ""}`}>{value}</td>)}</tr>) : <tr><td colSpan={columns.length} className="py-12 text-center text-muted-foreground">No report data for the selected filters.</td></tr>}</tbody></table></div></section>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="surface-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
export function FinalAccountsPage() { return <FinalAccountsRoute />; }
