import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Download,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AccountsSectionNav } from "@/components/accounts/AccountsSectionNav";
import { useBranches } from "@/lib/use-branches";
import {
  accountSheetRows,
  downloadAccountsTemplate,
  exportAccounts,
  parseAccountRows,
  readAccountWorkbook,
} from "@/lib/accounts-excel";

type AccountKind = "bank" | "cash";
type AccountRow = Record<string, unknown> & { id: string; branch_id: string };

type FormState = {
  branch_id: string;
  account_holder_name: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  bank_branch_name: string;
  account_type: "savings" | "current";
  status: "active" | "inactive";
  opening_date: string;
  opening_balance: string;
  opening_balance_date: string;
  responsible_person: string;
  responsible_person_mobile: string;
  email: string;
  address: string;
  responsible_person_branch: string;
};

const EMPTY: FormState = {
  branch_id: "",
  account_holder_name: "",
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  bank_branch_name: "",
  account_type: "savings",
  status: "active",
  opening_date: "",
  opening_balance: "",
  opening_balance_date: "",
  responsible_person: "",
  responsible_person_mobile: "",
  email: "",
  address: "",
  responsible_person_branch: "",
};

function money(value: unknown) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        required={required}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      <select
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}

export function AccountsMasterPage({ kind }: { kind: AccountKind }) {
  const branches = useBranches();
  // The Supabase generated schema in this repository predates the Accounts tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<(FormState & { id?: string }) | null>(null);
  const isBank = kind === "bank";
  const table = isBank ? "bank_accounts" : "cash_accounts";
  const title = isBank ? "Bank" : "Cash";
  const Icon = isBank ? Landmark : Banknote;
  const branchMap = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.branch_name])),
    [branches],
  );

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await db
        .from(table)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      setRows((data as AccountRow[]) ?? []);
    } catch (error) {
      setRows([]);
      toast.error(
        `Could not load ${title.toLowerCase()} accounts: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  async function importAccounts(file: File) {
    try {
      const workbook = await readAccountWorkbook(file);
      const branchIdByName = new Map(
        branches.map((branch) => [branch.branch_name.trim().toLowerCase(), branch.id]),
      );
      const payload = parseAccountRows(kind, accountSheetRows(workbook, kind), branchIdByName);
      if (payload.length === 0) throw new Error("The account sheet has no data rows.");
      const { error } = await db.from(table).insert(payload);
      if (error) throw new Error(error.message);
      toast.success(
        `${payload.length} ${title.toLowerCase()} account${payload.length === 1 ? "" : "s"} imported`,
      );
      await load();
    } catch (error) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    void load();
    // load is intentionally scoped to the selected table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  function edit(row?: AccountRow) {
    if (!row) {
      setEditing({ ...EMPTY });
      return;
    }
    setEditing({
      ...EMPTY,
      ...(row as unknown as FormState),
      opening_balance: String(row.opening_balance ?? ""),
      id: row.id,
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !editing.branch_id) {
      toast.error("Select a branch first.");
      return;
    }
    setSaving(true);
    const { id, ...form } = editing;
    const payload = isBank
      ? {
          branch_id: form.branch_id,
          account_holder_name: form.account_holder_name.trim(),
          bank_name: form.bank_name.trim(),
          account_number: form.account_number.trim(),
          ifsc_code: form.ifsc_code.trim().toUpperCase(),
          bank_branch_name: form.bank_branch_name.trim(),
          account_type: form.account_type,
          status: form.status,
          opening_date: form.opening_date || null,
          opening_balance: Number(form.opening_balance || 0),
          opening_balance_date: form.opening_balance_date || null,
        }
      : {
          branch_id: form.branch_id,
          responsible_person: form.responsible_person.trim(),
          responsible_person_mobile: form.responsible_person_mobile.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          responsible_person_branch: form.responsible_person_branch.trim(),
          opening_balance: Number(form.opening_balance || 0),
          opening_balance_date: form.opening_balance_date || null,
        };
    const query = id ? db.from(table).update(payload).eq("id", id) : db.from(table).insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${title} account ${id ? "updated" : "created"}`);
    setEditing(null);
    void load();
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete this ${title.toLowerCase()} account?`)) return;
    const { error } = await db.from(table).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${title} account deleted`);
    void load();
  }

  const set = (key: keyof FormState) => (value: string) =>
    setEditing((current) => (current ? { ...current, [key]: value } : current));

  return (
    <AppShell
      variant="ltms"
      shellTitle="Accounts"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <span>/</span>
          <Link to="/accounts" className="hover:text-foreground">
            Accounts
          </Link>
          <span>/</span>
          <span className="text-foreground">Modules</span>
        </span>
      }
    >
      <div className="ltms-reference-shell accounts-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
        <AccountsSectionNav desktop mode="masters" />
        <div className="ltms-reference-content min-w-0">
          <AccountsSectionNav mode="masters" />
          <header className="mb-5 flex flex-wrap justify-end gap-3">
            {!editing && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => downloadAccountsTemplate(kind)}
                  className="gap-2"
                >
                  <FileSpreadsheet className="size-4" />
                  Template
                </Button>
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted">
                  <Upload className="size-4" />
                  Import Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void importAccounts(file);
                    }}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    exportAccounts(kind, rows, branchMap, new Date().toISOString().slice(0, 10))
                  }
                  disabled={rows.length === 0}
                  className="gap-2"
                >
                  <Download className="size-4" />
                  Export Excel
                </Button>
                <Button type="button" onClick={() => edit()} className="gap-2">
                  <Plus className="size-4" />
                  Add {title.toLowerCase()} account
                </Button>
              </div>
            )}
          </header>
          {editing ? (
            <form onSubmit={submit} className="animate-fade-up space-y-5">
              <div className="flex items-center gap-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  <ArrowLeft className="size-4" />
                  Back to list
                </Button>
                <h2 className="text-lg font-semibold">
                  {editing.id
                    ? `Edit ${title.toLowerCase()} account`
                    : `New ${title.toLowerCase()} account`}
                </h2>
              </div>
              <section className="surface-card p-6">
                <h3 className="text-sm font-semibold tracking-tight">Branch link</h3>
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Branch"
                    value={editing.branch_id}
                    onChange={set("branch_id")}
                    required
                  >
                    <option value="">Select branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </SelectField>
                  {isBank ? (
                    <InputField
                      label="Account holder name"
                      value={editing.account_holder_name}
                      onChange={set("account_holder_name")}
                      required
                    />
                  ) : (
                    <InputField
                      label="Responsible person"
                      value={editing.responsible_person}
                      onChange={set("responsible_person")}
                      required
                    />
                  )}
                </div>
              </section>
              {isBank ? (
                <section className="surface-card p-6">
                  <h3 className="text-sm font-semibold tracking-tight">Bank details</h3>
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InputField
                      label="Bank name"
                      value={editing.bank_name}
                      onChange={set("bank_name")}
                      required
                    />
                    <InputField
                      label="Account number"
                      value={editing.account_number}
                      onChange={set("account_number")}
                      required
                    />
                    <InputField
                      label="IFSC code (India)"
                      value={editing.ifsc_code}
                      onChange={set("ifsc_code")}
                      required
                      placeholder="e.g. SBIN0001234"
                    />
                    <InputField
                      label="Branch name"
                      value={editing.bank_branch_name}
                      onChange={set("bank_branch_name")}
                      required
                    />
                    <SelectField
                      label="Account type"
                      value={editing.account_type}
                      onChange={set("account_type")}
                    >
                      <option value="savings">Savings</option>
                      <option value="current">Current</option>
                    </SelectField>
                    <SelectField
                      label="Account status"
                      value={editing.status}
                      onChange={set("status")}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </SelectField>
                    <InputField
                      label="Opening date"
                      type="date"
                      value={editing.opening_date}
                      onChange={set("opening_date")}
                    />
                  </div>
                </section>
              ) : (
                <section className="surface-card p-6">
                  <h3 className="text-sm font-semibold tracking-tight">Cash account details</h3>
                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <InputField
                      label="Responsible person mobile number"
                      value={editing.responsible_person_mobile}
                      onChange={set("responsible_person_mobile")}
                      required
                    />
                    <InputField
                      label="Email"
                      type="email"
                      value={editing.email}
                      onChange={set("email")}
                    />
                    <InputField
                      label="Responsible person branch"
                      value={editing.responsible_person_branch}
                      onChange={set("responsible_person_branch")}
                    />
                    <label className="space-y-1.5 sm:col-span-2">
                      <span className="text-xs font-medium text-muted-foreground">Address</span>
                      <textarea
                        value={editing.address}
                        onChange={(event) => set("address")(event.target.value)}
                        className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                  </div>
                </section>
              )}
              <section className="surface-card p-6">
                <h3 className="text-sm font-semibold tracking-tight">Opening balance</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter the opening balance and the date it was recorded. The application does not
                  assume today.
                </p>
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <InputField
                    label="Opening balance"
                    type="number"
                    value={editing.opening_balance}
                    onChange={set("opening_balance")}
                    required
                  />
                  <InputField
                    label="Opening balance date"
                    type="date"
                    value={editing.opening_balance_date}
                    onChange={set("opening_balance_date")}
                    required
                  />
                </div>
              </section>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving} className="gap-2">
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {saving ? "Saving…" : `Save ${title.toLowerCase()} account`}
                </Button>
              </div>
            </form>
          ) : loading ? (
            <div className="surface-card p-10 text-center text-sm text-muted-foreground">
              Loading {title.toLowerCase()} accounts…
            </div>
          ) : rows.length === 0 ? (
            <div className="surface-card p-10 text-center">
              <Icon className="mx-auto size-10 text-muted-foreground/50" />
              <h2 className="mt-3 text-lg font-semibold">No {title.toLowerCase()} accounts yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create the first branch-linked {title.toLowerCase()} account.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {rows.map((row) => (
                <article key={row.id} className="surface-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold">
                          {isBank
                            ? String(row.bank_name ?? "Bank account")
                            : String(row.responsible_person ?? "Cash account")}
                        </h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Branch: {branchMap.get(row.branch_id) ?? "Unknown branch"}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${String(row.status ?? "active") === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}
                    >
                      {isBank ? String(row.status ?? "active") : "Active"}
                    </span>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Opening balance</p>
                      <p className="mt-1 text-base font-semibold">{money(row.opening_balance)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Opening balance date</p>
                      <p className="mt-1 text-sm font-medium">
                        {String(row.opening_balance_date ?? "Not recorded")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => edit(row)}
                      className="gap-1.5"
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void remove(row.id)}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
