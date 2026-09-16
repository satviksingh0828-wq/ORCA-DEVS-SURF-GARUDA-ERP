import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBranches } from "@/lib/use-branches";
import { supabase } from "@/integrations/supabase/client";

const FIELDS = [
  ["salary_ledger_id", "Salary", "income-expenditure"],
  ["salary_payable_ledger_id", "Salary Payable", "liability"],
  ["employee_advance_ledger_id", "Employee Advance", "asset"],
  ["employee_loan_ledger_id", "Employee Loan", "asset"],
  ["incentive_ledger_id", "Incentive", "income-expenditure"],
  ["incentive_payable_ledger_id", "Incentive Payable", "liability"],
  ["pf_ledger_id", "PF Payable", "liability"],
  ["tax_ledger_id", "Tax Payable", "liability"],
  ["salary_deduction_ledger_id", "Salary Deduction", "income-expenditure"],
  ["loss_deduction_ledger_id", "Loss Deduction", "income-expenditure"],
  ["unpaid_leave_deduction_ledger_id", "Unpaid Leave Deduction", "income-expenditure"],
  ["paid_leave_payout_ledger_id", "Paid Leave Payout", "income-expenditure"],
  ["extra_work_day_payout_ledger_id", "Extra Work Day Payout", "income-expenditure"],
] as const;

type FieldKey = (typeof FIELDS)[number][0];
type Ledger = { id: string; account_name: string; ledger_type: string; account_kind: string };
type Mapping = { branch_id: string } & Partial<Record<FieldKey, string | null>>;

export function HRMSAccountsSettings() {
  const branches = useBranches();
  const [branchId, setBranchId] = useState("");
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async (nextBranchId: string) => {
    setBranchId(nextBranchId);
    if (!nextBranchId) { setLedgers([]); setMapping(null); return; }
    setLoading(true);
    try {
      const [ledgerResult, mappingResult] = await Promise.all([
        supabase.from("ledger_accounts").select("id,account_name,ledger_type,account_kind").eq("branch_id", nextBranchId).eq("is_active", true).order("account_name"),
        supabase.from("hrms_account_ledger_mappings").select("*").eq("branch_id", nextBranchId).maybeSingle(),
      ]);
      if (ledgerResult.error) throw ledgerResult.error;
      if (mappingResult.error) throw mappingResult.error;
      setLedgers((ledgerResult.data ?? []) as Ledger[]);
      setMapping((mappingResult.data as Mapping | null) ?? { branch_id: nextBranchId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load HRMS account mappings");
    } finally { setLoading(false); }
  };

  useEffect(() => { if (!branchId && branches[0]?.id) void load(branches[0].id); }, [branches, branchId]);
  const ledgersByType = useMemo(() => ({
    asset: ledgers.filter((ledger) => ledger.ledger_type === "asset"),
    liability: ledgers.filter((ledger) => ledger.ledger_type === "liability"),
    income: ledgers.filter((ledger) => ledger.ledger_type === "income"),
    incomeExpenditure: ledgers.filter((ledger) => ["income", "expenditure"].includes(ledger.ledger_type)),
  }), [ledgers]);

  async function save() {
    if (!mapping || !branchId) return;
    setSaving(true);
    try {
      const payload = { ...mapping, branch_id: branchId };
      const { error } = await supabase.from("hrms_account_ledger_mappings").upsert(payload, { onConflict: "branch_id" });
      if (error) throw error;
      toast.success("HRMS account mappings saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save HRMS account mappings"); }
    finally { setSaving(false); }
  }

  return <div className="animate-fade-up space-y-5">
    <section className="surface-card p-6">
      <h3 className="text-sm font-semibold">HRMS Accounts</h3>
      <p className="mt-1 text-sm text-muted-foreground">Choose ledgers from this branch. Salary Payable, Incentive Payable, PF Payable, and Tax Payable use liability ledgers; employee advances and loans use asset ledgers.</p>
      <div className="mt-5 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Branch</label>
        <select value={branchId} onChange={(event) => void load(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
        </select>
      </div>
    </section>
    {loading ? <div className="surface-card flex justify-center py-14"><Loader2 className="size-5 animate-spin" /></div> : mapping ? <section className="surface-card p-6"><div className="mb-4 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">All choices are active ledgers belonging to this branch. Employee Advance and Employee Loan require asset ledgers; Salary Payable, Incentive Payable, PF Payable, and Tax Payable require liability ledgers; other HRMS mappings use income or expenditure ledgers.</div><div className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map(([key, label, type]) => { const choices = type === "asset" ? ledgersByType.asset : type === "liability" ? ledgersByType.liability : type === "income" ? ledgersByType.income : ledgersByType.incomeExpenditure; return <label key={key} className="space-y-1.5"><span className="text-sm font-medium">{label}</span><select value={mapping[key] ?? "none"} onChange={(event) => setMapping((current) => current ? { ...current, [key]: event.target.value === "none" ? null : event.target.value } : current)} className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="none">Not mapped</option>{choices.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.ledger_type})</option>)}</select></label>; })}
    </div><div className="mt-6 flex justify-end"><Button type="button" onClick={() => void save()} disabled={saving} className="gap-2">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save mappings</Button></div></section> : <div className="surface-card p-8 text-center text-sm text-muted-foreground">Select a branch to configure HRMS accounts.</div>}
  </div>;
}
