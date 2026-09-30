import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import {
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Variable,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/session";
import { useBranches } from "@/lib/use-branches";
import { supabase } from "@/integrations/supabase/client";
import {
  SYSTEM_VARIABLES,
  dynamicFinancialVariables,
  type PeriodMode,
  type ReportScope,
  type SystemVariable,
} from "@/lib/report-master/system-variables";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { findEntry, manifestCharges, type ContractLite, type EntryLite } from "@/lib/trip-calc";
import {
  periodRange,
  SAFE_FUNCTIONS,
  uniqueTemplateCopyName,
  validateFormula,
} from "@/lib/report-master/report-engine";

type VariableRow = {
  id: string;
  name: string;
  variable_key: string;
  system_value_key: string;
  description: string;
  data_type: string;
  default_aggregation: string;
  is_active: boolean;
};
type TemplateColumn = {
  id: string;
  heading: string;
  variableId?: string;
  formula?: string;
  format: string;
};
type TemplateRow = {
  id: string;
  name: string;
  description: string;
  report_scope: ReportScope;
  period_mode: PeriodMode;
  date_basis: string;
  group_by_branch: boolean;
  columns: TemplateColumn[];
  version: number;
  is_active: boolean;
};
type DataRow = Record<string, unknown>;
const scopeLabels: Record<ReportScope, string> = {
  open_trip: "Open Trip Wise",
  closed_trip: "Closed Trip Wise",
  all_trip: "All Trips",
  open_manifest: "Open Trip Manifest Wise",
  closed_manifest: "Closed Trip Manifest Wise",
  all_manifest: "All Manifests",
  branch: "Branch Wise",
  monthly: "Monthly Summary",
  yearly: "Yearly Summary",
};
const tabs = [
  {
    id: "variables",
    label: "Report Variables",
    desc: "Name and link searchable system values",
    icon: Variable,
  },
  {
    id: "templates",
    label: "Report Templates",
    desc: "Design columns and calculated formulas",
    icon: Settings2,
  },
  {
    id: "reports",
    label: "Reports",
    desc: "Filter, view and download Excel",
    icon: FileSpreadsheet,
  },
] as const;
type Tab = (typeof tabs)[number]["id"];
const num = (x: unknown) => Number(String(x ?? "").replace(/,/g, "")) || 0;
const safeKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

function readPath(obj: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let value: unknown = obj;
    for (const part of path.split("."))
      value = value && typeof value === "object" ? (value as DataRow)[part] : undefined;
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function resolveSystem(key: string, row: DataRow): unknown {
  if (key.startsWith("open.") && row.__status !== "Open") return "";
  if (key.startsWith("closed.") && row.__status !== "Closed") return "";
  const snap = row.snapshot as DataRow | undefined;
  const trip = (snap?.trip as DataRow) ?? snap ?? row;
  const date = String(row.closed_at ?? row.created_at ?? row.manifest_date ?? row.start_date ?? "");
  const incomeLines = (row.__income_lines ?? readPath(snap, ["other_income"])) as unknown;
  const expenseLines = (row.__expense_lines ?? readPath(snap, ["expenses"])) as unknown;
  const normalizeName = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  const lineTotal = (lines: unknown, name: string, nameKey: string) =>
    Array.isArray(lines)
      ? lines
          .filter((line) => normalizeName((line as DataRow)[nameKey]) === normalizeName(name))
          .reduce((sum, line) => sum + num((line as DataRow).amount), 0)
      : 0;
  const dynamicMatch = key.match(/^(open|closed|trip)\.(income|expense)\.(.+)$/);
  if (dynamicMatch)
    return lineTotal(
      dynamicMatch[2] === "income" ? incomeLines : expenseLines,
      dynamicMatch[3].replace(/_/g, " "),
      dynamicMatch[2] === "income" ? "income_name" : "expense_name",
    );
  const direct: Record<string, unknown> = {
    "open.trip_code": row.trip_code,
    "open.status": "Open",
    "open.ownership": row.ownership,
    "open.start_date": row.start_date,
    "open.end_date": row.end_date,
    "open.start_time": row.start_time,
    "open.end_time": row.end_time,
    "open.odometer_start": row.odometer_start,
    "open.odometer_end": row.odometer_end,
    "open.notes": row.notes,
    "open.created_at": row.created_at,
    "open.reopened_at": row.reopened_at,
    "open.manifest_count": row.__manifest_count,
    "open.total_weight_kg": row.__weight,
    "open.total_quantity": row.__quantity,
    "open.total_freight": row.__freight,
    "open.total_loading": row.__loading,
    "open.total_other_income": row.__other_income,
    "open.total_income": row.total_income,
    "open.total_expense": row.total_expense,
    "open.net_income": row.net_income,
    "open.profit_margin": num(row.total_income)
      ? (num(row.net_income) / num(row.total_income)) * 100
      : 0,
    "closed.trip_code": row.trip_code,
    "closed.status": "Closed",
    "closed.start_date": row.start_date,
    "closed.end_date": row.end_date,
    "closed.closed_at": row.closed_at,
    "closed.total_income": row.total_income,
    "closed.total_expense": row.total_expense,
    "closed.net_income": row.net_income,
    "closed.profit_margin": num(row.total_income)
      ? (num(row.net_income) / num(row.total_income)) * 100
      : 0,
    "closed.manifest_count": row.__manifest_count,
    "closed.total_weight_kg": row.__weight,
    "closed.total_quantity": row.__quantity,
    "closed.total_freight": row.__freight,
    "closed.total_loading": row.__loading,
    "closed.total_other_income": row.__other_income,
    "trip.trip_code": row.trip_code,
    "trip.status": row.__status,
    "trip.branch_name": row.branch_name ?? readPath(trip, ["branch_name", "branch.branch_name"]),
    "trip.start_date": row.start_date ?? readPath(trip, ["start_date"]),
    "trip.end_date": row.end_date ?? readPath(trip, ["end_date"]),
    "trip.vehicle_number": readPath(trip, [
      "vehicle.registration_number",
      "vehicle_number",
      "vehicle.registration_number",
    ]),
    "trip.driver_name": readPath(trip, ["driver.full_name", "driver_name"]),
    "trip.transporter_name": readPath(trip, ["transporter.transporter_name", "transporter_name"]),
    "trip.contract_name": readPath(trip, ["contract.contract_name", "contract_name"]),
    "trip.start_location": readPath(trip, ["start_location.location_name", "start_location_name"]),
    "trip.end_location": readPath(trip, ["end_location.location_name", "end_location_name"]),
    "trip.manifest_count": row.__manifest_count,
    "trip.total_weight_kg": row.__weight,
    "trip.total_weight_tonnes": num(row.__weight) / 1000,
    "trip.total_quantity": row.__quantity,
    "trip.total_freight": row.__freight,
    "trip.total_loading": row.__loading,
    "trip.total_other_income": row.__other_income ?? readPath(snap, ["totals.other_income"]),
    "trip.total_income": row.total_income,
    "trip.total_expense": row.total_expense ?? row.__expense,
    "trip.net_income": row.net_income ?? num(row.total_income) - num(row.__expense),
    "manifest.number": row.manifest_number,
    "manifest.date": row.manifest_date,
    "manifest.from_pin": row.from_pin_code,
    "manifest.to_pin": row.to_pin_code,
    "manifest.weight_kg": row.weight_kg,
    "manifest.weight_tonnes": num(row.weight_kg) / 1000,
    "manifest.quantity": row.quantity,
    "manifest.from_location": row.from_location_name,
    "manifest.to_location": row.to_location_name,
    "manifest.freight": row.freight,
    "manifest.loading": row.loading,
    "manifest.total_income": num(row.freight) + num(row.loading) + num(row.fixed),
    "expense.fuel": lineTotal(expenseLines, "fuel expense", "expense_name"),
    "expense.parking": lineTotal(expenseLines, "parking charges", "expense_name"),
    "expense.driver_bata": lineTotal(expenseLines, "driver bata", "expense_name"),
    "expense.morning": lineTotal(expenseLines, "morning exp.", "expense_name"),
    "expense.night": lineTotal(expenseLines, "night exp.", "expense_name"),
    "expense.dala": lineTotal(expenseLines, "dala charges", "expense_name"),
    "expense.unloading": lineTotal(expenseLines, "unloading", "expense_name"),
    "expense.sunday": lineTotal(expenseLines, "sunday exp.", "expense_name"),
    "expense.other": Array.isArray(expenseLines)
      ? expenseLines.reduce((sum, line) => sum + num((line as DataRow).amount), 0)
      : 0,
    "expense.hire": lineTotal(expenseLines, "hire charges", "expense_name"),
    "expense.approval": lineTotal(incomeLines, "approval charge", "income_name"),
    "period.month": date ? new Date(date).toLocaleString("en-IN", { month: "long" }) : "",
    "period.year": date ? new Date(date).getFullYear() : "",
    "period.financial_year": date
      ? `FY ${new Date(date).getMonth() < 3 ? new Date(date).getFullYear() - 1 : new Date(date).getFullYear()}-${String(new Date(date).getMonth() < 3 ? new Date(date).getFullYear() : new Date(date).getFullYear() + 1).slice(-2)}`
      : "",
    "summary.row_count": row.__row_count,
    "summary.trip_count": row.__trip_count,
    "summary.manifest_count": row.__manifest_count,
    "summary.open_trip_count": row.__open_trip_count,
    "summary.closed_trip_count": row.__closed_trip_count,
    "summary.total_trip_count": row.__trip_count,
    "summary.total_manifest_count": row.__manifest_count,
    "summary.total_weight_kg": row.__weight,
    "summary.total_quantity": row.__quantity,
    "summary.total_freight": row.__freight,
    "summary.total_loading": row.__loading,
    "summary.total_other_income": row.__other_income,
    "summary.total_income": row.total_income,
    "summary.total_expense": row.total_expense,
    "summary.net_income": row.net_income,
    "summary.profit_margin": num(row.total_income)
      ? (num(row.net_income) / num(row.total_income)) * 100
      : 0,
    "summary.average_income_per_trip": num(row.__trip_count)
      ? num(row.total_income) / num(row.__trip_count)
      : 0,
    "summary.average_expense_per_trip": num(row.__trip_count)
      ? num(row.total_expense) / num(row.__trip_count)
      : 0,
    "summary.average_weight_per_trip": num(row.__trip_count)
      ? num(row.__weight) / num(row.__trip_count)
      : 0,
  };
  const canonical = key.replace(/^(open|closed)\.manifest\./, "manifest.");
  return direct[key] ?? direct[canonical] ?? readPath(snap, [key, key.replace(/^[^.]+\./, "")]);
}

function evalFormula(formula: string, values: Record<string, unknown>) {
  let expression = formula;
  Object.entries(values)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([key, value]) => {
      expression = expression.replace(
        new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
        String(num(value)),
      );
    });
  if (!/^[\d\s.+\-*/()%]+$/.test(expression)) return "Invalid formula";
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) ?? [];
  let at = 0;
  const primary = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const value = add();
      if (tokens[at++] !== ")") throw new Error();
      return value;
    }
    if (token === "-") return -primary();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error();
    return value;
  };
  const multiply = (): number => {
    let value = primary();
    while (["*", "/", "%"].includes(tokens[at])) {
      const op = tokens[at++],
        right = primary();
      value =
        op === "*"
          ? value * right
          : op === "/"
            ? right === 0
              ? 0
              : value / right
            : right === 0
              ? 0
              : value % right;
    }
    return value;
  };
  const add = (): number => {
    let value = multiply();
    while (["+", "-"].includes(tokens[at])) {
      const op = tokens[at++],
        right = multiply();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const result = add();
    return at === tokens.length && Number.isFinite(result) ? result : "Formula error";
  } catch {
    return "Formula error";
  }
}

