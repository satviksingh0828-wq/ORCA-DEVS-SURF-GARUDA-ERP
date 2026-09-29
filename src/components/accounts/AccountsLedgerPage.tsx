import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Download,
  FileDown,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Plus,
  Save,
  Scale,
  Search,
  Upload,
  WalletCards,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { AccountsSectionNav } from "@/components/accounts/AccountsSectionNav";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useBranches, type BranchOption } from "@/lib/use-branches";
import { openBrandedTablePdf } from "@/lib/branded-pdf";

// The committed Supabase schema predates the ledger tables. Keep the feature
// compatible with the live SQL migration while the generated types catch up.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type LedgerTab = "capital" | "create" | "list" | "view";
type LedgerType = "asset" | "liability" | "income" | "expenditure" | "capital" | "bank" | "cash";
type OpeningSide = "dr" | "cr";

type LedgerRow = {
  id: string;
  branch_id: string;
  account_name: string;
  description: string | null;
  ledger_type: LedgerType;
  account_kind: "ledger" | "bank" | "cash";
  opening_balance: number | string | null;
  opening_balance_date: string | null;
  opening_balance_side: OpeningSide;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
};

type JournalLine = {
  id: string;
  debit: number | string | null;
  credit: number | string | null;
  line_description: string | null;
  journal_entry?: {
    id: string;
    voucher_number: string;
    entry_date: string;
    description: string;
    reference: string | null;
    status: string;
  } | null;
};

type TrialBalanceRow = {
  branch_id: string;
  ledger_account_id: string;
  account_name: string;
  ledger_type: LedgerType;
  debit: number;
  credit: number;
};

type FormState = {
  branch_id: string;
  ledger_type: "asset" | "liability" | "income" | "expenditure";
  description: string;
  opening_balance: string;
  opening_balance_date: string;
  opening_balance_side: OpeningSide;
};

const EMPTY_FORM: FormState = {
  branch_id: "",
  ledger_type: "asset",
  description: "",
  opening_balance: "0",
  opening_balance_date: "",
  opening_balance_side: "dr",
};

const today = new Date().toISOString().slice(0, 10);
const firstDayOfYear = `${new Date().getFullYear()}-01-01`;
const money = (value: unknown) => Number(value ?? 0) || 0;
const moneyText = (value: number) =>
  `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pdfMoneyText = (value: number) =>
  `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (value: string | null | undefined) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN") : "—";

function labelForType(type: LedgerType) {
  return type === "bank"
    ? "Bank"
    : type === "cash"
      ? "Cash"
      : type === "capital"
        ? "Capital"
        : type[0].toUpperCase() + type.slice(1);
}

function balanceSide(value: number): OpeningSide {
  return value < 0 ? "cr" : "dr";
}

function makeSheet(rows: Record<string, unknown>[], headers: string[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  sheet["!cols"] = headers.map((header) => ({ wch: Math.max(header.length + 3, 18) }));
  return sheet;
}

function downloadLedgerTemplate() {
  const headers = ["Branch", "Description"];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet([], headers), "Ledgers");
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      [
        {
          Branch: "Main Branch",
          Description: "Freight Revenue",
        },
      ],
      headers,
    ),
    "Example",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      [
        { Field: "Branch", Guidance: "Must exactly match an existing branch name." },
        { Field: "Description", Guidance: "Unique ledger name within the selected branch." },
        {
          Field: "Opening balance",
          Guidance:
            "Income and expenditure ledgers do not have opening balances. Use the Capital tab for branch opening balances.",
        },
      ],
      ["Field", "Guidance"],
    ),
    "Instructions",
  );
  XLSX.writeFile(workbook, "ledger-import-template.xlsx");
}

