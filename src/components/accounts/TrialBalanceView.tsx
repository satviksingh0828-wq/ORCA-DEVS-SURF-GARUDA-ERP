import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Loader2, Scale } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useBranches, type BranchOption } from "@/lib/use-branches";
import { openBrandedTablePdf } from "@/lib/branded-pdf";

// The generated Supabase types predate the accounts tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type LedgerType = "asset" | "liability" | "income" | "expenditure" | "capital" | "bank" | "cash";
type TrialRow = { branch_id: string; ledger_account_id: string; account_name: string; ledger_type: LedgerType; debit: number; credit: number };
const money = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pdfMoney = (value: number) => `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN");
const amount = (value: unknown) => Number(value ?? 0) || 0;
const labelType = (value: LedgerType) => value === "bank" ? "Bank" : value === "cash" ? "Cash" : value === "capital" ? "Capital" : value[0].toUpperCase() + value.slice(1);

export function TrialBalanceView() {
  const branches = useBranches() as BranchOption[];
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const [branchId, setBranchId] = useState("all");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!asOf) return;
    setLoading(true);
    try {
      const { data, error } = await db.from("journal_lines").select("ledger_account_id,debit,credit,ledger_account:ledger_accounts!inner(account_name,ledger_type,branch_id),journal_entry:journal_entries!inner(entry_date,status,branch_id)").eq("journal_entry.status", "approved").lte("journal_entry.entry_date", asOf).limit(10000);
      if (error) throw new Error(error.message);
      const totals = new Map<string, TrialRow>();
      for (const row of (data ?? []) as Array<{ ledger_account_id: string; debit: number | string | null; credit: number | string | null; ledger_account?: { account_name: string; ledger_type: LedgerType; branch_id: string } | null; journal_entry?: { branch_id: string } | null }>) {
        const account = row.ledger_account;
        const branch = account?.branch_id ?? row.journal_entry?.branch_id;
        if (!account || !branch || (branchId !== "all" && branch !== branchId)) continue;
        const key = `${branch}:${row.ledger_account_id}`;
        const current = totals.get(key) ?? { branch_id: branch, ledger_account_id: row.ledger_account_id, account_name: account.account_name, ledger_type: account.ledger_type, debit: 0, credit: 0 };
        current.debit += amount(row.debit); current.credit += amount(row.credit); totals.set(key, current);
      }
      setRows([...totals.values()].sort((a, b) => `${branchById.get(a.branch_id)?.branch_name ?? ""}-${a.account_name}`.localeCompare(`${branchById.get(b.branch_id)?.branch_name ?? ""}-${b.account_name}`)));
    } catch (error) { toast.error(`Could not load trial balance: ${error instanceof Error ? error.message : String(error)}`); setRows([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [branchId, asOf]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({ debit: sum.debit + row.debit, credit: sum.credit + row.credit }), { debit: 0, credit: 0 }), [rows]);
  function exportExcel() {
    const data = rows.map((row) => { const net = row.debit - row.credit; return { Branch: branchById.get(row.branch_id)?.branch_name ?? "—", "Ledger account": row.account_name, Type: labelType(row.ledger_type), Debit: row.debit, Credit: row.credit, Balance: Math.abs(net), Side: net >= 0 ? "Dr" : "Cr", "As of": asOf }; });
    data.push({ Branch: "TOTAL", "Ledger account": "", Type: "", Debit: totals.debit, Credit: totals.credit, Balance: Math.abs(totals.debit - totals.credit), Side: totals.debit >= totals.credit ? "Dr" : "Cr", "As of": asOf });
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), "Trial Balance"); XLSX.writeFile(workbook, `trial-balance-${asOf}.xlsx`);
  }
  async function exportPdf() {
    const data = rows.map((row) => { const net = row.debit - row.credit; return [branchById.get(row.branch_id)?.branch_name ?? "—", row.account_name, labelType(row.ledger_type), row.debit ? pdfMoney(row.debit) : "—", row.credit ? pdfMoney(row.credit) : "—", `${pdfMoney(Math.abs(net))} ${net >= 0 ? "Dr" : "Cr"}`]; });
    data.push(["TOTAL", "", "", pdfMoney(totals.debit), pdfMoney(totals.credit), Math.abs(totals.debit - totals.credit) < 0.005 ? "Balanced" : `Difference ${pdfMoney(Math.abs(totals.debit - totals.credit))}`]);
    await openBrandedTablePdf({ title: "Trial Balance", subtitle: `${branchId === "all" ? "All branches" : branchById.get(branchId)?.branch_name ?? "Branch"} · As of ${dateText(asOf)}`, filename: `trial-balance-${asOf}.pdf`, orientation: "landscape", columns: ["Branch", "Ledger account", "Type", "Debit", "Credit", "Balance"], rows: data, summary: [["Total debit", pdfMoney(totals.debit)], ["Total credit", pdfMoney(totals.credit)], ["Status", Math.abs(totals.debit - totals.credit) < 0.005 ? "Balanced" : `Difference ${pdfMoney(Math.abs(totals.debit - totals.credit))}`]] });
  }
  return <div className="space-y-5 animate-fade-up"><section className="surface-card p-5"><div className="flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Branch</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="all">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}</select></label><label className="min-w-44 flex-1 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">As of date</span><Input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><Button type="button" variant="outline" onClick={() => void load()} disabled={loading} className="gap-2">{loading ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}{loading ? "Refreshing…" : "Refresh"}</Button><Button type="button" variant="outline" onClick={exportExcel} disabled={!rows.length || loading} className="gap-2"><FileSpreadsheet className="size-4" />Excel</Button><Button type="button" variant="outline" onClick={() => void exportPdf()} disabled={!rows.length || loading} className="gap-2"><FileDown className="size-4" />PDF</Button></div><p className="mt-4 text-sm text-muted-foreground">Live approved journal postings through {dateText(asOf)}. Trial Balance is part of Final Accounts, not Ledger.</p></section><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{rows.length} ledger account{rows.length === 1 ? "" : "s"}</p><div className="flex gap-4 text-sm"><span>Total debit: <strong>{money(totals.debit)}</strong></span><span>Total credit: <strong>{money(totals.credit)}</strong></span></div></div><section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{["Branch", "Ledger account", "Type", "Debit", "Credit", "Balance"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{loading ? <tr><td colSpan={6} className="py-12 text-center"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr> : rows.length ? rows.map((row) => { const net = row.debit - row.credit; return <tr key={`${row.branch_id}-${row.ledger_account_id}`} className="hover:bg-muted/30"><td className="px-4 py-3">{branchById.get(row.branch_id)?.branch_name ?? "—"}</td><td className="px-4 py-3 font-semibold">{row.account_name}</td><td className="px-4 py-3">{labelType(row.ledger_type)}</td><td className="px-4 py-3 text-right tabular-nums">{money(row.debit)}</td><td className="px-4 py-3 text-right tabular-nums">{money(row.credit)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(Math.abs(net))} {net >= 0 ? "Dr" : "Cr"}</td></tr>; }) : <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No approved journal postings exist for this branch and date.</td></tr>}</tbody>{rows.length > 0 && <tfoot><tr className="border-t-2 border-border bg-muted/30 font-semibold"><td colSpan={3} className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{money(totals.debit)}</td><td className="px-4 py-3 text-right">{money(totals.credit)}</td><td className="px-4 py-3 text-right">{Math.abs(totals.debit - totals.credit) < 0.005 ? "Balanced" : `Difference ${money(Math.abs(totals.debit - totals.credit))}`}</td></tr></tfoot>}</table></div></section></div>;
}
