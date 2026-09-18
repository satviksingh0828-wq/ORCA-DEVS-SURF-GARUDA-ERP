import { useEffect, useMemo, useState } from "react";
import { Check, Download, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inr } from "@/lib/trip-calc";
import { financialYearLabel, financialYearOptions } from "@/lib/financial-year";

type Line = { id: string; contract_id: string; contract_name: string; frequency: "monthly" | "yearly"; income_name: string; amount: number; note: string; income_ledger_id: string };
type Due = { fixed_income_line_id: string; fixed_income_period: string; is_received: boolean };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_FILTER_OPTIONS = [{ value: "0", label: "All Months" }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))];

export function FixedIncomeList() {
  const [lines, setLines] = useState<Line[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [financialYear, setFinancialYear] = useState("none");
  const db = supabase as any;
  async function load() {
    setLoading(true);
    try {
      const { data, error } = await db.from("fixed_income_lines").select("id,contract_id,frequency,income_name,amount,note,income_ledger_id,contracts!inner(contract_name,status)").eq("is_active", true).eq("contracts.status", "active").order("created_at");
      if (error) throw new Error(error.message);
      const mapped = (data ?? []).map((row: any) => ({ ...row, contract_name: row.contracts?.contract_name ?? "", amount: Number(row.amount ?? 0) }));
      setLines(mapped);
      const { data: incomeRows, error: incomeError } = await db.from("incomes").select("fixed_income_line_id,fixed_income_period,is_received").eq("is_fixed_income", true);
      if (incomeError) throw new Error(incomeError.message);
      setDue(incomeRows ?? []);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load fixed income"); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => currentYear - 5 + i + 1);
  const financialYears = useMemo(() => financialYearOptions(currentYear), [currentYear]);
  const monthNum = Number(month);
  const periods = financialYear !== "none"
    ? [4,5,6,7,8,9,10,11,12,1,2,3].map((m) => ({ year: m < 4 ? Number(financialYear) + 1 : Number(financialYear), month: m }))
    : monthNum > 0 ? [{ year: Number(year), month: monthNum }] : Array.from({ length: 12 }, (_, i) => ({ year: Number(year), month: i + 1 }));
  const amountFor = (line: Line) => line.frequency === "yearly" ? line.amount / 12 : line.amount;
  const periodKey = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, "0")}`;
  async function markDue(line: Line, period: string) {
    const { error } = await db.rpc("tms_mark_fixed_income_due", { p_line_id: line.id, p_period_start: `${period}-01` });
    if (error) toast.error(error.message); else { toast.success(`${line.income_name} marked due for ${period}`); void load(); }
  }
  function exportCsv() {
    const rows = [["Period", ...lines.map((line) => line.income_name), "Total"]];
    periods.forEach((period) => { const values = lines.map(amountFor); rows.push([periodKey(period), ...values.map((value) => value.toFixed(2)), values.reduce((a, b) => a + b, 0).toFixed(2)]); });
    const blob = new Blob([rows.map((row) => row.map((v) => `"${v}"`).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `fixed-income-${year}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <div className="animate-fade-up space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Fixed Income</h2><p className="mt-1 text-sm text-muted-foreground">Mark each monthly fixed-income line due once per month. Yearly lines are divided by 12.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button><Button variant="outline" size="sm" onClick={exportCsv} disabled={!lines.length}><Download className="size-4" /> Export CSV</Button></div></div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-3"><Select value={year} onValueChange={setYear}><SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger><SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select><Select value={month} onValueChange={setMonth}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger><SelectContent>{MONTH_FILTER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select><Select value={financialYear} onValueChange={setFinancialYear}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Financial Year: None</SelectItem>{financialYears.map((fy) => <SelectItem key={fy.value} value={fy.value}>FY {financialYearLabel(Number(fy.value))}</SelectItem>)}</SelectContent></Select></div>
    {loading ? <Skeleton className="h-24 w-full" /> : lines.length === 0 ? <p className="rounded-xl bg-muted px-4 py-10 text-center text-sm text-muted-foreground">No fixed-income lines found. Add them in Masters → Sources.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-2 pr-3">Source / Income</th>{periods.map((p) => <th key={periodKey(p)} className="py-2 pr-3 text-right">{MONTHS[p.month - 1]} {p.year}</th>)}</tr></thead><tbody>{lines.map((line) => <tr key={line.id} className="border-b border-border/60"><td className="py-2 pr-3"><div className="font-medium">{line.income_name}</div><div className="text-xs text-muted-foreground">{line.contract_name} · {line.frequency} · {line.note}</div></td>{periods.map((period) => { const key = periodKey(period); const record = due.find((item) => item.fixed_income_line_id === line.id && item.fixed_income_period === key); return <td key={key} className="py-2 pr-3 text-right"><div>{inr(amountFor(line))}</div>{record ? <span className="text-xs text-primary">{record.is_received ? "Received" : "Due"}</span> : <Button size="sm" variant="outline" onClick={() => void markDue(line, key)}><Plus className="size-3" /> Mark Due</Button>}</td>; })}</tr>)}</tbody></table></div>}
  </div>;
}