function enrichClosed(row: DataRow): DataRow {
  const snapshot = (row.snapshot ?? {}) as DataRow;
  const manifests = Array.isArray(snapshot.manifests) ? (snapshot.manifests as DataRow[]) : [];
  const lines = Array.isArray(snapshot.manifest_lines)
    ? (snapshot.manifest_lines as DataRow[])
    : [];
  const income = Array.isArray(snapshot.other_income) ? (snapshot.other_income as DataRow[]) : [];
  const expenses = Array.isArray(snapshot.expenses) ? (snapshot.expenses as DataRow[]) : [];
  return {
    ...row,
    __status: "Closed",
    __manifest_count: manifests.length,
    __weight: manifests.reduce((s, x) => s + num(x.weight_kg), 0),
    __quantity: manifests.reduce((s, x) => s + num(x.quantity), 0),
    __freight: lines.reduce((s, x) => s + num(x.freight), 0),
    __loading: lines.reduce((s, x) => s + num(x.loading), 0),
    __other_income: income.reduce((s, x) => s + num(x.amount), 0),
    __income_lines: income,
    __expense_lines: expenses,
  };
}

async function enrichOpen(rows: DataRow[]): Promise<DataRow[]> {
  const ids = rows.map((r) => String(r.id));
  if (!ids.length) return [];
  const [manifests, incomes, expenses, contracts, entries] = await Promise.all([
    supabase.from("trip_manifests").select("*").in("trip_id", ids),
    supabase.from("trip_other_income").select("*").in("trip_id", ids),
    supabase.from("trip_expenses").select("*").in("trip_id", ids),
    supabase.from("contracts").select("*"),
    supabase.from("contract_entries").select("*"),
  ]);
  if (manifests.error || incomes.error || expenses.error || contracts.error || entries.error)
    throw new Error(
      manifests.error?.message ||
        incomes.error?.message ||
        expenses.error?.message ||
        contracts.error?.message ||
        entries.error?.message,
    );
  return rows.map((row) => {
    const ms = (manifests.data ?? []).filter((x) => x.trip_id === row.id);
    const inc = (incomes.data ?? []).filter((x) => x.trip_id === row.id);
    const exp = (expenses.data ?? []).filter((x) => x.trip_id === row.id);
    const other = inc.reduce((s, x) => s + num(x.amount), 0);
    const expense = exp.reduce((s, x) => s + num(x.amount), 0);
    const lines = ms.map((m) => {
      const sourceId = (m as DataRow).source_id ?? row.contract_id;
      const contract = (contracts.data ?? []).find((c) => c.id === sourceId) as unknown as
        | ContractLite
        | undefined;
      const sourceEntries = (entries.data ?? []).filter(
        (e) => e.contract_id === sourceId,
      ) as unknown as EntryLite[];
      return {
        ...m,
        ...manifestCharges(contract, findEntry(sourceEntries, m as never), m as never),
      };
    });
    const freight = lines.reduce((s, x) => s + num(x.freight), 0);
    const loading = lines.reduce((s, x) => s + num(x.loading), 0);
    const fixed = lines.reduce((s, x) => s + num(x.fixed), 0);
    const total = freight + loading + fixed + other;
    return {
      ...row,
      __status: "Open",
      __manifest_count: ms.length,
      __weight: ms.reduce((s, x) => s + num(x.weight_kg), 0),
      __quantity: ms.reduce((s, x) => s + num(x.quantity), 0),
      __freight: freight,
      __loading: loading,
      __manifest_lines: lines,
      __other_income: other,
      __income_lines: inc,
      __expense_lines: exp,
      total_income: total,
      total_expense: expense,
      net_income: total - expense,
    };
  });
}

