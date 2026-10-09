/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Banknote, FilePlus2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const db = supabase as any;
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const money = (value: number | string | null | undefined) =>
  `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Account = {
  id: string;
  account_name: string;
  ledger_type: string;
  account_kind: string;
  branch_id: string;
};
type Party = {
  id: string;
  branch_id: string;
  party_name: string | null;
  gstin: string | null;
  party_type: "debtor" | "creditor";
  ledger_account_id: string;
  branch?: { branch_name?: string } | null;
  ledger_account?: Account | null;
  total_debit?: number;
  total_credit?: number;
  balance?: number;
};
type Note = {
  id: string;
  note_number: string;
  note_type: "debit" | "credit";
  branch_id: string;
  party_id: string;
  note_date: string;
  amount: number;
  description: string | null;
  offset_party_id: string | null;
  offset_ledger_id: string | null;
  journal_entry_id: string;
  settlement_journal_entry_id: string | null;
  status: string;
  settled_amount: number;
  branch?: { branch_name?: string } | null;
  party?: { party_name?: string | null; party_type?: string } | null;
};

function allowedBranches(branches: any[], user: any) {
  return user?.role === "basic"
    ? branches.filter((b) => (user.branchIds ?? []).includes(b.id))
    : branches;
}
function SelectField({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function LtmsAccountingBilling({ initialTab = "parties" }: { initialTab?: string }) {
  const { user } = useSession();
  const branches = allowedBranches(useBranches(), user);
  if (initialTab === "debit-notes" || initialTab === "credit-notes") {
    return (
      <NotesTab
        noteType={initialTab === "debit-notes" ? "debit" : "credit"}
        branches={branches}
        user={user}
      />
    );
  }
  return <PartiesTab branches={branches} user={user} />;
}

function PartiesTab({ branches, user }: { branches: any[]; user: any }) {
  const [rows, setRows] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branch, setBranch] = useState("all");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    branch: "",
    name: "",
    gstin: "",
    type: "debtor",
    account: "",
    newAccount: "",
    createAccount: false,
  });
  const load = async () => {
    let q = db.from("ltms_billing_parties_summary").select("*").order("party_name");
    if (user?.role === "basic")
      q = q.in("branch_id", user.branchIds ?? ["00000000-0000-0000-0000-000000000000"]);
    if (branch !== "all") q = q.eq("branch_id", branch);
    if (type !== "all") q = q.eq("party_type", type);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Party[]);
  };
  useEffect(() => {
    void load();
  }, [branch, type]);
  useEffect(() => {
    if (!form.branch) return;
    void db
      .from("ledger_accounts")
      .select("id,account_name,ledger_type,account_kind,branch_id")
      .eq("branch_id", form.branch)
      .eq("is_active", true)
      .in("ledger_type", [form.type === "debtor" ? "asset" : "liability"])
      .order("account_name")
      .then(({ data, error }: any) => {
        if (error) toast.error(error.message);
        else setAccounts(data ?? []);
      });
  }, [form.branch, form.type]);
  const visible = rows.filter((r) =>
    `${r.party_name ?? ""} ${r.gstin ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  async function save() {
    if (!form.branch || !form.name.trim() || !form.type)
      return toast.error("Branch, party type and party name are required");
    if (!form.createAccount && !form.account)
      return toast.error("Select an account or create a new account");
    setSaving(true);
    try {
      let account = form.account;
      if (form.createAccount) {
        if (!form.newAccount.trim()) throw new Error("New account name is required");
        const { data, error } = await db.rpc("create_manual_ledger", {
          p_branch_id: form.branch,
          p_ledger_type: form.type === "debtor" ? "asset" : "liability",
          p_description: form.newAccount.trim(),
          p_opening_balance: 0,
          p_opening_balance_date: null,
          p_account_kind: "ledger",
        });
        if (error) throw error;
        account = data;
      }
      const { error } = await db.rpc("create_ltms_billing_party", {
        p_branch_id: form.branch,
        p_party_name: form.name.trim(),
        p_gstin: form.gstin.trim() || null,
        p_party_type: form.type,
        p_ledger_account_id: account,
        p_created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Party created");
      setOpen(false);
      setForm({
        branch: "",
        name: "",
        gstin: "",
        type: "debtor",
        account: "",
        newAccount: "",
        createAccount: false,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-end gap-3">
        <Button
          onClick={() => {
            setForm((f) => ({ ...f, branch: branches[0]?.id ?? "" }));
            setOpen(true);
          }}
        >
          <Plus className="mr-1 size-4" /> Create Party
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField label="Branch" value={branch} onChange={setBranch}>
          <option value="all">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.branch_name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Type" value={type} onChange={setType}>
          <option value="all">All types</option>
          <option value="debtor">Debtor</option>
          <option value="creditor">Creditor</option>
        </SelectField>
        <label className="relative space-y-1 text-xs font-medium text-muted-foreground">
          <span>Search</span>
          <Search className="absolute left-2 top-7 size-4" />
          <Input
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Party or GSTIN"
          />
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              {["Party", "GSTIN", "Branch", "Type", "Total Dr", "Total Cr", "Balance"].map((x) => (
                <th className="px-3 py-3" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const bal = Number(r.balance ?? 0);
              return (
                <tr className="border-t border-border" key={r.id}>
                  <td className="px-3 py-3 font-medium">{r.party_name || "—"}</td>
                  <td className="px-3 py-3">{r.gstin || "—"}</td>
                  <td className="px-3 py-3">{r.branch?.branch_name || "—"}</td>
                  <td className="px-3 py-3 capitalize">{r.party_type}</td>
                  <td className="px-3 py-3">{money(r.total_debit)}</td>
                  <td className="px-3 py-3">{money(r.total_credit)}</td>
                  <td
                    className={`px-3 py-3 font-semibold ${bal >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {money(Math.abs(bal))} {bal >= 0 ? "Dr" : "Cr"}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No parties found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <Dialog title="Create Party" onClose={() => setOpen(false)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Branch"
              value={form.branch}
              onChange={(v) => setForm({ ...form, branch: v, account: "" })}
            >
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branch_name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Type"
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v, account: "" })}
            >
              <option value="debtor">Debtor</option>
              <option value="creditor">Creditor</option>
            </SelectField>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span>Party name</span>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span>GSTIN optional</span>
              <Input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
              />
            </label>
            <SelectField
              label={`${form.type === "debtor" ? "Asset" : "Liability"} account`}
              value={form.account}
              onChange={(v) => setForm({ ...form, account: v, createAccount: false })}
            >
              <option value="">Select account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name}
                </option>
              ))}
            </SelectField>
            <div className="flex items-end">
              <Button
                type="button"
                variant={form.createAccount ? "default" : "outline"}
                onClick={() =>
                  setForm({ ...form, createAccount: !form.createAccount, account: "" })
                }
              >
                Create new {form.type} account
              </Button>
            </div>
            {form.createAccount && (
              <label className="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
                <span>New account name (₹0 opening balance)</span>
                <Input
                  value={form.newAccount}
                  onChange={(e) => setForm({ ...form, newAccount: e.target.value })}
                />
              </label>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Create Party"}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function NotesTab({
  noteType,
  branches,
  user,
}: {
  noteType: "debit" | "credit";
  branches: any[];
  user: any;
}) {
  const [rows, setRows] = useState<Note[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branch, setBranch] = useState("all");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    branch: "",
    party: "",
    offsetParty: "",
    offsetAccount: "",
    amount: "",
    date: today(),
    description: "",
  });
  async function load() {
    let q = db
      .from("ltms_accounting_notes")
      .select(
        "*,branch:branches(branch_name),party:ltms_billing_parties!ltms_accounting_notes_party_id_fkey(party_name,party_type)",
      )
      .eq("note_type", noteType)
      .gte("note_date", from)
      .lte("note_date", to)
      .order("note_date", { ascending: false });
    if (user?.role === "basic")
      q = q.in("branch_id", user.branchIds ?? ["00000000-0000-0000-0000-000000000000"]);
    if (branch !== "all") q = q.eq("branch_id", branch);
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Note[]);
  }
  useEffect(() => {
    void load();
  }, [noteType, branch, from, to, status]);
  useEffect(() => {
    void db
      .from("ltms_billing_parties")
      .select("id,branch_id,party_name,gstin,party_type,ledger_account_id")
      .order("party_name")
      .then(({ data, error }: any) => {
        if (error) toast.error(error.message);
        else setParties(data ?? []);
      });
  }, []);
  useEffect(() => {
    if (!form.branch) return;
    void db
      .from("ledger_accounts")
      .select("id,account_name,ledger_type,account_kind,branch_id")
      .eq("branch_id", form.branch)
      .eq("is_active", true)
      .in("ledger_type", ["asset", "liability", "income", "expenditure"])
      .order("account_name")
      .then(({ data, error }: any) => {
        if (error) toast.error(error.message);
        else setAccounts(data ?? []);
      });
  }, [form.branch]);
  const filtered = rows.filter((r) =>
    `${r.note_number} ${r.party?.party_name ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const branchParties = parties.filter((p) => p.branch_id === form.branch);
  const selectedParty = branchParties.find((p) => p.id === form.party);
  const otherParties = branchParties.filter((p) => p.id !== form.party);
  async function createNote() {
    if (!form.branch || !form.party || !form.amount || Number(form.amount) <= 0)
      return toast.error("Branch, party and a positive amount are required");
    if ((!form.offsetParty && !form.offsetAccount) || (form.offsetParty && form.offsetAccount))
      return toast.error("Select either another party or an account");
    setSaving(true);
    const { error } = await db.rpc("create_ltms_accounting_note", {
      p_note_type: noteType,
      p_branch_id: form.branch,
      p_party_id: form.party,
      p_note_date: form.date,
      p_amount: Number(form.amount),
      p_description: form.description.trim() || null,
      p_offset_party_id: form.offsetParty || null,
      p_offset_ledger_id: form.offsetAccount || null,
      p_created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`${noteType === "debit" ? "Debit" : "Credit"} Note created and journal posted`);
      setOpen(false);
      setForm({
        branch: "",
        party: "",
        offsetParty: "",
        offsetAccount: "",
        amount: "",
        date: today(),
        description: "",
      });
      await load();
    }
  }
  async function settle(note: Note, account: string, amount: string, date: string) {
    if (!account || Number(amount) <= 0)
      return toast.error("Select an account and enter a positive amount");
    setSaving(true);
    const { error } = await db.rpc("settle_ltms_accounting_note", {
      p_note_id: note.id,
      p_settlement_ledger_id: account,
      p_amount: Number(amount),
      p_settlement_date: date,
      p_created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(
        noteType === "debit" ? "Debit Note marked paid" : "Credit Note marked received",
      );
      setSettling(null);
      await load();
    }
  }
  async function remove(note: Note) {
    if (
      !window.confirm(
        `Delete ${note.note_number}? The linked journal entries will be deleted first.`,
      )
    )
      return;
    setSaving(true);
    const { error } = await db.rpc("delete_ltms_accounting_note", { p_note_id: note.id });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Note deleted");
      await load();
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-end gap-3">
        <Button
          onClick={() => {
            setForm((f) => ({ ...f, branch: branches[0]?.id ?? "" }));
            setOpen(true);
          }}
        >
          <FilePlus2 className="mr-1 size-4" /> Create {noteType === "debit" ? "Debit" : "Credit"}{" "}
          Note
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <SelectField label="Branch" value={branch} onChange={setBranch}>
          <option value="all">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.branch_name}
            </option>
          ))}
        </SelectField>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          <span>From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          <span>To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <SelectField label="Status" value={status} onChange={setStatus}>
          <option value="all">All</option>
          <option value="open">Not {noteType === "debit" ? "Paid" : "Received"}</option>
          <option value="settled">{noteType === "debit" ? "Paid" : "Received"}</option>
        </SelectField>
        <label className="relative space-y-1 text-xs font-medium text-muted-foreground">
          <span>Search party</span>
          <Search className="absolute left-2 top-7 size-4" />
          <Input
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Party or note no."
          />
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[950px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              {["Note", "Date", "Branch", "Party", "Amount", "Status", "Actions"].map((x) => (
                <th className="px-3 py-3" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr className="border-t border-border" key={r.id}>
                <td className="px-3 py-3 font-medium">
                  {r.note_number}
                  <span className="block text-[11px] text-muted-foreground">
                    {r.journal_entry_id}
                  </span>
                </td>
                <td className="px-3 py-3">{r.note_date}</td>
                <td className="px-3 py-3">{r.branch?.branch_name || "—"}</td>
                <td className="px-3 py-3">{r.party?.party_name || "—"}</td>
                <td className="px-3 py-3">{money(r.amount)}</td>
                <td className="px-3 py-3 capitalize">{r.status}</td>
                <td className="px-3 py-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={r.status === "settled"}
                      onClick={() => setSettling(r)}
                    >
                      <Banknote className="mr-1 size-3.5" />
                      {noteType === "debit" ? "Paid" : "Received"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void remove(r)}>
                      <Trash2 className="mr-1 size-3.5" />
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No notes found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <Dialog
          title={`Create ${noteType === "debit" ? "Debit" : "Credit"} Note`}
          onClose={() => setOpen(false)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Branch"
              value={form.branch}
              onChange={(v) =>
                setForm({ ...form, branch: v, party: "", offsetParty: "", offsetAccount: "" })
              }
            >
              <option value="">Select branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branch_name}
                </option>
              ))}
            </SelectField>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span>Note date</span>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <SelectField
              label="Main party account"
              value={form.party}
              onChange={(v) => setForm({ ...form, party: v, offsetParty: "", offsetAccount: "" })}
            >
              <option value="">Select party</option>
              {branchParties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.party_name || "Unnamed"} · {p.party_type}
                </option>
              ))}
            </SelectField>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              <span>Amount</span>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <SelectField
              label="Offset party (optional)"
              value={form.offsetParty}
              onChange={(v) => setForm({ ...form, offsetParty: v, offsetAccount: "" })}
            >
              <option value="">None</option>
              {otherParties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.party_name || "Unnamed"} · {p.party_type}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Or offset account"
              value={form.offsetAccount}
              onChange={(v) => setForm({ ...form, offsetAccount: v, offsetParty: "" })}
            >
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name} · {a.ledger_type}
                </option>
              ))}
            </SelectField>
            <label className="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2">
              <span>Description</span>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 sm:col-span-2">
              {selectedParty?.party_name || "The selected party"} will be{" "}
              {noteType === "debit" ? "debited" : "credited"}; the offset will be posted on the
              opposite side.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createNote()} disabled={saving}>
              {saving ? "Posting…" : "Create and Post"}
            </Button>
          </div>
        </Dialog>
      )}
      {settling && (
        <SettlementDialog
          note={settling}
          accounts={accounts.filter((a) => ["income", "expenditure"].includes(a.ledger_type))}
          saving={saving}
          onClose={() => setSettling(null)}
          onSubmit={(a, n, d) => void settle(settling, a, n, d)}
        />
      )}
    </div>
  );
}

function SettlementDialog({
  note,
  accounts,
  saving,
  onClose,
  onSubmit,
}: {
  note: Note;
  accounts: Account[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (account: string, amount: string, date: string) => void;
}) {
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState(
    String(Math.max(0, Number(note.amount) - Number(note.settled_amount ?? 0))),
  );
  const [date, setDate] = useState(today());
  return (
    <Dialog
      title={`${note.note_type === "debit" ? "Pay" : "Receive"} ${note.note_number}`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <SelectField
          label="Income / Expenditure settlement account"
          value={account}
          onChange={setAccount}
        >
          <option value="">Select account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.account_name} · {a.ledger_type}
            </option>
          ))}
        </SelectField>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          <span>Amount</span>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          <span>Date</span>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={saving} onClick={() => onSubmit(account, amount, date)}>
          {saving ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </Dialog>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
