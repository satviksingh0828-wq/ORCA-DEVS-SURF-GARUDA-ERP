import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountsMobileNav, AccountsSidebar } from "@/components/accounts/AccountsSectionNav";
import { AppShell } from "@/components/AppShell";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";

const db = supabase as any;
type Tab = "create" | "manage";
type Ledger = { id: string; account_name: string; branch_id: string; ledger_type: string; opening_balance?: number | null };
type Schedule = {
  id: string; branch_id: string; asset_ledger_id: string; expense_ledger_id: string; current_value: number;
  period: "monthly" | "quarterly" | "yearly"; depreciation_type: "fixed" | "reducing_balance";
  fixed_method: "amount" | "percentage" | null; rate: number | null; fixed_amount: number | null; first_period: string;
  branch?: { branch_name?: string }; asset?: { account_name?: string }; expense?: { account_name?: string };
};
type Entry = { id: string; schedule_id: string | null; branch_id: string; asset_ledger_id: string; period_start: string; opening_value: number; depreciation_amount: number; closing_value: number; posted_at: string; journal_entry_id: string; asset?: { account_name?: string }; branch?: { branch_name?: string } };

const money = (value: unknown) => `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthStart = (value: string) => value ? `${value}-01` : "";
const nextPeriod = (date: string, period: Schedule["period"]) => {
  const d = new Date(`${date}T00:00:00`);
  d.setMonth(d.getMonth() + (period === "monthly" ? 1 : period === "quarterly" ? 3 : 12));
  return d.toISOString().slice(0, 10);
};

export function AccountsDepreciationRoute() {
  return <AccountsAccessGuard><AccountsDepreciationPage /></AccountsAccessGuard>;
}

function AccountsDepreciationPage() {
  const branches = useBranches();
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>("create");
  const [creating, setCreating] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(false);
  const [branchFilter, setBranchFilter] = useState("all");
  const [assetSearch, setAssetSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [form, setForm] = useState({ branchId: "", assetId: "", expenseId: "", currentValue: "", period: "monthly", type: "fixed", method: "amount", rate: "", fixedAmount: "", firstPeriod: new Date().toISOString().slice(0, 7) });
  const selectedAsset = ledgers.find((item) => item.id === form.assetId);
  const branchLedgers = ledgers.filter((item) => item.branch_id === form.branchId);
  const assets = branchLedgers.filter((item) => item.ledger_type === "asset");
  const expenses = branchLedgers.filter((item) => item.ledger_type === "expenditure");
  const filteredSchedules = useMemo(() => schedules.filter((row) => {
    const branchOk = branchFilter === "all" || row.branch_id === branchFilter;
    const searchOk = !assetSearch.trim() || String(row.asset?.account_name ?? "").toLowerCase().includes(assetSearch.trim().toLowerCase());
    return branchOk && searchOk;
  }), [schedules, branchFilter, assetSearch]);
  const filteredEntries = useMemo(() => entries.filter((row) => {
    const branchOk = branchFilter === "all" || row.branch_id === branchFilter;
    const searchOk = !assetSearch.trim() || String(row.asset?.account_name ?? "").toLowerCase().includes(assetSearch.trim().toLowerCase());
    const monthOk = !monthFilter || row.period_start.startsWith(monthFilter);
    return branchOk && searchOk && monthOk;
  }), [entries, branchFilter, assetSearch, monthFilter]);
  const dueSchedules = useMemo(() => filteredSchedules.filter((row) => {
    const posted = entries.filter((entry) => entry.schedule_id === row.id);
    const last = posted[0]?.period_start;
    const next = last ? nextPeriod(last, row.period) : row.first_period;
    const cutoff = monthFilter ? monthStart(monthFilter) : new Date().toISOString().slice(0, 7) + "-01";
    return next <= cutoff;
  }), [filteredSchedules, entries, monthFilter]);

  async function loadData() {
    setLoading(true);
    const [scheduleResult, entryResult, ledgerResult] = await Promise.all([
      db.from("account_depreciation_schedules").select("*,branch:branches(branch_name),asset:ledger_accounts!account_depreciation_schedules_asset_ledger_id_fkey(account_name),expense:ledger_accounts!account_depreciation_schedules_expense_ledger_id_fkey(account_name)").order("created_at", { ascending: false }),
      db.from("account_depreciation_entries").select("*,asset:ledger_accounts!account_depreciation_entries_asset_ledger_id_fkey(account_name),branch:branches(branch_name)").order("period_start", { ascending: false }),
      db.from("ledger_accounts").select("id,account_name,branch_id,ledger_type,opening_balance").eq("is_active", true).order("account_name"),
    ]);
    if (scheduleResult.error) toast.error(scheduleResult.error.message);
    if (entryResult.error) toast.error(entryResult.error.message);
    if (ledgerResult.error) toast.error(ledgerResult.error.message);
    setSchedules((scheduleResult.data ?? []) as Schedule[]);
    setEntries((entryResult.data ?? []) as Entry[]);
    setLedgers((ledgerResult.data ?? []) as Ledger[]);
    setLoading(false);
  }
  useEffect(() => { void loadData(); }, []);

  function changeBranch(id: string) {
    const branchAssets = ledgers.filter((item) => item.branch_id === id && item.ledger_type === "asset");
    const branchExpenses = ledgers.filter((item) => item.branch_id === id && item.ledger_type === "expenditure");
    setForm((current) => ({ ...current, branchId: id, assetId: branchAssets[0]?.id ?? "", expenseId: branchExpenses[0]?.id ?? "", currentValue: branchAssets[0]?.opening_balance ? String(branchAssets[0].opening_balance) : "" }));
  }
  function changeAsset(id: string) {
    const asset = ledgers.find((item) => item.id === id);
    setForm((current) => ({ ...current, assetId: id, currentValue: asset?.opening_balance ? String(asset.opening_balance) : "" }));
  }
  async function createSchedule(event: React.FormEvent) {
    event.preventDefault();
    if (!form.branchId || !form.assetId || !form.expenseId || !form.currentValue) return toast.error("Branch, asset, value and depreciation account are required");
    if (form.type === "fixed" && form.method === "amount" && !form.fixedAmount) return toast.error("Enter the fixed amount");
    if (!form.rate && (form.method === "percentage" || form.type === "reducing_balance")) return toast.error("Enter the depreciation percentage");
    const currentValue = Number(form.currentValue);
    const rate = form.rate ? Number(form.rate) : null;
    const fixedAmount = form.type === "fixed" && form.method === "amount" ? Number(form.fixedAmount) : null;
    const { error } = await db.rpc("create_account_depreciation_schedule", {
      p_branch_id: form.branchId, p_asset_ledger_id: form.assetId, p_expense_ledger_id: form.expenseId, p_current_value: currentValue,
      p_period: form.period, p_depreciation_type: form.type, p_fixed_method: form.type === "fixed" ? form.method : null,
      p_rate: form.type === "reducing_balance" || form.method === "percentage" ? rate : null, p_fixed_amount: fixedAmount,
      p_first_period: monthStart(form.firstPeriod), p_created_by: user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Depreciation schedule created");
    setCreating(false);
    await loadData();
  }
  async function postEntry(schedule: Schedule, period: string) {
    if (!confirm(`Post depreciation for ${period.slice(0, 7)} on ${schedule.asset?.account_name}?`)) return;
    const { error } = await db.rpc("post_account_depreciation_entry", { p_schedule_id: schedule.id, p_period_start: period, p_posted_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success("Depreciation entry posted");
    await loadData();
  }
  async function deleteSchedule(schedule: Schedule) {
    if (!confirm("Delete this schedule? Posted depreciation entries and journals will remain; only future postings will stop.")) return;
    const { error } = await db.rpc("delete_account_depreciation_schedule", { p_schedule_id: schedule.id, p_deleted_by: user?.id });
    if (error) return toast.error(error.message);
    toast.success("Schedule deleted; posted entries were preserved");
    await loadData();
  }

  return <AppShell variant="ltms" shellTitle="Accounts" breadcrumb={<span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Link to="/home">Workspace</Link><span>/</span><Link to="/accounts">Accounts</Link><span>/</span><span className="text-foreground">Depreciation</span></span>}>
    <div className="ltms-reference-shell accounts-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
      <AccountsSidebar mode="depreciation" activeTabId={tab} onSelectTab={(id) => { setTab(id as Tab); setCreating(false); }} />
      <div className="ltms-reference-content min-w-0">
        <AccountsMobileNav pathname="/accounts/depreciation" />
        <div className="lg:hidden"><MobileTabDropdown tabs={[{ id: "create", label: "Create Schedule", desc: "Create depreciation schedule", icon: Plus }, { id: "manage", label: "Manage Schedule", desc: "Post and review entries", icon: CalendarClock }]} activeId={tab} label="Depreciation tabs" compact onChange={(id) => { setTab(id as Tab); setCreating(false); }} /></div>
        <main className="min-w-0 space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Accounts / Depreciation</p><h1 className="text-2xl font-bold">Depreciation</h1><p className="text-sm text-muted-foreground">Manual period-by-period depreciation posting.</p></div>{tab === "create" && !creating && <Button onClick={() => setCreating(true)}><Plus className="mr-1 size-4" />Create Schedule</Button>}</div>
          {tab === "create" && (creating ? <CreateForm form={form} setForm={setForm} branches={branches} assets={assets} expenses={expenses} selectedAsset={selectedAsset} changeBranch={changeBranch} changeAsset={changeAsset} onSubmit={createSchedule} onBack={() => setCreating(false)} /> : <ScheduleList rows={filteredSchedules} branches={branches} branchFilter={branchFilter} setBranchFilter={setBranchFilter} assetSearch={assetSearch} setAssetSearch={setAssetSearch} loading={loading} onDelete={deleteSchedule} />)}
          {tab === "manage" && <ManageList schedules={dueSchedules} entries={filteredEntries} allEntries={entries} branches={branches} branchFilter={branchFilter} setBranchFilter={setBranchFilter} assetSearch={assetSearch} setAssetSearch={setAssetSearch} monthFilter={monthFilter} setMonthFilter={setMonthFilter} onPost={postEntry} onDelete={deleteSchedule} loading={loading} />}
        </main>
      </div>
    </div>
  </AppShell>;
}

function CreateForm({ form, setForm, branches, assets, expenses, selectedAsset, changeBranch, changeAsset, onSubmit, onBack }: any) {
  const set = (key: string, value: string) => setForm((current: any) => ({ ...current, [key]: value }));
  const autoAmount = form.method === "percentage" && form.rate && form.currentValue ? (Number(form.currentValue) * Number(form.rate) / 100).toFixed(2) : "";
  return <form onSubmit={onSubmit} className="space-y-4 rounded-xl border bg-card p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Create depreciation schedule</h2><Button type="button" variant="outline" onClick={onBack}><ArrowLeft className="mr-1 size-4" />Back to list</Button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <Field label="Branch"><Select value={form.branchId} onValueChange={changeBranch}><SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger><SelectContent>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Asset"><Select value={form.assetId} onValueChange={changeAsset} disabled={!form.branchId}><SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger><SelectContent>{assets.map((a: Ledger) => <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>)}</SelectContent></Select></Field>
    <Field label="Current value"><Input type="number" min="0.01" step="0.01" value={form.currentValue} onChange={(e) => set("currentValue", e.target.value)} placeholder={selectedAsset?.opening_balance ? String(selectedAsset.opening_balance) : "Current asset value"} /></Field>
    <Field label="Period"><Select value={form.period} onValueChange={(v) => set("period", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select></Field>
    <Field label="Depreciation type"><Select value={form.type} onValueChange={(v) => set("type", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="reducing_balance">Reducing balance</SelectItem></SelectContent></Select></Field>
    {form.type === "fixed" && <Field label="Fixed method"><Select value={form.method} onValueChange={(v) => set("method", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="amount">Fixed amount</SelectItem><SelectItem value="percentage">Percentage</SelectItem></SelectContent></Select></Field>}
    {(form.type === "reducing_balance" || form.method === "percentage") && <Field label="Percentage"><Input type="number" min="0.01" max="100" step="0.01" value={form.rate} onChange={(e) => set("rate", e.target.value)} placeholder="e.g. 10" /></Field>}
    {form.type === "fixed" && form.method === "amount" && <Field label="Fixed amount"><Input type="number" min="0.01" step="0.01" value={form.fixedAmount} onChange={(e) => set("fixedAmount", e.target.value)} /></Field>}
    {autoAmount && <Field label="Calculated fixed amount"><Input value={autoAmount} readOnly className="bg-muted" /></Field>}
    <Field label="First depreciation month"><Input type="month" value={form.firstPeriod} onChange={(e) => set("firstPeriod", e.target.value)} /></Field>
    <Field label="Depreciation expense account"><Select value={form.expenseId} onValueChange={(v) => set("expenseId", v)} disabled={!form.branchId}><SelectTrigger><SelectValue placeholder="Select expenditure account" /></SelectTrigger><SelectContent>{expenses.map((a: Ledger) => <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>)}</SelectContent></Select></Field>
  </div><p className="text-xs text-muted-foreground">Entries are never automatic. Each period is manually posted from Manage Schedule.</p><Button type="submit">Save Schedule</Button></form>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-1"><Label>{label}</Label>{children}</div>; }
function Filters({ branches, branchFilter, setBranchFilter, assetSearch, setAssetSearch, monthFilter, setMonthFilter, month }: any) { return <div className="flex flex-wrap gap-2 rounded-xl border bg-muted/20 p-3"><Select value={branchFilter} onValueChange={setBranchFilter}><SelectTrigger className="w-48"><SelectValue placeholder="All branches" /></SelectTrigger><SelectContent><SelectItem value="all">All branches</SelectItem>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}</SelectContent></Select><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="w-64 pl-8" placeholder="Search by asset" value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} /></div>{month && <Input className="w-44" type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} />}</div>; }
function ScheduleList({ rows, branches, branchFilter, setBranchFilter, assetSearch, setAssetSearch, loading, onDelete }: any) { return <section className="space-y-3"><Filters {...{ branches, branchFilter, setBranchFilter, assetSearch, setAssetSearch }} /><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="p-3">Branch</th><th className="p-3">Asset</th><th className="p-3">Value</th><th className="p-3">Method</th><th className="p-3">Period</th><th className="p-3">Account</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map((row: Schedule) => <tr key={row.id} className="border-t"><td className="p-3">{row.branch?.branch_name}</td><td className="p-3 font-medium">{row.asset?.account_name}</td><td className="p-3">{money(row.current_value)}</td><td className="p-3">{row.depreciation_type === "fixed" ? `${row.fixed_method === "percentage" ? `${row.rate}% (${money(row.fixed_amount)})` : money(row.fixed_amount)}` : `${row.rate}% reducing balance`}</td><td className="p-3 capitalize">{row.period}</td><td className="p-3">{row.expense?.account_name}</td><td className="p-3"><Button variant="ghost" size="sm" onClick={() => void onDelete(row)}><Trash2 className="mr-1 size-4" />Delete</Button></td></tr>)}{!rows.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{loading ? "Loading…" : "No depreciation schedules found."}</td></tr>}</tbody></table></div></section>; }
function ManageList({ schedules, entries, allEntries, branches, branchFilter, setBranchFilter, assetSearch, setAssetSearch, monthFilter, setMonthFilter, onPost, onDelete, loading }: any) { return <section className="space-y-4"><Filters {...{ branches, branchFilter, setBranchFilter, assetSearch, setAssetSearch, monthFilter, setMonthFilter, month: true }} /><div className="rounded-xl border"><div className="border-b p-3 font-semibold">Schedules with pending manual entries</div><div className="divide-y">{schedules.map((row: Schedule) => { const posted = allEntries.filter((e: Entry) => e.schedule_id === row.id); const last = posted[0]?.period_start; const next = last ? nextPeriod(last, row.period) : row.first_period; const already = posted.some((e: Entry) => e.period_start === next); return <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><div className="font-medium">{row.asset?.account_name}</div><div className="text-xs text-muted-foreground">{row.branch?.branch_name} · {row.period} · Next period: {next.slice(0, 7)}</div></div><div className="flex items-center gap-2"><Button size="sm" disabled={already || Number(posted[0]?.closing_value ?? row.current_value) <= 0} onClick={() => void onPost(row, next)}><CalendarClock className="mr-1 size-4" />Post {next.slice(0, 7)}</Button><Button variant="ghost" size="sm" onClick={() => void onDelete(row)}><Trash2 className="mr-1 size-4" />Delete</Button></div></div>})}{!schedules.length && <p className="p-8 text-center text-muted-foreground">{loading ? "Loading…" : "No schedules found."}</p>}</div></div><div className="overflow-x-auto rounded-xl border"><div className="border-b p-3 font-semibold">Posted depreciation entries</div><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="p-3">Period</th><th className="p-3">Branch</th><th className="p-3">Asset</th><th className="p-3">Opening</th><th className="p-3">Depreciation</th><th className="p-3">Closing</th><th className="p-3">Journal</th></tr></thead><tbody>{entries.map((row: Entry) => <tr key={row.id} className="border-t"><td className="p-3">{row.period_start.slice(0, 7)}</td><td className="p-3">{row.branch?.branch_name}</td><td className="p-3">{row.asset?.account_name}</td><td className="p-3">{money(row.opening_value)}</td><td className="p-3">{money(row.depreciation_amount)}</td><td className="p-3">{money(row.closing_value)}</td><td className="p-3 font-mono text-xs">{row.journal_entry_id.slice(0, 8)}</td></tr>)}{!entries.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No posted depreciation entries match the filters.</td></tr>}</tbody></table></div></section>; }