function closedManifestRows(trips: DataRow[]): DataRow[] {
  return trips.flatMap((raw) => {
    const row = enrichClosed(raw);
    const snapshot = (raw.snapshot ?? {}) as DataRow;
    const manifests = Array.isArray(snapshot.manifests) ? (snapshot.manifests as DataRow[]) : [];
    const lines = Array.isArray(snapshot.manifest_lines)
      ? (snapshot.manifest_lines as DataRow[])
      : [];
    return manifests.map((manifest, index) => ({
      ...row,
      ...manifest,
      ...((lines[index] ?? {}) as DataRow),
      snapshot: raw.snapshot,
      __status: "Closed",
    }));
  });
}

function summarizeTrips(rows: DataRow[], label: string): DataRow {
  const total = (key: string) => rows.reduce((sum, row) => sum + num(row[key]), 0);
  const income = total("total_income"),
    expense = total("total_expense");
  return {
    __status: "Closed",
    __period_label: label,
    __row_count: rows.length,
    __trip_count: rows.length,
    __open_trip_count: rows.filter((r) => r.__status === "Open").length,
    __closed_trip_count: rows.filter((r) => r.__status === "Closed").length,
    __manifest_count: total("__manifest_count"),
    __weight: total("__weight"),
    __quantity: total("__quantity"),
    __freight: total("__freight"),
    __loading: total("__loading"),
    __other_income: total("__other_income"),
    total_income: income,
    total_expense: expense,
    net_income: income - expense,
    created_at: rows[0]?.created_at ?? rows[0]?.closed_at,
  };
}

