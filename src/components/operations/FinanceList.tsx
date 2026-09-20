import { useEffect, useMemo, useState } from "react";
import { Check, Download, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityPicker, type PickerOption } from "@/components/EntityPicker";
import { CsvIO } from "@/components/CsvIO";
import { useBranches } from "@/lib/use-branches";
import { useSession } from "@/lib/session";
import { isAdminLike } from "@/lib/roles";
import { inr, num } from "@/lib/trip-calc";
import { fetchAll } from "@/lib/fetch-all";
import { logAction } from "@/lib/log-actions";
import { financialYearOptions, financialYearRange, dateInFinancialYear } from "@/lib/financial-year";
import { ItemLogsButton } from "@/components/shared/ItemLogsDrawer";
import { isDriverActive } from "@/lib/drivers";
import { openBrandedTablePdf } from "@/lib/branded-pdf";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  emptyFinanceRow,
  FINANCE_CONFIG,
  MONTHS,
  monthOf,
  yearOf,
  type FinanceKind,
  type FinanceRow,
} from "@/lib/finance";

// Generated database types predate the expenditure accounting columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type AnyRow = Record<string, unknown> & { id: string };
type PaymentLedger = { id: string; account_name: string; ledger_type: "cash" | "bank"; branch_id: string };
type BranchLedger = { id: string; account_name: string; ledger_type: string; branch_id: string };
type TmsMapping = {
  branch_id: string;
  other_expenditure_ledger_id: string | null;
  other_expenditure_payable_ledger_id: string | null;
  other_income_ledger_id: string | null;
  other_income_receivable_ledger_id: string | null;
};

const CSV_COLUMNS = [
  "entry_date",
  "name",
  "amount",
  "note",
  "branch",
  "vehicle",
  "driver",
  "transporter",
  "status",
  "status_date",
];