function parseNumber(value: unknown) {
  const number = Number(String(value ?? "0").replace(/[,₹\s]/g, ""));
  return Number.isFinite(number) ? number : 0;
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

function LedgerTypeBadge({ type }: { type: LedgerType }) {
  const system = type === "bank" || type === "cash";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${system ? "bg-sky-500/10 text-sky-700" : "bg-primary/10 text-primary"}`}
    >
      {labelForType(type)}
      {system ? " · Auto" : ""}
    </span>
  );
}

export function AccountsLedgerPage() {
  const branches = useBranches();
  const branchById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch])),
    [branches],
  );
  const [tab, setTab] = useState<LedgerTab>("create");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listBranch, setListBranch] = useState("all");
  const [listType, setListType] = useState("all");
  const [listSearch, setListSearch] = useState("");
  const [viewBranch, setViewBranch] = useState("");
  const [viewLedgerId, setViewLedgerId] = useState("");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [viewStart, setViewStart] = useState(firstDayOfYear);
  const [viewEnd, setViewEnd] = useState(today);
  const [viewRows, setViewRows] = useState<JournalLine[]>([]);
  const [viewOpeningNet, setViewOpeningNet] = useState(0);
  const [viewLoading, setViewLoading] = useState(false);
  const [capitalBranch, setCapitalBranch] = useState("");
  const [capitalOpening, setCapitalOpening] = useState("0");
  const [capitalDate, setCapitalDate] = useState(today);
  const [capitalSide, setCapitalSide] = useState<OpeningSide>("cr");

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function loadLedgers() {
    setLoading(true);
    try {
      const { data, error } = await db
        .from("ledger_accounts")
        .select(
          "id,branch_id,account_name,description,ledger_type,account_kind,opening_balance,opening_balance_date,opening_balance_side,is_system,is_active,created_at",
        )
        .eq("is_active", true)
        .order("account_name", { ascending: true });
      if (error) throw new Error(error.message);
      setLedgers((data as LedgerRow[]) ?? []);
    } catch (error) {
      toast.error(
        `Could not load ledgers: ${error instanceof Error ? error.message : String(error)}`,
      );
      setLedgers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLedgers();
  }, []);

  useEffect(() => {
    if (!viewBranch && branches[0]) setViewBranch(branches[0].id);
    if (!capitalBranch && branches[0]) setCapitalBranch(branches[0].id);
  }, [branches, viewBranch, capitalBranch]);

  const filteredList = useMemo(() => {
    const search = listSearch.trim().toLowerCase();
    return ledgers.filter((ledger) => {
      const matchesBranch = listBranch === "all" || ledger.branch_id === listBranch;
      const matchesType = listType === "all" || ledger.ledger_type === listType;
      const matchesSearch =
        !search ||
        ledger.account_name.toLowerCase().includes(search) ||
        String(ledger.description ?? "")
          .toLowerCase()
          .includes(search);
      return matchesBranch && matchesType && matchesSearch;
    });
  }, [ledgers, listBranch, listSearch, listType]);

  const viewLedgers = useMemo(
    () =>
      ledgers.filter(
        (ledger) =>
          (!viewBranch || ledger.branch_id === viewBranch) &&
          (!ledgerSearch.trim() ||
            ledger.account_name.toLowerCase().includes(ledgerSearch.trim().toLowerCase())),
      ),
    [ledgers, ledgerSearch, viewBranch],
  );
  const selectedLedger = ledgers.find((ledger) => ledger.id === viewLedgerId) ?? null;

  async function createLedger(event: React.FormEvent) {
    event.preventDefault();
    if (!form.branch_id || !form.description.trim()) {
      toast.error("Select a branch and complete the ledger description.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await db.rpc("create_manual_ledger", {
        p_branch_id: form.branch_id,
        p_ledger_type: form.ledger_type,
        p_description: form.description.trim(),
        p_opening_balance: Number(form.opening_balance || 0),
        p_opening_balance_date:
          form.ledger_type === "asset" || form.ledger_type === "liability"
            ? form.opening_balance_date || null
            : null,
        p_opening_balance_side: form.opening_balance_side,
      });
      if (error) throw new Error(error.message);
      toast.success(`${labelForType(form.ledger_type)} ledger created.`);
      setForm(EMPTY_FORM);
      await loadLedgers();
      setTab("list");
    } catch (error) {
      toast.error(
        `Could not create ledger: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveCapitalOpening(event: React.FormEvent) {
    event.preventDefault();
    const amount = parseNumber(capitalOpening);
    if (!capitalBranch || amount < 0 || (amount > 0 && !capitalDate)) {
      toast.error("Select a branch and provide a valid capital opening balance and date.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await db.rpc("set_capital_opening_balance", {
        p_branch_id: capitalBranch,
        p_opening_balance: amount,
        p_opening_balance_date: amount > 0 ? capitalDate : null,
        p_opening_balance_side: capitalSide,
      });
      if (error) throw new Error(error.message);
      toast.success("Capital opening balance saved with a balanced journal entry.");
      await loadLedgers();
      setTab("list");
    } catch (error) {
      toast.error(
        `Could not save capital opening balance: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function importLedgers(file: File) {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets.Ledgers ?? workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("The workbook does not contain a ledger sheet.");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!rows.length) throw new Error("The ledger sheet has no data rows.");
      const branchIds = new Map(
        branches.map((branch) => [branch.branch_name.trim().toLowerCase(), branch.id]),
      );
      let imported = 0;
      for (const [index, row] of rows.entries()) {
        const rowNumber = index + 2;
        const branchId = branchIds.get(
          String(row.Branch ?? "")
            .trim()
            .toLowerCase(),
        );
        const description = String(row.Description ?? "").trim();
        if (!branchId) throw new Error(`Branch was not found on row ${rowNumber}.`);
        if (!description) throw new Error(`Description is required on row ${rowNumber}.`);
        const { error } = await db.rpc("create_revenue_ledger", {
          p_branch_id: branchId,
          p_description: description,
        });
        if (error) throw new Error(`Row ${rowNumber}: ${error.message}`);
        imported += 1;
      }
      toast.success(`${imported} ledger${imported === 1 ? "" : "s"} imported.`);
      await loadLedgers();
    } catch (error) {
      toast.error(
        `Ledger import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function exportList() {
    const rows = filteredList.map((ledger) => ({
      Branch: branchById.get(ledger.branch_id)?.branch_name ?? "—",
      Ledger: ledger.account_name,
      Description: ledger.description ?? "",
      Type: labelForType(ledger.ledger_type),
      "Opening Balance": money(ledger.opening_balance),
      Side: ledger.opening_balance_side.toUpperCase(),
      "Opening Date": ledger.opening_balance_date ?? "",
      Source: ledger.is_system ? "Automatic bank/cash ledger" : "Manual ledger",
      Status: ledger.is_active ? "Active" : "Inactive",
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Ledgers");
    XLSX.writeFile(workbook, `ledgers-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function loadView() {
    if (!viewLedgerId || !viewStart || !viewEnd) {
      toast.error("Select a branch, ledger, and complete date range.");
      return;
    }
    if (viewStart > viewEnd) {
      toast.error("Start date must be before end date.");
      return;
    }
    setViewLoading(true);
    try {
      const { data, error } = await db
        .from("journal_lines")
        .select(
          "id,debit,credit,line_description,journal_entry:journal_entries!inner(id,voucher_number,entry_date,description,reference,status)",
        )
        .eq("ledger_account_id", viewLedgerId)
        .lte("journal_entry.entry_date", viewEnd)
        .order("entry_date", { foreignTable: "journal_entries", ascending: true })
        .order("line_no", { ascending: true });
      if (error) throw new Error(error.message);
      const all = (data as JournalLine[]) ?? [];
      const before = all.filter((line) => String(line.journal_entry?.entry_date ?? "") < viewStart);
      const period = all.filter((line) => {
        const date = String(line.journal_entry?.entry_date ?? "");
        return date >= viewStart && date <= viewEnd;
      });
      const hasOpeningEntry = all.some((line) =>
        String(line.journal_entry?.reference ?? "").startsWith("ledger_opening:"),
      );
      const openingNet = before.length
        ? before.reduce((sum, line) => sum + money(line.debit) - money(line.credit), 0)
        : !hasOpeningEntry &&
            selectedLedger &&
            (selectedLedger.opening_balance_date ?? "") < viewStart
          ? (selectedLedger.opening_balance_side === "cr" ? -1 : 1) *
            money(selectedLedger.opening_balance)
          : 0;
      setViewOpeningNet(openingNet);
      setViewRows(period);
      toast.success("Ledger refreshed.");
    } catch (error) {
      toast.error(
        `Could not load ledger: ${error instanceof Error ? error.message : String(error)}`,
      );
      setViewRows([]);
    } finally {
      setViewLoading(false);
    }
  }

  async function getPeriodReport() {
    if (!viewLedgerId || !viewStart || !viewEnd) return null;
    const { data, error } = await db
      .from("journal_lines")
      .select(
        "id,debit,credit,line_description,journal_entry:journal_entries!inner(id,voucher_number,entry_date,description,reference,status)",
      )
      .eq("ledger_account_id", viewLedgerId)
      .lte("journal_entry.entry_date", viewEnd)
      .order("entry_date", { foreignTable: "journal_entries", ascending: true })
      .order("line_no", { ascending: true });
    if (error) throw new Error(error.message);
    const all = (data as JournalLine[]) ?? [];
    const before = all.filter((line) => String(line.journal_entry?.entry_date ?? "") < viewStart);
    const period = all.filter((line) => {
      const date = String(line.journal_entry?.entry_date ?? "");
      return date >= viewStart && date <= viewEnd;
    });
    const hasOpeningEntry = all.some((line) =>
      String(line.journal_entry?.reference ?? "").startsWith("ledger_opening:"),
    );
    let openingNet = before.reduce((sum, line) => sum + money(line.debit) - money(line.credit), 0);
    if (
      !before.length &&
      !hasOpeningEntry &&
      selectedLedger &&
      (selectedLedger.opening_balance_date ?? "") < viewStart
    ) {
      const opening = money(selectedLedger.opening_balance);
      openingNet = selectedLedger.opening_balance_side === "cr" ? -opening : opening;
    }
    let running = openingNet;
    const rows = period.map((line) => {
      const debit = money(line.debit);
      const credit = money(line.credit);
      running += debit - credit;
      return {
        date: line.journal_entry?.entry_date ?? "",
        voucher: line.journal_entry?.voucher_number ?? "—",
        particulars: line.line_description || line.journal_entry?.description || "—",
        debit,
        credit,
        balanceDr: Math.max(running, 0),
        balanceCr: Math.max(-running, 0),
      };
    });
    const closing = running;
    return {
      openingNet,
      closing,
      rows,
      ledger: selectedLedger,
      branch: selectedLedger ? branchById.get(selectedLedger.branch_id) : undefined,
    };
  }

  async function exportViewExcel() {
    try {
      const report = await getPeriodReport();
      if (!report || !report.ledger) return toast.error("Load a ledger first.");
      const rows: Record<string, unknown>[] = [];
      if (report.openingNet !== 0) {
        rows.push({
          "Dr Date": report.openingNet > 0 ? viewStart : "",
          "Dr Voucher": report.openingNet > 0 ? "B/F" : "",
          "Dr Particulars": report.openingNet > 0 ? "Balance brought forward" : "",
          "Dr balance": report.openingNet > 0 ? report.openingNet : "",
          "Cr Date": report.openingNet < 0 ? viewStart : "",
          "Cr Voucher": report.openingNet < 0 ? "B/F" : "",
          "Cr Particulars": report.openingNet < 0 ? "Balance brought forward" : "",
          "Cr balance": report.openingNet < 0 ? Math.abs(report.openingNet) : "",
        });
      }
      rows.push(
        ...report.rows.map((row) => ({
          "Dr Date": row.debit > 0 ? row.date : "",
          "Dr Voucher": row.debit > 0 ? row.voucher : "",
          "Dr Particulars": row.debit > 0 ? row.particulars : "",
          "Dr balance": row.debit > 0 ? row.debit : "",
          "Cr Date": row.credit > 0 ? row.date : "",
          "Cr Voucher": row.credit > 0 ? row.voucher : "",
          "Cr Particulars": row.credit > 0 ? row.particulars : "",
          "Cr balance": row.credit > 0 ? row.credit : "",
        })),
      );
      if (report.closing !== 0) {
        rows.push({
          "Dr Date": report.closing > 0 ? viewEnd : "",
          "Dr Voucher": report.closing > 0 ? "C/F" : "",
          "Dr Particulars": report.closing > 0 ? "Balance carried forward" : "",
          "Dr balance": report.closing > 0 ? report.closing : "",
          "Cr Date": report.closing < 0 ? viewEnd : "",
          "Cr Voucher": report.closing < 0 ? "C/F" : "",
          "Cr Particulars": report.closing < 0 ? "Balance carried forward" : "",
          "Cr balance": report.closing < 0 ? Math.abs(report.closing) : "",
        });
      }
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Ledger View");
      XLSX.writeFile(
        workbook,
        `${report.ledger.account_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${viewStart}-to-${viewEnd}.xlsx`,
      );
    } catch (error) {
      toast.error(`Excel export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function exportViewPdf() {
    try {
      const report = await getPeriodReport();
      if (!report || !report.ledger) return toast.error("Load a ledger first.");
      const rows = [
        ...(report.openingNet !== 0
          ? [
              [
                report.openingNet > 0 ? dateText(viewStart) : "—",
                report.openingNet > 0 ? "B/F" : "—",
                report.openingNet > 0 ? "Balance brought forward" : "—",
                report.openingNet > 0 ? pdfMoneyText(report.openingNet) : "—",
                report.openingNet < 0 ? dateText(viewStart) : "—",
                report.openingNet < 0 ? "B/F" : "—",
                report.openingNet < 0 ? "Balance brought forward" : "—",
                report.openingNet < 0 ? pdfMoneyText(Math.abs(report.openingNet)) : "—",
              ],
            ]
          : []),
        ...report.rows.map((row) => [
          row.debit > 0 ? dateText(row.date) : "—",
          row.debit > 0 ? row.voucher : "—",
          row.debit > 0 ? row.particulars : "—",
          row.debit > 0 ? pdfMoneyText(row.debit) : "—",
          row.credit > 0 ? dateText(row.date) : "—",
          row.credit > 0 ? row.voucher : "—",
          row.credit > 0 ? row.particulars : "—",
          row.credit > 0 ? pdfMoneyText(row.credit) : "—",
        ]),
        ...(report.closing !== 0
          ? [
              [
                report.closing > 0 ? dateText(viewEnd) : "—",
                report.closing > 0 ? "C/F" : "—",
                report.closing > 0 ? "Balance carried forward" : "—",
                report.closing > 0 ? pdfMoneyText(report.closing) : "—",
                report.closing < 0 ? dateText(viewEnd) : "—",
                report.closing < 0 ? "C/F" : "—",
                report.closing < 0 ? "Balance carried forward" : "—",
                report.closing < 0 ? pdfMoneyText(Math.abs(report.closing)) : "—",
              ],
            ]
          : []),
      ];
      await openBrandedTablePdf({
        title: `Ledger — ${report.ledger.account_name}`,
        subtitle: `${report.branch?.branch_name ?? "Branch"} | ${dateText(viewStart)} to ${dateText(viewEnd)}`,
        filename: `${report.ledger.account_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-ledger.pdf`,
        orientation: "landscape",
        columns: [
          "Dr Date",
          "Dr Voucher",
          "Dr Particulars",
          "Dr balance",
          "Cr Date",
          "Cr Voucher",
          "Cr Particulars",
          "Cr balance",
        ],
        rows,
        summary: [
          [
            "Opening balance",
            pdfMoneyText(Math.abs(report.openingNet)) +
              ` ${balanceSide(report.openingNet).toUpperCase()}`,
          ],
          [
            "Closing balance",
            pdfMoneyText(Math.abs(report.closing)) +
              ` ${balanceSide(report.closing).toUpperCase()}`,
          ],
        ],
      });
    } catch (error) {
      toast.error(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <AppShell
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
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <AccountsSectionNav desktop mode="ledger" ledgerTab={tab} onLedgerTabChange={setTab} />
        <div className="min-w-0 lg:col-start-2">
          <AccountsSectionNav mode="ledger" ledgerTab={tab} onLedgerTabChange={setTab} />
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
                Accounts / Ledger
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                Branch ledger workspace
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Create categorized ledgers, review automatic bank and cash ledgers, and print a
                balanced period statement.
              </p>
            </div>
          </header>

          {tab === "capital" && (
            <form onSubmit={saveCapitalOpening} className="animate-fade-up space-y-5">
              <section className="surface-card p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                    <Landmark className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Branch capital ledger</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Each branch has one default capital ledger. Its opening balance is posted
                      automatically against that branch’s Opening Balance Equity ledger.
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <SelectField
                    label="Branch"
                    value={capitalBranch}
                    onChange={setCapitalBranch}
                    required
                  >
                    <option value="">Select branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </SelectField>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Opening balance
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={capitalOpening}
                      onChange={(event) => setCapitalOpening(event.target.value)}
                    />
                  </label>
                  <SelectField
                    label="Opening balance side"
                    value={capitalSide}
                    onChange={(value) => setCapitalSide(value as OpeningSide)}
                    required
                  >
                    <option value="cr">Cr (Credit)</option>
                    <option value="dr">Dr (Debit)</option>
                  </SelectField>
                  <label className="space-y-1.5 sm:col-span-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      Opening balance date
                    </span>
                    <Input
                      type="date"
                      value={capitalDate}
                      onChange={(event) => setCapitalDate(event.target.value)}
                    />
                  </label>
                </div>
              </section>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving || branches.length === 0} className="gap-2">
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  {saving ? "Saving…" : "Save capital opening balance"}
                </Button>
              </div>
            </form>
          )}

          {tab === "create" && (
            <form onSubmit={createLedger} className="animate-fade-up space-y-5">
              <section className="surface-card p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                    <Plus className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Create ledger</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      A ledger is created for one branch and starts with one dated opening entry.
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Branch"
                    value={form.branch_id}
                    onChange={(value) => updateForm("branch_id", value)}
                    required
                  >
                    <option value="">Select branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Ledger type"
                    value={form.ledger_type}
                    onChange={(value) =>
                      updateForm("ledger_type", value as FormState["ledger_type"])
                    }
                    required
                  >
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="income">Income</option>
                    <option value="expenditure">Expenditure</option>
                  </SelectField>
                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Description / ledger name *
                    </span>
                    <Input
                      required
                      value={form.description}
                      onChange={(event) => updateForm("description", event.target.value)}
                      placeholder="e.g. Customer Receivable or Diesel Expense"
                    />
                  </label>
                  {(form.ledger_type === "asset" || form.ledger_type === "liability") && (
                    <>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          Opening balance
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.opening_balance}
                          onChange={(event) => updateForm("opening_balance", event.target.value)}
                          placeholder="0.00"
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          Opening balance date
                        </span>
                        <Input
                          type="date"
                          value={form.opening_balance_date}
                          onChange={(event) =>
                            updateForm("opening_balance_date", event.target.value)
                          }
                        />
                      </label>
                      <SelectField
                        label="Opening balance side"
                        value={form.opening_balance_side}
                        onChange={(value) =>
                          updateForm("opening_balance_side", value as OpeningSide)
                        }
                        required
                      >
                        <option value="dr">Dr (Debit)</option>
                        <option value="cr">Cr (Credit)</option>
                      </SelectField>
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        The opening entry is posted automatically against this branch&apos;s Capital
                        account.
                      </p>
                    </>
                  )}
                </div>
              </section>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving || branches.length === 0} className="gap-2">
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {saving ? "Creating…" : "Create ledger"}
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
                      value={listBranch}
                      onChange={(event) => setListBranch(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                    <span className="text-xs font-medium text-muted-foreground">Ledger type</span>
                    <select
                      value={listType}
                      onChange={(event) => setListType(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="all">All types</option>
                      <option value="asset">Asset</option>
                      <option value="liability">Liability</option>
                      <option value="income">Income</option>
                      <option value="expenditure">Expenditure</option>
                      <option value="capital">Capital (system)</option>
                      <option value="bank">Bank</option>
                      <option value="cash">Cash</option>
                    </select>
                  </label>
                  <label className="min-w-56 flex-[1.3] space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Search ledger</span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={listSearch}
                        onChange={(event) => setListSearch(event.target.value)}
                        placeholder="Search by ledger or description"
                      />
                    </div>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={downloadLedgerTemplate}
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
                          if (file) void importLedgers(file);
                        }}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={exportList}
                      disabled={filteredList.length === 0}
                      className="gap-2"
                    >
                      <Download className="size-4" />
                      Export Excel
                    </Button>
                  </div>
                </div>
              </section>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {filteredList.length} active ledger{filteredList.length === 1 ? "" : "s"}
                </p>
                <Button type="button" size="sm" onClick={() => setTab("create")} className="gap-2">
                  <Plus className="size-4" />
                  Create ledger
                </Button>
              </div>
              <section className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3">Ledger</th>
                        <th className="px-4 py-3">Branch</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Opening balance</th>
                        <th className="px-4 py-3">Opening date</th>
                        <th className="px-4 py-3">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {loading ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-muted-foreground">
                            <Loader2 className="mx-auto size-5 animate-spin" />
                          </td>
                        </tr>
                      ) : filteredList.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-muted-foreground">
                            <WalletCards className="mx-auto mb-2 size-6 opacity-50" />
                            No active ledgers match these filters.
                          </td>
                        </tr>
                      ) : (
                        filteredList.map((ledger) => (
                          <tr key={ledger.id} className="hover:bg-muted/30">
                            <td className="px-4 py-3">
                              <p className="font-semibold">{ledger.account_name}</p>
                              <p className="max-w-xs truncate text-xs text-muted-foreground">
                                {ledger.description || "—"}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              {branchById.get(ledger.branch_id)?.branch_name ?? "—"}
                            </td>
                            <td className="px-4 py-3">
                              <LedgerTypeBadge type={ledger.ledger_type} />
                            </td>
                            <td className="px-4 py-3 font-medium">
                              {moneyText(money(ledger.opening_balance))}{" "}
                              <span className="text-xs text-muted-foreground">
                                {ledger.opening_balance_side.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {dateText(ledger.opening_balance_date)}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {ledger.is_system ? "Automatic account" : "Manual ledger"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {tab === "view" && (
            <div className="space-y-5 animate-fade-up">
              <section className="surface-card p-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
                  <SelectField
                    label="Branch"
                    value={viewBranch}
                    onChange={(value) => {
                      setViewBranch(value);
                      setViewLedgerId("");
                    }}
                    required
                  >
                    <option value="">Select branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </SelectField>
                  <label className="space-y-1.5 xl:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">Search ledger</span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={ledgerSearch}
                        onChange={(event) => setLedgerSearch(event.target.value)}
                        placeholder="Type to narrow the ledger selector"
                      />
                    </div>
                  </label>
                  <SelectField
                    label="Ledger"
                    value={viewLedgerId}
                    onChange={setViewLedgerId}
                    required
                  >
                    <option value="">Select ledger</option>
                    {viewLedgers.map((ledger) => (
                      <option key={ledger.id} value={ledger.id}>
                        {ledger.account_name} · {labelForType(ledger.ledger_type)}
                      </option>
                    ))}
                  </SelectField>
                  <div className="flex gap-2">
                    <label className="min-w-0 flex-1 space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Start date</span>
                      <Input
                        type="date"
                        value={viewStart}
                        onChange={(event) => setViewStart(event.target.value)}
                      />
                    </label>
                    <label className="min-w-0 flex-1 space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">End date</span>
                      <Input
                        type="date"
                        value={viewEnd}
                        onChange={(event) => setViewEnd(event.target.value)}
                      />
                    </label>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    onClick={() => void loadView()}
                    disabled={viewLoading || !viewLedgerId}
                    className="gap-2"
                  >
                    {viewLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <BookOpen className="size-4" />
                    )}
                    {viewLoading ? "Loading…" : "View ledger"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void exportViewExcel()}
                    disabled={
                      !selectedLedger ||
                      (viewRows.length === 0 && viewOpeningNet === 0 && !viewLoading)
                    }
                    className="gap-2"
                  >
                    <FileSpreadsheet className="size-4" />
                    Excel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void exportViewPdf()}
                    disabled={
                      !selectedLedger ||
                      (viewRows.length === 0 && viewOpeningNet === 0 && !viewLoading)
                    }
                    className="gap-2"
                  >
                    <FileDown className="size-4" />
                    PDF
                  </Button>
                </div>
              </section>
              <LedgerStatement
                ledger={selectedLedger}
                branch={selectedLedger ? branchById.get(selectedLedger.branch_id) : undefined}
                rows={viewRows}
                openingNet={viewOpeningNet}
                start={viewStart}
                end={viewEnd}
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function LedgerStatement({
  ledger,
  branch,
  rows,
  openingNet,
  start,
  end,
}: {
  ledger: LedgerRow | null;
  branch: BranchOption | undefined;
  rows: JournalLine[];
  openingNet: number;
  start: string;
  end: string;
}) {
  const opening = openingNet;
  const closing =
    opening + rows.reduce((sum, row) => sum + money(row.debit) - money(row.credit), 0);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
              Ledger statement
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              {ledger?.account_name ?? "Select a ledger"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {branch?.branch_name ?? "—"} · {dateText(start)} to {dateText(end)}
            </p>
          </div>
          {ledger && <LedgerTypeBadge type={ledger.ledger_type} />}
        </div>
      </div>
      {!ledger ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <BookOpen className="mx-auto mb-2 size-7 opacity-50" />
          Choose a branch and ledger to view the statement.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Dr Date</th>
                <th className="px-4 py-3">Dr Voucher</th>
                <th className="px-4 py-3">Dr Particulars</th>
                <th className="px-4 py-3 text-right">Dr balance</th>
                <th className="px-4 py-3">Cr Date</th>
                <th className="px-4 py-3">Cr Voucher</th>
                <th className="px-4 py-3">Cr Particulars</th>
                <th className="px-4 py-3 text-right">Cr balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {opening !== 0 && (
                <tr className="bg-primary/5">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {opening > 0 ? dateText(start) : "—"}
                  </td>
                  <td className="px-4 py-3 font-medium">{opening > 0 ? "B/F" : "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    {opening > 0 ? "Balance brought forward" : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {opening > 0 ? moneyText(opening) : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {opening < 0 ? dateText(start) : "—"}
                  </td>
                  <td className="px-4 py-3 font-medium">{opening < 0 ? "B/F" : "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    {opening < 0 ? "Balance brought forward" : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {opening < 0 ? moneyText(Math.abs(opening)) : "—"}
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const debit = money(row.debit);
                const credit = money(row.credit);
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {debit ? dateText(row.journal_entry?.entry_date) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {debit ? (row.journal_entry?.voucher_number ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {debit ? (
                        <>
                          <p>{row.line_description || row.journal_entry?.description || "—"}</p>
                          {row.journal_entry?.reference && (
                            <p className="text-xs text-muted-foreground">
                              {row.journal_entry.reference}
                            </p>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-700">
                      {debit ? moneyText(debit) : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {credit ? dateText(row.journal_entry?.entry_date) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {credit ? (row.journal_entry?.voucher_number ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {credit ? (
                        <>
                          <p>{row.line_description || row.journal_entry?.description || "—"}</p>
                          {row.journal_entry?.reference && (
                            <p className="text-xs text-muted-foreground">
                              {row.journal_entry.reference}
                            </p>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-rose-700">
                      {credit ? moneyText(credit) : "—"}
                    </td>
                  </tr>
                );
              })}
              {closing !== 0 && (
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {closing > 0 ? dateText(end) : "—"}
                  </td>
                  <td className="px-4 py-3">{closing > 0 ? "C/F" : "—"}</td>
                  <td className="px-4 py-3">{closing > 0 ? "Balance carried forward" : "—"}</td>
                  <td className="px-4 py-3 text-right">{closing > 0 ? moneyText(closing) : "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {closing < 0 ? dateText(end) : "—"}
                  </td>
                  <td className="px-4 py-3">{closing < 0 ? "C/F" : "—"}</td>
                  <td className="px-4 py-3">{closing < 0 ? "Balance carried forward" : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {closing < 0 ? moneyText(Math.abs(closing)) : "—"}
                  </td>
                </tr>
              )}
              {rows.length === 0 && opening === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted-foreground">
                    No entries in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {ledger && (
        <div className="grid gap-3 border-t border-border bg-muted/20 p-4 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Opening balance</span>
            <p className="mt-1 font-semibold">
              {moneyText(Math.abs(opening))} {balanceSide(opening).toUpperCase()}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Period entries</span>
            <p className="mt-1 font-semibold">{rows.length}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Closing balance</span>
            <p className="mt-1 font-semibold">
              {moneyText(Math.abs(closing))} {balanceSide(closing).toUpperCase()}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function AccountsLedgerRoute() {
  return (
    <AccountsAccessGuard>
      <AccountsLedgerPage />
    </AccountsAccessGuard>
  );
}