export function ReportMasterPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const branches = useBranches();
  const canEdit = Boolean(user && user.role !== "basic");
  const [tab, setTab] = useState<Tab>("variables");
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [navOpen, setNavOpen] = useState(true);
  const [catalog, setCatalog] = useState<SystemVariable[]>(SYSTEM_VARIABLES);
  const load = useCallback(async () => {
    const [v, t, oi, oe, ci, ce] = await Promise.all([
      supabase
        .from("report_variables" as never)
        .select("*")
        .order("created_at"),
      supabase
        .from("report_templates" as never)
        .select("*")
        .order("created_at"),
      supabase.from("incomes").select("income_name"),
      supabase.from("expenditures").select("expenditure_name"),
      supabase.from("closed_trips").select("snapshot"),
      supabase.from("closed_trips").select("snapshot"),
    ]);
    if (v.error || t.error) toast.error(v.error?.message || t.error?.message);
    else {
      setVariables((v.data ?? []) as unknown as VariableRow[]);
      setTemplates((t.data ?? []) as unknown as TemplateRow[]);
      const closedIncome = (ci.data ?? []).flatMap((r) => {
        const x = (r.snapshot as DataRow)?.other_income;
        return Array.isArray(x) ? x.map((i) => String((i as DataRow).income_name ?? "")) : [];
      });
      const closedExpense = (ce.data ?? []).flatMap((r) => {
        const x = (r.snapshot as DataRow)?.expenses;
        return Array.isArray(x) ? x.map((i) => String((i as DataRow).expense_name ?? "")) : [];
      });
      setCatalog([
        ...SYSTEM_VARIABLES,
        ...dynamicFinancialVariables(
          [...(oi.data ?? []).map((x) => x.income_name), ...closedIncome],
          [...(oe.data ?? []).map((x) => x.expenditure_name), ...closedExpense],
        ),
      ]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (user?.role === "basic") navigate({ to: "/tms", replace: true });
  }, [navigate, user]);
  if (!user || user.role === "basic") return null;
  const active = tabs.find((x) => x.id === tab)!;
  return (
    <AppShell
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home">Workspace</Link>
          <ChevronRight className="size-3.5" />
          <Link to="/tms">TMS</Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">Report Master</span>
        </span>
      }
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          className="hidden items-center gap-2 rounded-lg border px-3 py-1.5 text-xs lg:flex"
        >
          {navOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          {navOpen ? "Hide sidebar" : "Show sidebar"}
        </button>
      }
    >
      <div className={`grid gap-6 ${navOpen ? "lg:grid-cols-[240px_1fr]" : "grid-cols-1"}`}>
        {navOpen && (
          <nav className="hidden lg:block">
            <p className="mb-3 px-2 text-[11px] font-semibold tracking-[.18em] text-muted-foreground">
              REPORT MASTER
            </p>
            <ul className="space-y-1">
              {tabs.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => setTab(x.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${tab === x.id ? "bg-primary-soft" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <x.icon className="size-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{x.label}</span>
                      <span className="block truncate text-[11px] opacity-70">{x.desc}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <MobileTabDropdown tabs={tabs} activeId={tab} label="REPORT MASTER" onChange={setTab} />
        <main className="min-w-0">
          <header className="mb-6">
            <h1 className="text-2xl font-semibold">{active.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
          </header>
          {tab === "variables" && (
            <VariablesPanel
              rows={variables}
              catalog={catalog}
              canEdit={canEdit}
              search={search}
              setSearch={setSearch}
              reload={load}
            />
          )}{" "}
          {tab === "templates" && (
            <TemplatesPanel
              rows={templates}
              variables={variables.filter((v) => v.is_active)}
              catalog={catalog}
              canEdit={canEdit}
              reload={load}
            />
          )}{" "}
          {tab === "reports" && (
            <ReportsPanel
              templates={templates.filter((t) => t.is_active)}
              variables={variables}
              branches={branches}
              loading={loading}
              setLoading={setLoading}
            />
          )}
        </main>
      </div>
    </AppShell>
  );
}

function VariablesPanel({
  rows,
  catalog,
  canEdit,
  search,
  setSearch,
  reload,
}: {
  rows: VariableRow[];
  catalog: SystemVariable[];
  canEdit: boolean;
  search: string;
  setSearch: (x: string) => void;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [system, setSystem] = useState("");
  const [systemSearch, setSystemSearch] = useState("");
  const options = catalog.filter((x) =>
    (x.label + " " + x.key + " " + x.group).toLowerCase().includes(systemSearch.toLowerCase()),
  );
  const save = async () => {
    const def = catalog.find((x) => x.key === system);
    if (!name || !def) return toast.error("Enter a name and select a system variable.");
    const { error } = await supabase.from("report_variables" as never).insert({
      name,
      variable_key: key || safeKey(name),
      system_value_key: def.key,
      description: def.description,
      data_type: def.type,
      default_aggregation: def.type === "currency" || def.type === "number" ? "sum" : "none",
    } as never);
    if (error) toast.error(error.message);
    else {
      toast.success("Report variable created");
      setName("");
      setKey("");
      setSystem("");
      await reload();
    }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this report variable?")) return;
    const { error } = await supabase
      .from("report_variables" as never)
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
    else await reload();
  };
  const filtered = rows.filter((x) =>
    (x.name + x.variable_key + x.system_value_key).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-5">
      {canEdit && (
        <section className="surface-card p-5">
          <h2 className="font-semibold">Define a report variable</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Income and expense names found in trips are added automatically as separate Open, Closed
            and Any Trip system values.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Variable name">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!key) setKey(safeKey(e.target.value));
                }}
                placeholder="Example: Trip Income"
              />
            </Field>
            <Field label="Formula key">
              <Input
                value={key}
                onChange={(e) => setKey(safeKey(e.target.value))}
                placeholder="trip_income"
              />
            </Field>
            <Field label="Search all system variables">
              <div className="relative">
                <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={systemSearch}
                  onChange={(e) => setSystemSearch(e.target.value)}
                  placeholder="Search approval, toll, freight, weight..."
                />
              </div>
            </Field>
            <Field label={`System variable (${options.length} found)`}>
              <Select value={system} onValueChange={setSystem}>
                <SelectTrigger>
                  <SelectValue placeholder="Select system value" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {options.map((x) => (
                    <SelectItem key={x.key} value={x.key}>
                      {x.group} · {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {system && (
            <p className="mt-3 rounded-lg bg-muted p-3 text-xs">
              <b>{catalog.find((x) => x.key === system)?.label}</b> —{" "}
              {catalog.find((x) => x.key === system)?.description}
            </p>
          )}
          <Button className="mt-4" onClick={save}>
            <Plus className="mr-2 size-4" />
            Add Variable
          </Button>
        </section>
      )}
      <section>
        <div className="relative mb-3 max-w-sm">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search defined variables"
          />
        </div>
        <div className="overflow-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Formula key</th>
                <th className="p-3 text-left">System value</th>
                <th className="p-3">Type</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => (
                <tr key={x.id} className="border-t">
                  <td className="p-3 font-medium">{x.name}</td>
                  <td className="p-3 font-mono text-xs">{x.variable_key}</td>
                  <td className="p-3">
                    {catalog.find((v) => v.key === x.system_value_key)?.label ?? x.system_value_key}
                  </td>
                  <td className="p-3 text-center">{x.data_type}</td>
                  {canEdit && (
                    <td className="p-3 text-right">
                      <Button size="icon" variant="ghost" onClick={() => remove(x.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No variables found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FormulaInput({
  value,
  variables,
  onChange,
}: {
  value: string;
  variables: VariableRow[];
  onChange: (value: string) => void;
}) {
  const presets: Record<string, string> = {
    "Net Income": "total_income - total_expense",
    "Profit Margin": "IF(total_income, net_income / total_income * 100, 0)",
    "Income per Trip": "IF(trip_count, total_income / trip_count, 0)",
    "Expense per Trip": "IF(trip_count, total_expense / trip_count, 0)",
    "Income per KG": "IF(total_weight_kg, total_income / total_weight_kg, 0)",
    "Expense per KG": "IF(total_weight_kg, total_expense / total_weight_kg, 0)",
    "Operations Net Income": "operations_income - operations_expenditure",
    "Combined Net Income": "combined_income - combined_expense",
  };
  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Formula: income - expense"
      />
      <Select onValueChange={(key) => onChange(`${value}${value ? " " : ""}${key}`)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Search and insert variable…" />
        </SelectTrigger>
        <SelectContent>
          {variables.map((v) => (
            <SelectItem key={v.id} value={v.variable_key}>
              {v.name} ({v.variable_key})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select onValueChange={(preset) => onChange(presets[preset])}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Formula preset…" />
        </SelectTrigger>
        <SelectContent>
          {Object.keys(presets).map((x) => (
            <SelectItem key={x} value={x}>
              {x}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-1">
        {[" + ", " - ", " * ", " / ", " % ", "(", ")", ...SAFE_FUNCTIONS.map((fn) => `${fn}(`)].map(
          (op) => (
            <button
              key={op}
              type="button"
              onClick={() => onChange(value + op)}
              className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
            >
              {op.trim() || op}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function TemplatesPanel({
  rows,
  variables,
  catalog,
  canEdit,
  reload,
}: {
  rows: TemplateRow[];
  variables: VariableRow[];
  catalog: SystemVariable[];
  canEdit: boolean;
  reload: () => Promise<void>;
}) {
  const empty = () => ({
    name: "",
    description: "",
    scope: "closed_trip" as ReportScope,
    period: "month" as PeriodMode,
    basis: "automatic",
    group: false,
    active: true,
    columns: [] as TemplateColumn[],
  });
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [variableSearch, setVariableSearch] = useState("");
  const visible = variables.filter((item) => {
    const system = catalog.find((value) => value.key === item.system_value_key);
    return `${item.name} ${item.variable_key} ${system?.label} ${system?.key} ${system?.group} ${item.description} ${system?.description}`
      .toLowerCase()
      .includes(variableSearch.toLowerCase());
  });
  const patch = (value: Partial<ReturnType<typeof empty>>) =>
    setDraft((current) => ({ ...current, ...value }));
  const reset = () => {
    setDraft(empty());
    setEditing(null);
    setVariableSearch("");
  };
  const edit = (row: TemplateRow) => {
    setEditing(row);
    setDraft({
      name: row.name,
      description: row.description,
      scope: row.report_scope,
      period: row.period_mode ?? "month",
      basis: row.date_basis ?? "automatic",
      group: Boolean(row.group_by_branch),
      active: row.is_active,
      columns: row.columns,
    });
  };
  const changeScope = (scope: ReportScope) => patch({ scope });
  const addColumn = () =>
    patch({
      columns: [
        ...draft.columns,
        { id: crypto.randomUUID(), heading: "", variableId: variables[0]?.id, format: "auto" },
      ],
    });
  const save = async () => {
    if (
      !draft.name ||
      !draft.columns.length ||
      draft.columns.some((c) => !c.heading || (!c.variableId && !c.formula))
    )
      return toast.error("Name the template and complete every column.");
    const formulaError = draft.columns.flatMap((c) =>
      c.formula ? validateFormula(c.formula, variables) : [],
    )[0];
    if (formulaError) return toast.error(formulaError);
    const payload = {
      name: draft.name,
      description: draft.description,
      report_scope: draft.scope,
      period_mode: draft.period,
      date_basis: draft.basis,
      group_by_branch: draft.group,
      columns: draft.columns,
      is_active: draft.active,
    };
    let error;
    if (editing) {
      ({ error } = await supabase
        .from("report_templates" as never)
        .update({ ...payload, version: editing.version + 1 } as never)
        .eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("report_templates" as never).insert(payload as never));
    }
    if (error) return toast.error(error.message);
    toast.success(editing ? "Template updated" : "Template created");
    reset();
    await reload();
  };
  const duplicate = async (row: TemplateRow) => {
    const duplicateName = uniqueTemplateCopyName(
      row.name,
      rows.map((template) => template.name),
    );
    const { data, error } = await supabase
      .from("report_templates" as never)
      .insert({
        name: duplicateName,
        description: row.description,
        report_scope: row.report_scope,
        period_mode: row.period_mode,
        date_basis: row.date_basis,
        group_by_branch: row.group_by_branch,
        columns: row.columns,
        is_active: row.is_active,
        version: 1,
      } as never)
      .select("*")
      .single();
    if (error) toast.error(error.message);
    else {
      const copy = data as unknown as TemplateRow;
      edit(copy);
      toast.success("Template duplicated. You can edit the copy now.");
      await reload();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    const { error } = await supabase
      .from("report_templates" as never)
      .delete()
      .eq("id", id);
    if (error) toast.error(error.message);
    else await reload();
  };
  return (
    <div className="space-y-5">
      {canEdit && (
        <section className="surface-card p-5">
          <h2 className="font-semibold">
            {editing ? "Edit report template" : "Create report template"}
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Template name">
              <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Description">
              <Input
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
            <Field label="Report scope">
              <Select value={draft.scope} onValueChange={(x) => changeScope(x as ReportScope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(scopeLabels).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Period mode">
              <Select
                value={draft.period}
                onValueChange={(x) => patch({ period: x as PeriodMode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="year">Calendar Year</SelectItem>
                  <SelectItem value="financial_year">Financial Year</SelectItem>
                  <SelectItem value="all">All Dates</SelectItem>
                  <SelectItem value="custom">Custom Date Range</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date basis">
              <Select value={draft.basis} onValueChange={(basis) => patch({ basis })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "automatic",
                    "trip_start",
                    "trip_end",
                    "trip_closed",
                    "manifest_date",
                    "entry_date",
                    "received_date",
                    "paid_date",
                  ].map((x) => (
                    <SelectItem key={x} value={x}>
                      {x.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 pt-7 text-sm">
              <input
                type="checkbox"
                checked={draft.group}
                onChange={(e) => patch({ group: e.target.checked })}
              />{" "}
              Group by branch
            </label>
          </div>
          <div className="mt-4">
            <Input
              value={variableSearch}
              onChange={(e) => setVariableSearch(e.target.value)}
              placeholder="Search variables by name, key, category, or description…"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              All variables are available in every report scope. Values that do not exist for a
              particular row are left blank.
            </p>
          </div>
          <div className="mt-5 space-y-3">
            {draft.columns.map((c, i) => (
              <div
                key={c.id}
                className="grid gap-2 rounded-xl border p-3 md:grid-cols-[1fr_1fr_1.35fr_auto]"
              >
                <Input
                  value={c.heading}
                  onChange={(e) =>
                    patch({
                      columns: draft.columns.map((x) =>
                        x.id === c.id ? { ...x, heading: e.target.value } : x,
                      ),
                    })
                  }
                  placeholder={`Column ${i + 1} heading`}
                />
                <Select
                  value={c.variableId}
                  onValueChange={(id) =>
                    patch({
                      columns: draft.columns.map((x) =>
                        x.id === c.id ? { ...x, variableId: id, formula: undefined } : x,
                      ),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Direct variable" />
                  </SelectTrigger>
                  <SelectContent>
                    {visible.map((v) => {
                      const system = catalog.find((x) => x.key === v.system_value_key);
                      return (
                        <SelectItem key={v.id} value={v.id}>
                          {system?.group} · {v.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <FormulaInput
                  value={c.formula ?? ""}
                  variables={variables}
                  onChange={(formula) =>
                    patch({
                      columns: draft.columns.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              formula: formula || undefined,
                              variableId: formula ? undefined : x.variableId,
                            }
                          : x,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => patch({ columns: draft.columns.filter((x) => x.id !== c.id) })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={addColumn} disabled={!variables.length}>
              <Plus className="mr-2 size-4" />
              Add Column
            </Button>
            <Button onClick={save}>{editing ? "Save Changes" : "Save Template"}</Button>
            {editing && (
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
            )}
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => patch({ active: e.target.checked })}
              />{" "}
              Active
            </label>
          </div>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((t) => (
          <article key={t.id} className="surface-card p-5">
            <div className="flex justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {scopeLabels[t.report_scope]} · {t.period_mode?.replaceAll("_", " ") ?? "month"} ·
                  Version {t.version}
                </p>
              </div>
              {canEdit && (
                <div className="flex">
                  <Button title="Edit template" size="icon" variant="ghost" onClick={() => edit(t)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    title="Duplicate and edit template"
                    size="icon"
                    variant="ghost"
                    onClick={() => duplicate(t)}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    title="Delete template"
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(t.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t.description}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {t.columns.map((c) => (
                <span key={c.id} className="rounded bg-muted px-2 py-1 text-xs">
                  {c.heading}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ReportsPanel({
  templates,
  variables,
  branches,
  loading,
  setLoading,
}: {
  templates: TemplateRow[];
  variables: VariableRow[];
  branches: { id: string; branch_name: string }[];
  loading: boolean;
  setLoading: (x: boolean) => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [branch, setBranch] = useState("all");
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const template = templates.find((t) => t.id === templateId);
  const cols = template?.columns ?? [];
  const generate = async () => {
    if (!template) return toast.error("Select a template.");
    setLoading(true);
    try {
      const range = periodRange({
        mode: template.period_mode ?? (template.report_scope === "yearly" ? "year" : "month"),
        month: Number(month),
        year: Number(year),
        startDate: customStart,
        endDate: customEnd,
      });
      const start = range.start ?? "0001-01-01";
      const end = range.end ?? "9999-12-31";
      let data: DataRow[] = [];
      const needsClosed = [
        "closed_trip",
        "all_trip",
        "closed_manifest",
        "all_manifest",
        "branch",
        "monthly",
        "yearly",
      ].includes(template.report_scope);
      const needsOpen = [
        "open_trip",
        "all_trip",
        "open_manifest",
        "all_manifest",
        "monthly",
        "yearly",
      ].includes(template.report_scope);
      let closedRows: DataRow[] = [];
      let openRows: DataRow[] = [];
      if (needsClosed) {
        let q = supabase
          .from("closed_trips")
          .select("*")
          .gte("closed_at", start)
          .lt("closed_at", end);
        if (branch !== "all") q = q.eq("branch_id", branch);
        const r = await q;
        if (r.error) throw r.error;
        closedRows = (r.data ?? []).map(enrichClosed);
      }
      if (needsOpen) {
        let q = supabase.from("trips").select("*").gte("start_date", start).lt("start_date", end);
        if (branch !== "all") q = q.eq("branch_id", branch);
        const r = await q;
        if (r.error) throw r.error;
        openRows = await enrichOpen(
          (r.data ?? []).map((x) => ({
            ...x,
            branch_name: branches.find((b) => b.id === x.branch_id)?.branch_name,
          })),
        );
      }
      if (template.report_scope === "closed_trip" || template.report_scope === "branch")
        data = closedRows;
      if (template.report_scope === "open_trip") data = openRows;
      if (template.report_scope === "all_trip") data = [...closedRows, ...openRows];
      if (template.report_scope === "monthly" || template.report_scope === "yearly")
        data = [
          {
            ...summarizeTrips(
              [...closedRows, ...openRows],
              template.report_scope === "yearly"
                ? year
                : new Date(Number(year), Number(month) - 1).toLocaleString("en-IN", {
                    month: "long",
                    year: "numeric",
                  }),
            ),
            created_at: start,
          },
        ];
      if (["open_manifest", "all_manifest"].includes(template.report_scope)) {
        const ids = openRows.map((t) => String(t.id));
        if (ids.length) {
          const r = await supabase
            .from("trip_manifests")
            .select("*")
            .in("trip_id", ids)
            .gte("manifest_date", start)
            .lt("manifest_date", end);
          if (r.error) throw r.error;
          data.push(
            ...(r.data ?? []).map((m) => {
              const trip = openRows.find((t) => t.id === m.trip_id);
              const line = Array.isArray(trip?.__manifest_lines)
                ? (trip.__manifest_lines as DataRow[]).find((x) => x.id === m.id)
                : undefined;
              return { ...trip, ...m, ...line, __status: "Open" };
            }),
          );
        }
      }
      if (["closed_manifest", "all_manifest"].includes(template.report_scope))
        data.push(
          ...closedManifestRows(closedRows).filter(
            (row) =>
              String(row.manifest_date ?? row.closed_at) >= start &&
              String(row.manifest_date ?? row.closed_at) < end,
          ),
        );
      if (template.report_scope === "branch") {
        const grouped = new Map<string, DataRow>();
        data.forEach((r) => {
          const k = String(r.branch_id ?? "none");
          const g = grouped.get(k) ?? {
            branch_name: r.branch_name || "Unassigned",
            __row_count: 0,
            __trip_count: 0,
            __manifest_count: 0,
            total_income: 0,
            total_expense: 0,
            net_income: 0,
            __status: "Closed",
          };
          g.__row_count = num(g.__row_count) + 1;
          g.__trip_count = num(g.__trip_count) + 1;
          g.total_income = num(g.total_income) + num(r.total_income);
          g.total_expense = num(g.total_expense) + num(r.total_expense);
          g.net_income = num(g.net_income) + num(r.net_income);
          grouped.set(k, g);
        });
        data = [...grouped.values()];
      }
      setRows(
        data.map((raw) => {
          const values: Record<string, unknown> = {};
          variables.forEach(
            (v) => (values[v.variable_key] = resolveSystem(v.system_value_key, raw)),
          );
          const out: DataRow = {};
          cols.forEach(
            (c) =>
              (out[c.heading] = c.formula
                ? evalFormula(c.formula, values)
                : values[variables.find((v) => v.id === c.variableId)?.variable_key ?? ""]),
          );
          return out;
        }),
      );
      toast.success(`${data.length} rows generated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate report");
    } finally {
      setLoading(false);
    }
  };
  const download = () => {
    if (!template || !rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = cols.map((c) => ({ wch: Math.max(14, c.heading.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(
      wb,
      `${safeKey(template.name)}-${year}${template.report_scope === "yearly" ? "" : `-${month.padStart(2, "0")}`}.xlsx`,
    );
  };
  return (
    <div className="space-y-5">
      <section className="surface-card p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Template">
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {template?.period_mode === "month" && (
            <Field label="Month">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      {new Date(2020, i).toLocaleString("en-IN", { month: "long" })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {!["all", "custom"].includes(template?.period_mode ?? "month") && (
            <Field
              label={template?.period_mode === "financial_year" ? "Financial year starts" : "Year"}
            >
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
          )}
          {template?.period_mode === "custom" && (
            <>
              <Field label="Start date">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </Field>
              <Field label="End date">
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Branch">
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={generate} disabled={loading}>
            {loading ? "Generating..." : "Generate Report"}
          </Button>
          <Button variant="outline" onClick={download} disabled={!rows.length}>
            <Download className="mr-2 size-4" />
            Download Excel
          </Button>
        </div>
      </section>
      <div className="overflow-auto rounded-xl border">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="bg-muted">
            <tr>
              {cols.map((c) => (
                <th key={c.id} className="p-3 text-left">
                  {c.heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {cols.map((c) => (
                  <td key={c.id} className="p-3">
                    {String(r[c.heading] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={Math.max(cols.length, 1)}
                  className="p-10 text-center text-muted-foreground"
                >
                  Select a template and filters to generate a report.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