export function FinanceList({ kind }: { kind: FinanceKind }) {
  const cfg = FINANCE_CONFIG[kind];
  const allBranches = useBranches();
  const { user } = useSession();

  // Basic users: filter to their allowed branches only
  const isBasic = user?.role === "basic";
  const isAdmin = isAdminLike(user?.role);
  const allowedBranchIds = isBasic ? (user?.branchIds ?? []) : null;
  const branches = allowedBranchIds !== null
    ? allBranches.filter((b) => allowedBranchIds.includes(b.id))
    : allBranches;

  const [rows, setRows] = useState<FinanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FinanceRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [vehicles, setVehicles] = useState<AnyRow[]>([]);
  const [drivers, setDrivers] = useState<AnyRow[]>([]);
  const [transporters, setTransporters] = useState<AnyRow[]>([]);
  const [paymentLedgers, setPaymentLedgers] = useState<PaymentLedger[]>([]);
  const [paymentRow, setPaymentRow] = useState<FinanceRow | null>(null);
  const [paymentLedgerId, setPaymentLedgerId] = useState("");
  const [branchLedgers, setBranchLedgers] = useState<BranchLedger[]>([]);
  const [tmsMappings, setTmsMappings] = useState<TmsMapping[]>([]);

  const currentYear = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(currentMonth);
  const [financialYear, setFinancialYear] = useState("none");
  const [status, setStatus] = useState<"all" | "done" | "pending">("all");

  async function load() {
    setLoading(true);
    try {
      // Basic user with no branches: show nothing
      if (allowedBranchIds !== null && allowedBranchIds.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const data = await fetchAll<Record<string, unknown>>(() => {
        let q = supabase
          .from(cfg.table)
          .select("*")
          .order("entry_date", { ascending: false });

        // ── Push date filter to Supabase (avoids loading 50k+ rows client-side) ──
        if (financialYear !== "none") {
          const range = financialYearRange(Number(financialYear));
          q = q.gte("entry_date", range.start).lt("entry_date", range.end) as typeof q;
        } else if (year !== "all") {
          if (month !== "all") {
            const nextMonthNum = Number(month) + 1;
            const nextMonthStart =
              nextMonthNum > 12
                ? `${Number(year) + 1}-01-01`
                : `${year}-${String(nextMonthNum).padStart(2, "0")}-01`;
            q = q
              .gte("entry_date", `${year}-${month}-01`)
              .lt("entry_date", nextMonthStart) as typeof q;
          } else {
            q = q
              .gte("entry_date", `${year}-01-01`)
              .lt("entry_date", `${Number(year) + 1}-01-01`) as typeof q;
          }
        }

        if (allowedBranchIds !== null) {
          q = q.in("branch_id", allowedBranchIds) as typeof q;
        }
        // Basic users never see EMI, yearly-fixed, insurance or road-tax rows (admin-only).
        // Payroll IS shown to basic users — it's a real expense they can pay.
        if (isBasic && cfg.table === "expenditures") {
          q = (q as ReturnType<typeof supabase.from>).eq("is_emi", false) as typeof q;
          q = (q as ReturnType<typeof supabase.from>).eq("is_yearly_fixed", false) as typeof q;
          q = (q as ReturnType<typeof supabase.from>).eq("is_insurance", false) as typeof q;
          q = (q as ReturnType<typeof supabase.from>).eq("is_road_tax", false) as typeof q;
        }
        return q;
      });
      setRows(
        data.map((r) => ({
          id: r.id as string,
          name: String(r[cfg.nameCol] ?? ""),
          amount: String(r.amount ?? ""),
          note: String(r.note ?? ""),
          entry_date: String(r.entry_date ?? ""),
          branch_id: (r.branch_id as string) ?? null,
          vehicle_id: (r.vehicle_id as string) ?? null,
          driver_id: (r.driver_id as string) ?? null,
          transporter_id: (r.transporter_id as string) ?? null,
          settled: Boolean(r[cfg.statusCol]),
          settled_date: String(r[cfg.statusDateCol] ?? ""),
          is_payroll: Boolean(r.is_payroll),
          payroll_id: (r.payroll_id as string) ?? null,
          is_emi: Boolean(r.is_emi),
          emi_installment_id: (r.emi_installment_id as string) ?? null,
          expenditure_ledger_id: (r.expenditure_ledger_id as string) ?? null,
          expenditure_payable_ledger_id: (r.expenditure_payable_ledger_id as string) ?? null,
          payment_ledger_id: (r.payment_ledger_id as string) ?? null,
          is_fixed_income: Boolean(r.is_fixed_income),
          fixed_income_line_id: (r.fixed_income_line_id as string) ?? null,
          fixed_income_period: (r.fixed_income_period as string) ?? null,
          income_ledger_id: (r.income_ledger_id as string) ?? null,
          income_receivable_ledger_id: (r.income_receivable_ledger_id as string) ?? null,
        })),
      );
    } catch {
      toast.error(`Could not load ${cfg.title.toLowerCase()}`);
    }
    setLoading(false);
  }

  async function loadMasters() {
    // Only fetch columns needed for dropdowns — id + display name
    const [v, d, t, l, bl, mappings] = await Promise.all([
      fetchAll<AnyRow>(() => {
        let q = supabase.from("vehicles").select("id,registration_number,nickname,branch_id").order("registration_number");
        if (allowedBranchIds !== null && allowedBranchIds.length > 0) {
          q = q.in("branch_id", allowedBranchIds) as typeof q;
        }
        return q;
      }),
      fetchAll<AnyRow>(() => {
        let q = supabase.from("drivers").select("id,full_name,branch_id,ending_date").order("full_name");
        if (allowedBranchIds !== null && allowedBranchIds.length > 0) {
          q = q.in("branch_id", allowedBranchIds) as typeof q;
        }
        return q;
      }),
      fetchAll<AnyRow>(() => {
        let q = supabase.from("transporters").select("id,transporter_name").order("transporter_name");
        if (allowedBranchIds !== null && allowedBranchIds.length > 0) {
          q = q.in("branch_id", allowedBranchIds) as typeof q;
        }
        return q;
      }),
      fetchAll<PaymentLedger>(() => {
        let q = db.from("ledger_accounts").select("id,account_name,ledger_type,branch_id").eq("is_active", true).in("ledger_type", ["cash", "bank"]).order("account_name");
        if (allowedBranchIds !== null && allowedBranchIds.length > 0) q = q.in("branch_id", allowedBranchIds) as typeof q;
        return q;
      }),
      fetchAll<BranchLedger>(() => {
        let q = db.from("ledger_accounts").select("id,account_name,ledger_type,branch_id").eq("is_active", true).order("account_name");
        if (allowedBranchIds !== null && allowedBranchIds.length > 0) q = q.in("branch_id", allowedBranchIds) as typeof q;
        return q;
      }),
      fetchAll<TmsMapping>(() => {
        let q = db.from("tms_account_ledger_mappings").select("branch_id,other_expenditure_ledger_id,other_expenditure_payable_ledger_id,other_income_ledger_id,other_income_receivable_ledger_id");
        if (allowedBranchIds !== null && allowedBranchIds.length > 0) q = q.in("branch_id", allowedBranchIds) as typeof q;
        return q;
      }),
    ]);
    setVehicles(v);
    setDrivers((d as AnyRow[]).filter((driver) => isDriverActive(driver as never)));
    setTransporters(t);
    setPaymentLedgers(l);
    setBranchLedgers(bl);
    setTmsMappings(mappings);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, user?.id, year, month, financialYear]);

  useEffect(() => {
    loadMasters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, user?.id]);

  const branchOpts: PickerOption[] = branches.map((b) => ({
    id: b.id,
    label: b.branch_name,
    sub: b.branch_type ?? undefined,
  }));
  const vehicleOpts: PickerOption[] = vehicles.map((v) => ({
    id: v.id,
    label: String(v.registration_number ?? ""),
  }));
  const driverOpts: PickerOption[] = drivers.map((d) => ({
    id: d.id,
    label: String(d.full_name ?? ""),
  }));
  const transporterOpts: PickerOption[] = transporters.map((t) => ({
    id: t.id,
    label: String(t.transporter_name ?? ""),
  }));

  const nameOf = (opts: PickerOption[], id: string | null) =>
    (id ? opts.find((o) => o.id === id)?.label : "") ?? "";

  // Static year range — no need to derive from loaded rows (which are now date-filtered)
  const years = useMemo(() => {
    const yr = new Date().getFullYear();
    return Array.from({ length: yr - 2019 }, (_, i) => String(yr - i));
  }, []);
  const financialYears = useMemo(() => financialYearOptions(currentYear), [currentYear]);

  const filtered = rows.filter((r) => {
    if (financialYear !== "none") {
      if (!dateInFinancialYear(r.entry_date, financialYear)) return false;
    } else {
      if (year !== "all" && yearOf(r.entry_date) !== year) return false;
      if (month !== "all" && monthOf(r.entry_date) !== month) return false;
    }
    if (status === "done" && !r.settled) return false;
    if (status === "pending" && r.settled) return false;
    return true;
  });

  const total = filtered.reduce((s, r) => s + num(r.amount), 0);
  const pendingTotal = filtered.filter((r) => !r.settled).reduce((s, r) => s + num(r.amount), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.name.trim()) return toast.error(`${cfg.nameLabel} is required`);
    if (!editing.branch_id) return toast.error("Branch is required");
    if (kind === "expenditure" && !editing.expenditure_ledger_id) return toast.error("Expenditure Account is required");
    if (kind === "expenditure" && !editing.expenditure_payable_ledger_id) return toast.error("Expenditure Payable Account is required");
    if (kind === "expenditure" && editing.settled && !editing.payment_ledger_id) return toast.error("Select the cash or bank account used for payment");
    if (kind === "income" && !editing.income_ledger_id) return toast.error("Income Account is required");
    if (kind === "income" && !editing.income_receivable_ledger_id) return toast.error("Income Receivable Account is required");
    if (kind === "income" && editing.settled && !editing.payment_ledger_id) return toast.error("Select the cash or bank account used for receipt");
    setSaving(true);
    const payload: Record<string, unknown> = {
      [cfg.nameCol]: editing.name,
      amount: editing.amount,
      note: editing.note,
      entry_date: editing.entry_date,
      branch_id: editing.branch_id,
      vehicle_id: editing.vehicle_id,
      driver_id: editing.driver_id,
      transporter_id: editing.transporter_id,
      [cfg.statusCol]: editing.settled,
      [cfg.statusDateCol]: editing.settled_date,
    };
    if (kind === "expenditure") {
      payload.expenditure_ledger_id = editing.expenditure_ledger_id;
      payload.expenditure_payable_ledger_id = editing.expenditure_payable_ledger_id;
      payload.payment_ledger_id = editing.payment_ledger_id;
    }
    if (kind === "income") {
      payload.income_ledger_id = editing.income_ledger_id;
      payload.income_receivable_ledger_id = editing.income_receivable_ledger_id;
      payload.payment_ledger_id = editing.payment_ledger_id;
    }
    const isNew = !editing.id;
    const res = editing.id
      ? await supabase.from(cfg.table).update(payload as never).eq("id", editing.id)
      : await supabase.from(cfg.table).insert(payload as never);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    logAction(isNew ? "created" : "updated", kind, {
      entityId: editing.id ?? "",
      entityLabel: editing.name,
      details: { branch_id: editing.branch_id ?? "", amount: editing.amount },
    });
    toast.success("Saved");
    setEditing(null);
    load();
  }

  async function settle(row: FinanceRow) {
    if (row.is_emi && row.emi_installment_id) {
      if (!paymentLedgerId) return toast.error("Select the cash or bank account used for EMI payment");
      const { error } = await db.rpc("tms_mark_vehicle_emi_paid", {
        p_installment_id: row.emi_installment_id,
        p_payment_ledger_id: paymentLedgerId,
      });
      if (error) return toast.error(error.message);
      logAction("settled", kind, { entityId: row.id ?? "", entityLabel: row.name });
      toast.success(cfg.doneLabel);
      setPaymentRow(null);
      setPaymentLedgerId("");
      load();
      return;
    }
    if (row.is_payroll && row.payroll_id) {
      if (!paymentLedgerId) return toast.error("Select the cash or bank account used for salary payment");
      const { error } = await db.rpc("tms_record_driver_salary_payment", {
        p_payroll_id: row.payroll_id,
        p_payment_ledger_id: paymentLedgerId,
      });
      if (error) return toast.error(error.message);
      logAction("settled", kind, { entityId: row.id ?? "", entityLabel: row.name });
      toast.success(cfg.doneLabel);
      setPaymentRow(null);
      setPaymentLedgerId("");
      load();
      return;
    }
    const paidDate = new Date().toISOString().slice(0, 10);
    if ((kind === "expenditure" || kind === "income" || row.is_fixed_income) && !paymentLedgerId) return toast.error("Select the cash or bank account used for this settlement");
    const { error } = await supabase
      .from(cfg.table)
      .update({
        [cfg.statusCol]: true,
        [cfg.statusDateCol]: paidDate,
        ...((kind === "expenditure" || kind === "income" || row.is_fixed_income) ? { payment_ledger_id: paymentLedgerId } : {}),
      } as never)
      .eq("id", row.id!);
    if (error) return toast.error(error.message);

    // If this expenditure is linked to a payroll record, sync its paid status too
    if (row.is_payroll && row.payroll_id) {
      await supabase
        .from("driver_payrolls")
        .update({ is_paid: true, paid_date: paidDate })
        .eq("id", row.payroll_id);
    }

    logAction("settled", kind, {
      entityId: row.id ?? "",
      entityLabel: row.name,
    });
    toast.success(cfg.doneLabel);
    load();
  }

  const csvRows = filtered.map((r) => ({
    entry_date: r.entry_date,
    name: r.name,
    amount: r.amount,
    note: r.note,
    branch: nameOf(branchOpts, r.branch_id),
    vehicle: nameOf(vehicleOpts, r.vehicle_id),
    driver: nameOf(driverOpts, r.driver_id),
    transporter: nameOf(transporterOpts, r.transporter_id),
    status: r.settled ? cfg.doneLabel : cfg.pendingLabel,
    status_date: r.settled_date,
  }));

  async function onImport(imported: Record<string, string>[]) {
    const idBy = (opts: PickerOption[], label: string) =>
      opts.find((o) => o.label.trim().toLowerCase() === label.trim().toLowerCase())?.id ??
      null;
    const payload = imported
      .filter((r) => (r.name || "").trim() !== "")
      .map((r) => {
        const done = /^(yes|true|paid|received|1)$/i.test((r.status || "").trim());
        return {
          [cfg.nameCol]: r.name,
          amount: r.amount ?? "",
          note: r.note ?? "",
          entry_date: r.entry_date ?? "",
          branch_id: idBy(branchOpts, r.branch ?? ""),
          vehicle_id: idBy(vehicleOpts, r.vehicle ?? ""),
          driver_id: idBy(driverOpts, r.driver ?? ""),
          transporter_id: idBy(transporterOpts, r.transporter ?? ""),
          [cfg.statusCol]: done,
          [cfg.statusDateCol]: r.status_date ?? "",
        };
      });
    if (payload.length === 0) return { inserted: 0, failed: imported.length };
    const { error } = await supabase.from(cfg.table).insert(payload as never);
    if (error) {
      toast.error(error.message);
      return { inserted: 0, failed: payload.length };
    }
    logAction("imported", kind, { details: { count: payload.length } });
    await load();
    return { inserted: payload.length, failed: imported.length - payload.length };
  }

  return (
    <div className="space-y-4">
      {!editing && (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => {
          const row = emptyFinanceRow();
          // Auto-fill branch when user has exactly one allowed branch
          if (allowedBranchIds?.length === 1) row.branch_id = allowedBranchIds[0];
          if (kind === "expenditure" && row.branch_id) {
            const mapping = tmsMappings.find((item) => item.branch_id === row.branch_id);
            row.expenditure_ledger_id = mapping?.other_expenditure_ledger_id ?? null;
            row.expenditure_payable_ledger_id = mapping?.other_expenditure_payable_ledger_id ?? null;
          } else if (kind === "income" && row.branch_id) {
            const mapping = tmsMappings.find((item) => item.branch_id === row.branch_id);
            row.income_ledger_id = mapping?.other_income_ledger_id ?? null;
            row.income_receivable_ledger_id = mapping?.other_income_receivable_ledger_id ?? null;
          }
          setEditing(row);
        }}>
          <Plus className="size-4" />
          New {cfg.single}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <CsvIO
            entityLabel={cfg.title}
            filename={cfg.filename}
            columns={CSV_COLUMNS}
            rows={csvRows}
            onImport={onImport}
          />
        </div>
      </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3">
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1).padStart(2, "0")}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={financialYear} onValueChange={setFinancialYear}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Financial Year: None</SelectItem>
            {financialYears.map((fy) => <SelectItem key={fy.value} value={fy.value}>FY {fy.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="done">{cfg.doneLabel}</SelectItem>
            <SelectItem value="pending">{cfg.pendingLabel}</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">
          Total <span className="font-semibold text-foreground">{inr(total)}</span> ·{" "}
          {cfg.pendingLabel.toLowerCase()}{" "}
          <span className="font-semibold text-foreground">{inr(pendingTotal)}</span>
        </span>
      </div>

      {/* ── Inline create / edit form — shown ABOVE the list ── */}
      {editing && (
        <div className="surface-card space-y-5 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">
              {editing.id ? `Edit ${cfg.single}` : `New ${cfg.single}`}
            </h3>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
          <form onSubmit={save}>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {cfg.nameLabel}
                </Label>
                <Input
                  className="h-10"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Amount (₹)</Label>
                <Input
                  className="h-10"
                  type="number"
                  value={editing.amount}
                  onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Date</Label>
                <Input
                  className="h-10"
                  type="date"
                  value={editing.entry_date}
                  onChange={(e) => setEditing({ ...editing, entry_date: e.target.value })}
                />
              </div>
              <EntityPicker
                label="Branch (required)"
                value={editing.branch_id}
                options={branchOpts}
                onChange={(id) => {
                  const mapping = tmsMappings.find((item) => item.branch_id === id);
                  setEditing({
                    ...editing,
                    branch_id: id,
                    ...(kind === "expenditure"
                      ? {
                          expenditure_ledger_id: mapping?.other_expenditure_ledger_id ?? null,
                          expenditure_payable_ledger_id: mapping?.other_expenditure_payable_ledger_id ?? null,
                        }
                      : kind === "income"
                        ? {
                            income_ledger_id: mapping?.other_income_ledger_id ?? null,
                            income_receivable_ledger_id: mapping?.other_income_receivable_ledger_id ?? null,
                          }
                        : {}),
                  });
                }}
              />
              {kind === "expenditure" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Expenditure Account</Label>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={editing.expenditure_ledger_id ?? ""} onChange={(e) => setEditing({ ...editing, expenditure_ledger_id: e.target.value || null })}>
                      <option value="">Select expenditure account</option>
                      {branchLedgers.filter((ledger) => ledger.branch_id === editing.branch_id && ledger.ledger_type === "expenditure").map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.account_name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Expenditure Payable Account</Label>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={editing.expenditure_payable_ledger_id ?? ""} onChange={(e) => setEditing({ ...editing, expenditure_payable_ledger_id: e.target.value || null })}>
                      <option value="">Select payable account</option>
                      {branchLedgers.filter((ledger) => ledger.branch_id === editing.branch_id && ledger.ledger_type === "liability").map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.account_name}</option>)}
                    </select>
                  </div>
                </>
              )}
              {kind === "income" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Income Account</Label>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={editing.income_ledger_id ?? ""} onChange={(e) => setEditing({ ...editing, income_ledger_id: e.target.value || null })}>
                      <option value="">Select income account</option>
                      {branchLedgers.filter((ledger) => ledger.branch_id === editing.branch_id && ledger.ledger_type === "income").map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.account_name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Income Receivable Account</Label>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={editing.income_receivable_ledger_id ?? ""} onChange={(e) => setEditing({ ...editing, income_receivable_ledger_id: e.target.value || null })}>
                      <option value="">Select receivable account</option>
                      {branchLedgers.filter((ledger) => ledger.branch_id === editing.branch_id && ledger.ledger_type === "asset").map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.account_name}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div className="text-xs text-muted-foreground sm:col-span-2">
                Optionally link this {cfg.single} to one vehicle, driver or transporter.
              </div>
              <EntityPicker
                label="Vehicle"
                value={editing.vehicle_id}
                options={vehicleOpts}
                onChange={(id) =>
                  setEditing({ ...editing, vehicle_id: id, driver_id: null, transporter_id: null })
                }
              />
              <EntityPicker
                label="Driver"
                value={editing.driver_id}
                options={driverOpts}
                onChange={(id) =>
                  setEditing({ ...editing, driver_id: id, vehicle_id: null, transporter_id: null })
                }
              />
              <EntityPicker
                label="Transporter"
                value={editing.transporter_id}
                options={transporterOpts}
                onChange={(id) =>
                  setEditing({ ...editing, transporter_id: id, vehicle_id: null, driver_id: null })
                }
              />
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-medium text-muted-foreground">Note</Label>
                <Input
                  className="h-10"
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                <Select
                  value={editing.settled ? "done" : "pending"}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      settled: v === "done",
                      settled_date:
                        v === "done"
                          ? editing.settled_date || new Date().toISOString().slice(0, 10)
                          : "",
                    })
                  }
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{cfg.pendingLabel}</SelectItem>
                    <SelectItem value="done">{cfg.doneLabel}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {cfg.doneLabel} on
                </Label>
                <Input
                  className="h-10"
                  type="date"
                  value={editing.settled_date}
                  onChange={(e) => setEditing({ ...editing, settled_date: e.target.value })}
                />
              </div>
              {(kind === "expenditure" || kind === "income") && editing.settled && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{kind === "income" ? "Received In" : "Paid From"}</Label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={editing.payment_ledger_id ?? ""} onChange={(e) => setEditing({ ...editing, payment_ledger_id: e.target.value || null })}>
                    <option value="">Select cash or bank account</option>
                    {paymentLedgers.filter((ledger) => ledger.branch_id === editing.branch_id).map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.ledger_type})</option>)}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-2 pt-2 sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          No {cfg.title.toLowerCase()} records for this filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">{cfg.nameLabel}</th>
                <th className="py-2 pr-3">Branch</th>
                <th className="py-2 pr-3">Linked to</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const linked =
                  nameOf(vehicleOpts, r.vehicle_id) ||
                  nameOf(driverOpts, r.driver_id) ||
                  nameOf(transporterOpts, r.transporter_id) ||
                  "—";
                const isPayrollRow = r.is_payroll === true;
                return (
                  <tr key={r.id} className={`border-b border-border/60 ${isPayrollRow ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}`}>
                    <td className="py-2 pr-3">{r.entry_date || "—"}</td>
                    <td className="py-2 pr-3 font-medium">
                      <span>{r.name}</span>
                      {isPayrollRow && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
                          Payroll
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{nameOf(branchOpts, r.branch_id) || "—"}</td>
                    <td className="py-2 pr-3">{linked}</td>
                    <td className="py-2 pr-3 text-right">{inr(num(r.amount))}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          r.settled
                            ? "rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        }
                      >
                        {r.settled ? cfg.doneLabel : cfg.pendingLabel}
                      </span>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        title={`Open ${cfg.single} PDF`}
                        onClick={() => openBrandedTablePdf({
                          title: kind === "income" ? "Income Receipt" : "Expense Voucher",
                          subtitle: `${r.entry_date || "No date"} · ${r.name}`,
                          filename: `${cfg.filename}-${r.id ?? r.entry_date}.pdf`,
                          columns: ["Field", "Details"],
                          rows: [
                            [cfg.nameLabel, r.name], ["Date", r.entry_date || "—"],
                            ["Branch", nameOf(branchOpts, r.branch_id) || "—"], ["Linked to", linked],
                            ["Status", r.settled ? cfg.doneLabel : cfg.pendingLabel],
                            [`${cfg.doneLabel} date`, r.settled_date || "—"], ["Note", r.note || "—"],
                          ],
                          summary: [[kind === "income" ? "INCOME AMOUNT" : "EXPENSE AMOUNT", inr(num(r.amount))]],
                        })}
                      >
                        <Download className="size-4" /> PDF
                      </Button>
                      {!r.settled ? (
                        <Button variant="outline" size="sm" onClick={() => (kind === "expenditure" || kind === "income" || r.is_fixed_income || r.is_payroll || r.is_emi) ? (setPaymentRow(r), setPaymentLedgerId("")) : void settle(r)}>
                          <Check className="size-4" />
                          {cfg.actionLabel}
                        </Button>
                      ) : null}
                      {/* Admin-only: per-row logs */}
                      {isAdmin && r.id ? (
                        <ItemLogsButton
                          entityType={kind}
                          entityId={r.id}
                          entityLabel={r.name}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!paymentRow} onOpenChange={(open) => { if (!open) setPaymentRow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{paymentRow?.is_fixed_income ? "Receive Fixed Income" : paymentRow?.is_emi ? "Pay Vehicle EMI" : "Pay Driver Salary"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {paymentRow?.is_fixed_income
                ? "Select the cash or bank account that received this fixed income. The receipt journal will debit that account and credit the source account."
                : paymentRow?.is_emi
                ? "Select the cash or bank account from the vehicle branch. The payment journal will debit Vehicle EMI Payable and credit this account."
                : "Select the cash or bank account from the payroll branch. The payment journal will debit Driver Salary Payable and credit this account."}
            </p>
            <Select value={paymentLedgerId} onValueChange={setPaymentLedgerId}>
              <SelectTrigger><SelectValue placeholder="Select cash or bank account" /></SelectTrigger>
              <SelectContent>{paymentLedgers.filter((ledger) => ledger.branch_id === paymentRow?.branch_id).map((ledger) => <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.ledger_type})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentRow(null)}>Cancel</Button>
            <Button onClick={() => paymentRow && void settle(paymentRow)} disabled={!paymentLedgerId}>Confirm Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
