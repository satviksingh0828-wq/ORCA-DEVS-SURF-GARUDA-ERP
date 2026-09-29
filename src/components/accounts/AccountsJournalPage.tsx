import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { AccountsSectionNav, type JournalTab } from "@/components/accounts/AccountsSectionNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";
import { openBrandedTablePdf } from "@/lib/branded-pdf";

// The generated Supabase types predate the Accounts journal tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Ledger = {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: string;
  account_kind: string;
  is_system: boolean;
};
type Line = { ledger_account_id: string; debit: string; credit: string; line_description: string };
type Entry = {
  id: string;
  voucher_number: string;
  entry_date: string;
  branch_id: string;
  description: string | null;
  reference: string | null;
  source_module: string;
  status: string;
  lines?: Array<{
    line_no: number;
    debit: number | string;
    credit: number | string;
    line_description: string | null;
    ledger_account_id: string;
    ledger_account?: { account_name: string; ledger_type: string } | null;
  }>;
};
const blankLine = (): Line => ({
  ledger_account_id: "",
  debit: "",
  credit: "",
  line_description: "",
});
const amount = (value: string | number | null | undefined) => Number(value ?? 0) || 0;
const pdfAmount = (value: string | number | null | undefined) =>
  `Rs. ${amount(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function JournalPage() {
  const branches = useBranches();
  const [tab, setTab] = useState<JournalTab>("create");
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [branchId, setBranchId] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const [transferSourceBranch, setTransferSourceBranch] = useState("");
  const [transferDestinationBranch, setTransferDestinationBranch] = useState("");
  const [transferSourceAccount, setTransferSourceAccount] = useState("");
  const [transferDestinationAccount, setTransferDestinationAccount] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [transferDescription, setTransferDescription] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [transferSaving, setTransferSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const branchMap = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.branch_name])),
    [branches],
  );
  const availableLedgers = useMemo(
    () => ledgers.filter((ledger) => !branchId || ledger.branch_id === branchId),
    [ledgers, branchId],
  );
  const totalDebit = lines.reduce((sum, line) => sum + amount(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + amount(line.credit), 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
  const filteredEntries = entries.filter((entry) => {
    const matchBranch = filterBranch === "all" || entry.branch_id === filterBranch;
    const matchMonth = !filterMonth || entry.entry_date.startsWith(filterMonth);
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      entry.voucher_number.toLowerCase().includes(q) ||
      (entry.description ?? "").toLowerCase().includes(q);
    return matchBranch && matchMonth && matchSearch;
  });

  async function loadLedgers() {
    const { data, error } = await db
      .from("ledger_accounts")
      .select("id,branch_id,account_name,ledger_type,account_kind,is_system")
      .eq("is_active", true)
      .order("account_name");
    if (error) toast.error(`Could not load accounts: ${error.message}`);
    else setLedgers((data as Ledger[]) ?? []);
  }

  async function loadEntries() {
    setLoading(true);
    try {
      const { data, error } = await db
        .from("journal_entries")
        .select(
          "id,voucher_number,entry_date,branch_id,description,reference,source_module,status,lines:journal_lines(line_no,debit,credit,line_description,ledger_account_id,ledger_account:ledger_accounts(account_name,ledger_type))",
        )
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      setEntries((data as Entry[]) ?? []);
    } catch (error) {
      toast.error(
        `Could not load journal entries: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(entry: Entry) {
    if (entry.source_module !== "manual") {
      toast.error("Automatic and transfer entries must be removed from their source transaction.");
      return;
    }
    const confirmed = window.confirm(
      `Delete journal entry ${entry.voucher_number}? This will permanently delete its journal lines.`,
    );
    if (!confirmed) return;
    setDeletingId(entry.id);
    try {
      const { error } = await db.rpc("delete_manual_journal_entry", { p_entry_id: entry.id });
      if (error) {
        const message = String(error.message ?? error);
        if (!message.toLowerCase().includes("schema cache")) throw new Error(message);

        // Older deployments may have the migration file but not the refreshed RPC
        // in PostgREST's schema cache. The source-module filter keeps this fallback
        // limited to manual entries; deleting the parent cascades to journal_lines,
        // so the ledger no longer includes the deleted debit/credit lines.
        const { error: fallbackError } = await db
          .from("journal_entries")
          .delete()
          .eq("id", entry.id)
          .eq("source_module", "manual");
        if (fallbackError) throw new Error(fallbackError.message);
      }
      toast.success(`Journal entry ${entry.voucher_number} deleted.`);
      await loadEntries();
    } catch (error) {
      toast.error(
        `Could not delete journal entry: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void loadLedgers();
    void loadEntries();
  }, []);
  useEffect(() => {
    if (!branchId && branches[0]) setBranchId(branches[0].id);
  }, [branches, branchId]);

  function updateLine(index: number, key: keyof Line, value: string) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              [key]: value,
              ...(key === "debit" && value ? { credit: "" } : {}),
              ...(key === "credit" && value ? { debit: "" } : {}),
            }
          : line,
      ),
    );
  }

  async function createEntry(event: React.FormEvent) {
    event.preventDefault();
    if (
      !branchId ||
      lines.some(
        (line) =>
          !line.ledger_account_id || (amount(line.debit) === 0 && amount(line.credit) === 0),
      )
    )
      return toast.error("Branch, account, and amounts are required.");
    if (Math.abs(difference) > 0.005 || totalDebit <= 0)
      return toast.error("Journal must have equal debit and credit totals greater than zero.");
    setSaving(true);
    try {
      const { error } = await db.rpc("post_manual_journal", {
        p_payload: {
          branch_id: branchId,
          entry_date: entryDate,
          description: description.trim() || null,
          reference: reference.trim() || null,
          lines: lines.map((line) => ({
            ...line,
            debit: amount(line.debit),
            credit: amount(line.credit),
          })),
        },
      });
      if (error) throw new Error(error.message);
      toast.success("Journal entry posted.");
      setDescription("");
      setReference("");
      setLines([blankLine(), blankLine()]);
      await loadEntries();
      setTab("list");
    } catch (error) {
      toast.error(
        `Could not post journal: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  const bankCashLedgers = useMemo(
    () =>
      ledgers.filter((ledger) => ledger.ledger_type === "bank" || ledger.ledger_type === "cash"),
    [ledgers],
  );

  async function createTransfer(event: React.FormEvent) {
    event.preventDefault();
    const numericAmount = amount(transferAmount);
    if (
      !transferSourceBranch ||
      !transferDestinationBranch ||
      !transferSourceAccount ||
      !transferDestinationAccount ||
      numericAmount <= 0
    ) {
      toast.error("Select both branches, a bank/cash account on each side, and a positive amount.");
      return;
    }
    const sourceLedger = ledgers.find((ledger) => ledger.id === transferSourceAccount);
    const destinationLedger = ledgers.find((ledger) => ledger.id === transferDestinationAccount);
    if (
      sourceLedger?.branch_id !== transferSourceBranch ||
      destinationLedger?.branch_id !== transferDestinationBranch
    ) {
      toast.error("Each transfer account must belong to its selected branch.");
      return;
    }
    setTransferSaving(true);
    try {
      const { error } = await db.rpc("post_bank_cash_transfer", {
        p_payload: {
          entry_date: transferDate,
          source_branch_id: transferSourceBranch,
          destination_branch_id: transferDestinationBranch,
          source_account_id: transferSourceAccount,
          destination_account_id: transferDestinationAccount,
          amount: numericAmount,
          description: transferDescription.trim() || null,
          reference: transferReference.trim() || null,
        },
      });
      if (error) throw new Error(error.message);
      toast.success(
        transferSourceBranch === transferDestinationBranch
          ? "Bank / cash transfer posted."
          : "Inter-branch transfer posted in both branch books.",
      );
      setTransferAmount("");
      setTransferDescription("");
      setTransferReference("");
      await loadEntries();
      setTab("list");
    } catch (error) {
      toast.error(
        `Could not post transfer: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTransferSaving(false);
    }
  }

  function downloadTemplate() {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          "Import Key": "JV-001",
          Branch: branchMap.get(branchId) ?? "",
          "Entry Date": entryDate,
          Description: "Example journal",
          Reference: "",
        },
      ]),
      "Journal Entries",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          "Import Key": "JV-001",
          "Line No": 1,
          Account: "Capital - Branch",
          Debit: 0,
          Credit: 1000,
          "Line Description": "Example",
        },
        {
          "Import Key": "JV-001",
          "Line No": 2,
          Account: "Opening Balance Equity - Branch",
          Debit: 1000,
          Credit: 0,
          "Line Description": "Example offset",
        },
      ]),
      "Journal Lines",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Instructions"],
        [
          "Each Import Key must balance. Account names must match active accounts in the selected branch.",
        ],
      ]),
      "Instructions",
    );
    XLSX.writeFile(workbook, "journal-import-template.xlsx");
  }

  async function importWorkbook(file: File) {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const headers = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets["Journal Entries"],
        { defval: "" },
      );
      const rawLines = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets["Journal Lines"],
        { defval: "" },
      );
      if (!headers.length || !rawLines.length)
        throw new Error("Both Journal Entries and Journal Lines sheets are required.");
      const branchIds = new Map(
        branches.map((branch) => [branch.branch_name.trim().toLowerCase(), branch.id]),
      );
      for (const header of headers) {
        const key = String(header["Import Key"] ?? "");
        const id = branchIds.get(
          String(header.Branch ?? "")
            .trim()
            .toLowerCase(),
        );
        const entryLines = rawLines.filter((line) => String(line["Import Key"] ?? "") === key);
        if (!id || entryLines.length < 2) throw new Error(`Invalid import group ${key}.`);
        const accountMap = new Map(
          ledgers
            .filter((ledger) => ledger.branch_id === id)
            .map((ledger) => [ledger.account_name.trim().toLowerCase(), ledger.id]),
        );
        const payloadLines = entryLines.map((line) => ({
          ledger_account_id: accountMap.get(
            String(line.Account ?? "")
              .trim()
              .toLowerCase(),
          ),
          debit: amount(line.Debit),
          credit: amount(line.Credit),
          line_description: String(line["Line Description"] ?? ""),
        }));
        if (payloadLines.some((line) => !line.ledger_account_id))
          throw new Error(`Account was not found for import group ${key}.`);
        const { error } = await db.rpc("post_manual_journal", {
          p_payload: {
            branch_id: id,
            entry_date: String(header["Entry Date"] ?? entryDate).slice(0, 10),
            description: String(header.Description ?? "").trim(),
            reference: String(header.Reference ?? "").trim() || null,
            lines: payloadLines,
          },
        });
        if (error) throw new Error(`Import group ${key}: ${error.message}`);
      }
      toast.success(
        `${headers.length} journal entr${headers.length === 1 ? "y" : "ies"} imported.`,
      );
      await loadEntries();
    } catch (error) {
      toast.error(
        `Journal import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function exportEntries() {
    const rows = filteredEntries.flatMap((entry) =>
      (entry.lines ?? []).map((line) => ({
        Voucher: entry.voucher_number,
        Date: entry.entry_date,
        Branch: branchMap.get(entry.branch_id) ?? "",
        Description: entry.description,
        Source: entry.source_module,
        Account: line.ledger_account?.account_name ?? "",
        Type: line.ledger_account?.ledger_type ?? "",
        Debit: amount(line.debit),
        Credit: amount(line.credit),
        "Line Description": line.line_description ?? "",
      })),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Journal");
    XLSX.writeFile(workbook, `journal-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function exportPdf(entry: Entry) {
    const rows = (entry.lines ?? []).map((line) => [
      entry.voucher_number,
      entry.entry_date,
      branchMap.get(entry.branch_id) ?? "—",
      entry.description ?? "—",
      entry.source_module,
      line.ledger_account?.account_name ?? "—",
      line.ledger_account?.ledger_type ?? "—",
      line.line_description ?? "—",
      amount(line.debit) ? pdfAmount(line.debit) : "—",
      amount(line.credit) ? pdfAmount(line.credit) : "—",
    ]);
    await openBrandedTablePdf({
      title: `Journal Voucher ${entry.voucher_number}`,
      subtitle: `${branchMap.get(entry.branch_id) ?? "Branch"} · ${entry.entry_date} · ${entry.description}`,
      filename: `${entry.voucher_number}.pdf`,
      orientation: "landscape",
      columns: [
        "Voucher",
        "Date",
        "Branch",
        "Description",
        "Source",
        "Account",
        "Type",
        "Line Description",
        "Debit",
        "Credit",
      ],
      rows,
      summary: [
        ["Total debit", pdfAmount(totalFor(entry, "debit"))],
        ["Total credit", pdfAmount(totalFor(entry, "credit"))],
        ["Source", entry.source_module === "auto" ? "Automatic opening balance" : "Manual journal"],
      ],
    });
  }

  return (
    <AppShell
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home">Workspace</Link>
          <span>/</span>
          <Link to="/accounts">Accounts</Link>
          <span>/</span>
          <span className="text-foreground">Journal</span>
        </span>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <AccountsSectionNav desktop mode="journal" journalTab={tab} onJournalTabChange={setTab} />
        <div className="min-w-0 lg:col-start-2">
          <AccountsSectionNav mode="journal" journalTab={tab} onJournalTabChange={setTab} />
          <header className="mb-6">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
              Accounts / Journal
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Journal workspace</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Post and review balanced double-entry vouchers for every branch.
            </p>
          </header>
          {tab === "create" && (
            <form onSubmit={createEntry} className="animate-fade-up space-y-5">
              <section className="surface-card p-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Branch *</span>
                    <select
                      value={branchId}
                      onChange={(event) => {
                        setBranchId(event.target.value);
                        setLines((current) => current.map(() => blankLine()));
                      }}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Entry date *</span>
                    <Input
                      type="date"
                      value={entryDate}
                      onChange={(event) => setEntryDate(event.target.value)}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Reference</span>
                    <Input
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="Optional reference"
                    />
                  </label>
                  <label className="space-y-1.5 sm:col-span-3">
                    <span className="text-xs font-medium text-muted-foreground">Description</span>
                    <Input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Describe the business transaction"
                    />
                  </label>
                </div>
              </section>
              <section className="surface-card overflow-hidden p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">Journal lines</h2>
                    <p className="text-xs text-muted-foreground">
                      Select multiple accounts and keep total debit equal to total credit.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLines((current) => [...current, blankLine()])}
                    className="gap-2"
                  >
                    <Plus className="size-4" />
                    Add line
                  </Button>
                </div>
                <div className="space-y-3">
                  {lines.map((line, index) => (
                    <div key={index} className="grid gap-2 md:grid-cols-[1.5fr_1fr_1fr_1.2fr_auto]">
                      <select
                        value={line.ledger_account_id}
                        onChange={(event) =>
                          updateLine(index, "ledger_account_id", event.target.value)
                        }
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">Select account</option>
                        {availableLedgers.map((ledger) => (
                          <option key={ledger.id} value={ledger.id}>
                            {ledger.account_name} · {ledger.ledger_type}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Debit"
                        value={line.debit}
                        onChange={(event) => updateLine(index, "debit", event.target.value)}
                      />
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Credit"
                        value={line.credit}
                        onChange={(event) => updateLine(index, "credit", event.target.value)}
                      />
                      <Input
                        placeholder="Line description"
                        value={line.line_description}
                        onChange={(event) =>
                          updateLine(index, "line_description", event.target.value)
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setLines((current) =>
                            current.length > 2
                              ? current.filter((_, lineIndex) => lineIndex !== index)
                              : current,
                          )
                        }
                        aria-label="Remove line"
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
                <div
                  className={`mt-5 grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-3 ${Math.abs(difference) < 0.005 && totalDebit > 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}
                >
                  <div>
                    <span className="text-muted-foreground">Total debit</span>
                    <strong className="ml-2">₹{totalDebit.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total credit</span>
                    <strong className="ml-2">₹{totalCredit.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Difference</span>
                    <strong className="ml-2">₹{difference.toFixed(2)}</strong>
                  </div>
                </div>
              </section>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saving || Math.abs(difference) > 0.005 || totalDebit <= 0}
                  className="gap-2"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileDown className="size-4" />
                  )}
                  {saving ? "Posting…" : "Post journal entry"}
                </Button>
              </div>
            </form>
          )}
          {tab === "transfer" && (
            <form onSubmit={createTransfer} className="animate-fade-up space-y-5">
              <section className="surface-card p-6">
                <div className="mb-5">
                  <h2 className="font-semibold">Bank / cash transfer</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use the same form for bank-to-bank, cash-to-bank, bank-to-cash, and cash-to-cash
                    movements. Different branches receive separate balanced entries in their own
                    books.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">From branch *</span>
                    <select
                      required
                      value={transferSourceBranch}
                      onChange={(event) => {
                        setTransferSourceBranch(event.target.value);
                        setTransferSourceAccount("");
                      }}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select source branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">To branch *</span>
                    <select
                      required
                      value={transferDestinationBranch}
                      onChange={(event) => {
                        setTransferDestinationBranch(event.target.value);
                        setTransferDestinationAccount("");
                      }}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select destination branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      From bank / cash *
                    </span>
                    <select
                      required
                      value={transferSourceAccount}
                      onChange={(event) => setTransferSourceAccount(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select source account</option>
                      {bankCashLedgers
                        .filter((ledger) => ledger.branch_id === transferSourceBranch)
                        .map((ledger) => (
                          <option key={ledger.id} value={ledger.id}>
                            {ledger.account_name} · {ledger.ledger_type}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      To bank / cash *
                    </span>
                    <select
                      required
                      value={transferDestinationAccount}
                      onChange={(event) => setTransferDestinationAccount(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select destination account</option>
                      {bankCashLedgers
                        .filter((ledger) => ledger.branch_id === transferDestinationBranch)
                        .map((ledger) => (
                          <option key={ledger.id} value={ledger.id}>
                            {ledger.account_name} · {ledger.ledger_type}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Amount *</span>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={transferAmount}
                      onChange={(event) => setTransferAmount(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Transfer date *
                    </span>
                    <Input
                      type="date"
                      required
                      value={transferDate}
                      onChange={(event) => setTransferDate(event.target.value)}
                    />
                  </label>
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">Description</span>
                    <Input
                      value={transferDescription}
                      onChange={(event) => setTransferDescription(event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">Reference</span>
                    <Input
                      value={transferReference}
                      onChange={(event) => setTransferReference(event.target.value)}
                      placeholder="Optional voucher or bank reference"
                    />
                  </label>
                </div>
              </section>
              <section className="surface-card p-5 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Posting rule</p>
                <p className="mt-1">
                  Same branch: destination bank/cash is debited and source bank/cash is credited.
                </p>
                <p>
                  Different branches: the sender posts Branch A/c Dr / source bank-cash Cr, while
                  the receiver posts destination bank-cash Dr / sender Branch A/c Cr.
                </p>
              </section>
              <div className="flex justify-end">
                <Button type="submit" disabled={transferSaving} className="gap-2">
                  {transferSaving && <Loader2 className="size-4 animate-spin" />}
                  {transferSaving ? "Posting…" : "Post transfer"}
                </Button>
              </div>
            </form>
          )}
          {tab === "list" && (
            <div className="space-y-5 animate-fade-up">
              <section className="surface-card p-5">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-44 flex-1 space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Branch</span>
                    <select
                      value={filterBranch}
                      onChange={(event) => setFilterBranch(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="all">All branches</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-40 space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Month</span>
                    <Input
                      type="month"
                      value={filterMonth}
                      onChange={(event) => setFilterMonth(event.target.value)}
                    />
                  </label>
                  <label className="min-w-56 flex-1 space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Search</span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Voucher or description"
                      />
                    </div>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={downloadTemplate}
                      className="gap-2"
                    >
                      <FileSpreadsheet className="size-4" />
                      Template
                    </Button>
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted">
                      <Upload className="size-4" />
                      Import
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void importWorkbook(file);
                        }}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={exportEntries}
                      disabled={!filteredEntries.length}
                      className="gap-2"
                    >
                      <Download className="size-4" />
                      Export
                    </Button>
                  </div>
                </div>
              </section>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {filteredEntries.length} journal entr{filteredEntries.length === 1 ? "y" : "ies"}
                </p>
                <Button type="button" onClick={() => setTab("create")} className="gap-2">
                  <Plus className="size-4" />
                  Create entry
                </Button>
              </div>
              <section className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3">Voucher</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Branch</th>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Source</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {loading ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center">
                            <Loader2 className="mx-auto size-5 animate-spin" />
                          </td>
                        </tr>
                      ) : filteredEntries.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-muted-foreground">
                            No journal entries match the selected filters.
                          </td>
                        </tr>
                      ) : (
                        filteredEntries.map((entry) => {
                          const expanded = expandedEntryId === entry.id;
                          return (
                            <Fragment key={entry.id}>
                              <tr className="hover:bg-muted/30">
                                <td className="px-4 py-3 font-semibold">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 text-left hover:text-primary"
                                    onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
                                    aria-expanded={expanded}
                                    aria-label={`${expanded ? "Hide" : "Show"} lines for ${entry.voucher_number}`}
                                  >
                                    {expanded ? (
                                      <ChevronDown className="size-4" />
                                    ) : (
                                      <ChevronRight className="size-4" />
                                    )}
                                    {entry.voucher_number}
                                  </button>
                                </td>
                                <td className="px-4 py-3">{entry.entry_date}</td>
                                <td className="px-4 py-3">
                                  {branchMap.get(entry.branch_id) ?? "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <p>{entry.description || "—"}</p>
                                  {entry.reference && (
                                    <p className="text-xs text-muted-foreground">
                                      Ref: {entry.reference}
                                    </p>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold">
                                    {entry.source_module === "auto"
                                      ? "Automatic opening"
                                      : "Manual"}
                                  </span>
                                </td>
                                <td className="flex gap-2 px-4 py-3">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
                                  >
                                    {expanded ? "Hide lines" : "View lines"}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void exportPdf(entry)}
                                  >
                                    PDF
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1.5 text-destructive hover:text-destructive"
                                    disabled={
                                      entry.source_module !== "manual" || deletingId === entry.id
                                    }
                                    title={
                                      entry.source_module === "manual"
                                        ? "Delete journal entry"
                                        : "Automatic entries must be removed from their source transaction"
                                    }
                                    onClick={() => void deleteEntry(entry)}
                                  >
                                    {deletingId === entry.id ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="size-3.5" />
                                    )}
                                    Delete
                                  </Button>
                                </td>
                              </tr>
                              {expanded && (
                                <tr key={`${entry.id}-details`} className="bg-muted/20">
                                  <td colSpan={6} className="px-6 py-4">
                                    <div className="rounded-xl border border-border bg-background p-4">
                                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                          <h3 className="font-semibold">Journal lines</h3>
                                          <p className="text-xs text-muted-foreground">
                                            {entry.lines?.length ?? 0} line
                                            {entry.lines?.length === 1 ? "" : "s"} · Status:{" "}
                                            {entry.status}
                                          </p>
                                        </div>
                                        <div className="flex gap-4 text-sm">
                                          <span>
                                            Debit:{" "}
                                            <strong>
                                              ₹
                                              {totalFor(entry, "debit").toLocaleString("en-IN", {
                                                minimumFractionDigits: 2,
                                              })}
                                            </strong>
                                          </span>
                                          <span>
                                            Credit:{" "}
                                            <strong>
                                              ₹
                                              {totalFor(entry, "credit").toLocaleString("en-IN", {
                                                minimumFractionDigits: 2,
                                              })}
                                            </strong>
                                          </span>
                                        </div>
                                      </div>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                          <thead>
                                            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                                              <th className="px-3 py-2">#</th>
                                              <th className="px-3 py-2">Account</th>
                                              <th className="px-3 py-2">Description</th>
                                              <th className="px-3 py-2 text-right">Debit</th>
                                              <th className="px-3 py-2 text-right">Credit</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-border">
                                            {(entry.lines ?? []).map((line) => (
                                              <tr key={`${entry.id}-${line.line_no}`}>
                                                <td className="px-3 py-2 text-muted-foreground">
                                                  {line.line_no}
                                                </td>
                                                <td className="px-3 py-2 font-medium">
                                                  {line.ledger_account?.account_name ??
                                                    "Unknown account"}
                                                  <span className="ml-2 text-xs text-muted-foreground">
                                                    {line.ledger_account?.ledger_type ?? ""}
                                                  </span>
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground">
                                                  {line.line_description || "—"}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">
                                                  {amount(line.debit)
                                                    ? `₹${amount(line.debit).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                                                    : "—"}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">
                                                  {amount(line.credit)
                                                    ? `₹${amount(line.credit).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                                                    : "—"}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function totalFor(entry: Entry, side: "debit" | "credit") {
  return (entry.lines ?? []).reduce((sum, line) => sum + amount(line[side]), 0);
}

export function AccountsJournalRoute() {
  return (
    <AccountsAccessGuard>
      <JournalPage />
    </AccountsAccessGuard>
  );
}
