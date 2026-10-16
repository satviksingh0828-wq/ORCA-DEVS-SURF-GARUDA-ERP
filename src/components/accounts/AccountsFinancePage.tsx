/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FilePlus2, Paperclip, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { LtmsAccountingBilling } from "@/components/reports/LtmsAccountingBilling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";

const db = supabase as any;
const today = () => new Date().toISOString().slice(0, 10);
const tabs = [
  { id: "parties", label: "Parties" },
  { id: "debit-notes", label: "Debit Notes" },
  { id: "credit-notes", label: "Credit Notes" },
  { id: "cash-receipt", label: "Cash Receipt" },
  { id: "cash-payment", label: "Cash Payment" },
] as const;
type TabId = (typeof tabs)[number]["id"];
type Line = { account: string; amount: string };
type Ledger = {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: string;
  account_kind: string;
};
type Voucher = {
  id: string;
  voucher_number: string;
  voucher_type: string;
  voucher_date: string;
  branch_id: string;
  name: string;
  description: string | null;
  amount: number | string;
  supporting_document: string | null;
  journal_entry_id: string;
  branch?: { branch_name?: string } | null;
};

export const AccountsFinanceRoute = () => (
  <RequireAuth>
    <AccountsAccessGuard allowBasicFinance>
      <AccountsFinancePage />
    </AccountsAccessGuard>
  </RequireAuth>
);
export function AccountsFinancePage() {
  const { user } = useSession();
  const allBranches = useBranches();
  const branches =
    user?.role === "basic"
      ? allBranches.filter((b) => (user.branchIds ?? []).includes(b.id))
      : allBranches;
  const [tab, setTab] = useState<TabId>("parties");
  const [rows, setRows] = useState<Voucher[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [branchFilter, setBranchFilter] = useState("all");
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    branch: "",
    date: today(),
    name: "",
    description: "",
    file: null as File | null,
  });
  const [incomeLines, setIncomeLines] = useState<Line[]>([{ account: "", amount: "" }]);
  const [cashLines, setCashLines] = useState<Line[]>([{ account: "", amount: "" }]);
  const isReceipt = tab === "cash-receipt";
  const isCashTab = tab === "cash-receipt" || tab === "cash-payment";
  const allowed = useMemo(() => new Set(branches.map((b) => b.id)), [branches]);
  const currency = (amount: number | string) =>
    `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const load = useCallback(async () => {
    if (!isCashTab) return;
    let q = db
      .from("account_cash_vouchers")
      .select("*,branch:branches(branch_name)")
      .eq("voucher_type", isReceipt ? "receipt" : "payment")
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .order("voucher_date", { ascending: false });
    if (user?.role === "basic")
      q = q.in(
        "branch_id",
        user.branchIds?.length ? user.branchIds : ["00000000-0000-0000-0000-000000000000"],
      );
    if (branchFilter !== "all") q = q.eq("branch_id", branchFilter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setRows(data ?? []);
  }, [isCashTab, isReceipt, from, to, user?.role, user?.branchIds, branchFilter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let q = db
      .from("ledger_accounts")
      .select("id,branch_id,account_name,ledger_type,account_kind")
      .eq("is_active", true)
      .order("account_name");
    if (user?.role === "basic")
      q = q.in(
        "branch_id",
        user.branchIds?.length ? user.branchIds : ["00000000-0000-0000-0000-000000000000"],
      );
    void q.then(({ data, error }: any) => {
      if (error) toast.error(error.message);
      else setLedgers(data ?? []);
    });
  }, [user?.role, user?.branchIds]);
  const selectedLedgers = ledgers.filter((a) => a.branch_id === form.branch);
  const incomeExpense = selectedLedgers.filter(
    (a) => a.ledger_type === (isReceipt ? "income" : "expenditure"),
  );
  const cashBank = selectedLedgers.filter(
    (a) => a.ledger_type === "cash" || a.ledger_type === "bank",
  );
  const visibleRows = rows.filter((r) =>
    `${r.voucher_number} ${r.name} ${r.description ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const lineSum = (lines: Line[]) => lines.reduce((n, l) => n + (Number(l.amount) || 0), 0);
  const total = lineSum(incomeLines);
  function updateLine(which: "income" | "cash", index: number, key: keyof Line, value: string) {
    const setter = which === "income" ? setIncomeLines : setCashLines;
    setter((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  }
  function addLine(which: "income" | "cash") {
    (which === "income" ? setIncomeLines : setCashLines)((current) => [
      ...current,
      { account: "", amount: "" },
    ]);
  }
  async function createVoucher(event: React.FormEvent) {
    event.preventDefault();
    if (!form.branch || !form.name.trim()) return toast.error("Branch and name are required.");
    if (!allowed.has(form.branch)) return toast.error("You do not have access to this branch.");
    const invalid = (lines: Line[]) =>
      !lines.length || lines.some((line) => !line.account || Number(line.amount) <= 0);
    if (invalid(incomeLines) || invalid(cashLines))
      return toast.error("Select accounts and enter a positive amount on every line.");
    if (Math.abs(lineSum(incomeLines) - lineSum(cashLines)) > 0.005 || total <= 0)
      return toast.error(
        "Income/expense total must equal cash/bank total and be greater than zero.",
      );
    setSaving(true);
    try {
      let documentPath: string | null = null;
      if (form.file) {
        const safeName = form.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        documentPath = `${form.branch}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from("account-cash-vouchers")
          .upload(documentPath, form.file, { upsert: false });
        if (error) throw new Error(`Document upload failed: ${error.message}`);
      }
      const { error } = await db.rpc("post_account_cash_voucher", {
        p_voucher_type: isReceipt ? "receipt" : "payment",
        p_branch_id: form.branch,
        p_voucher_date: form.date,
        p_name: form.name.trim(),
        p_description: form.description.trim() || null,
        p_supporting_document: documentPath,
        p_created_by: user?.id,
        p_income_expense_lines: incomeLines.map((l) => ({
          account_id: l.account,
          amount: Number(l.amount),
        })),
        p_cash_bank_lines: cashLines.map((l) => ({
          account_id: l.account,
          amount: Number(l.amount),
        })),
      });
      if (error) throw new Error(error.message);
      toast.success(`${isReceipt ? "Cash receipt" : "Cash payment"} posted to journal.`);
      setOpen(false);
      setForm({ branch: "", date: today(), name: "", description: "", file: null });
      setIncomeLines([{ account: "", amount: "" }]);
      setCashLines([{ account: "", amount: "" }]);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  async function downloadDocument(path: string) {
    const { data, error } = await supabase.storage
      .from("account-cash-vouchers")
      .createSignedUrl(path, 300);
    if (error || !data?.signedUrl) toast.error(error?.message || "Could not open document");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  return (
    <AppShell
      variant="ltms"
      shellTitle="Accounts"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home">Workspace</Link>
          <span>/</span>
          <Link to="/accounts">Accounts</Link>
          <span>/</span>
          <span className="text-foreground">Finance</span>
        </span>
      }
    >
      <div className="ltms-reference-shell accounts-reference-shell">
        <div className="ltms-reference-content min-w-0">
          <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Accounts Finance">
            {tabs.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${tab === item.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
              >
                {item.label}
              </button>
            ))}
            <Link
              to="/accounts/gst"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              GST
            </Link>
          </div>
          {(tab === "parties" || tab === "debit-notes" || tab === "credit-notes") && (
            <LtmsAccountingBilling initialTab={tab} />
          )}
          {isCashTab && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setForm((f) => ({ ...f, branch: branches[0]?.id ?? "" }));
                    setOpen(true);
                  }}
                >
                  <FilePlus2 className="mr-2 size-4" />
                  Create {isReceipt ? "Receipt" : "Payment"}
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>Branch</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                  >
                    <option value="all">All branches</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.branch_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>From</span>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  <span>To</span>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
                <label className="relative space-y-1 text-xs font-medium text-muted-foreground">
                  <span>Search vouchers</span>
                  <Search className="absolute left-2 top-7 size-4" />
                  <Input
                    className="pl-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Voucher, name or description"
                  />
                </label>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      {[
                        "Voucher",
                        "Date",
                        "Branch",
                        "Name",
                        "Description",
                        "Amount",
                        "Journal",
                        "Document",
                      ].map((x) => (
                        <th className="px-3 py-3" key={x}>
                          {x}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr className="border-t border-border" key={r.id}>
                        <td className="px-3 py-3 font-medium">{r.voucher_number}</td>
                        <td className="px-3 py-3">{r.voucher_date}</td>
                        <td className="px-3 py-3">{r.branch?.branch_name ?? "—"}</td>
                        <td className="px-3 py-3">{r.name}</td>
                        <td className="px-3 py-3">{r.description || "—"}</td>
                        <td className="px-3 py-3">{currency(r.amount)}</td>
                        <td className="px-3 py-3 text-xs">{r.journal_entry_id}</td>
                        <td className="px-3 py-3">
                          {r.supporting_document ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void downloadDocument(r.supporting_document!)}
                            >
                              <Paperclip className="mr-1 size-3" />
                              Open
                            </Button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                    {!visibleRows.length && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-muted-foreground">
                          No vouchers found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {open && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="presentation"
            >
              <form
                onSubmit={createVoucher}
                className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-background p-5 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-label={`Create ${isReceipt ? "cash receipt" : "cash payment"}`}
              >
                <h2 className="mb-4 text-lg font-semibold">
                  Create Cash {isReceipt ? "Receipt" : "Payment"}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    <span>Branch *</span>
                    <select
                      required
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={form.branch}
                      onChange={(e) => {
                        setForm({ ...form, branch: e.target.value });
                        setIncomeLines([{ account: "", amount: "" }]);
                        setCashLines([{ account: "", amount: "" }]);
                      }}
                    >
                      <option value="">Select branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.branch_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    <span>Date *</span>
                    <Input
                      type="date"
                      required
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground">
                    <span>Name *</span>
                    <Input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Payer / payee name"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-3">
                    <span>Description (optional)</span>
                    <Input
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Purpose or narration"
                    />
                  </label>
                </div>
                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <VoucherLines
                    title={isReceipt ? "Income accounts (credit)" : "Expenditure accounts (debit)"}
                    lines={incomeLines}
                    accounts={incomeExpense}
                    onChange={(i, k, v) => updateLine("income", i, k, v)}
                    onAdd={() => addLine("income")}
                    onRemove={(i) =>
                      setIncomeLines((current) => current.filter((_, index) => index !== i))
                    }
                  />
                  <VoucherLines
                    title="Cash / bank accounts"
                    lines={cashLines}
                    accounts={cashBank}
                    onChange={(i, k, v) => updateLine("cash", i, k, v)}
                    onAdd={() => addLine("cash")}
                    onRemove={(i) =>
                      setCashLines((current) => current.filter((_, index) => index !== i))
                    }
                  />
                </div>
                <p className="mt-3 text-sm font-semibold">Balanced total: {currency(total)}</p>
                <label className="mt-4 block space-y-1 text-xs font-medium text-muted-foreground">
                  <span>Supporting document (optional)</span>
                  <Input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
                  />
                </label>
                <div className="mt-5 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Posting…" : "Post voucher & journal"}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
function VoucherLines({
  title,
  lines,
  accounts,
  onChange,
  onAdd,
  onRemove,
}: {
  title: string;
  lines: Line[];
  accounts: Ledger[];
  onChange: (index: number, key: keyof Line, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="mr-1 size-3.5" />
          Add line
        </Button>
      </div>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div className="grid grid-cols-[minmax(0,1fr)_110px_34px] gap-2" key={i}>
            <select
              className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
              value={line.account}
              onChange={(e) => onChange(i, "account", e.target.value)}
            >
              <option value="">Select account</option>
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.account_name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={line.amount}
              onChange={(e) => onChange(i, "amount", e.target.value)}
              placeholder="Amount"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Remove line"
              disabled={lines.length === 1}
              onClick={() => onRemove(i)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
