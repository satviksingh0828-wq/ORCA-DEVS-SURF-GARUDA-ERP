import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useBranches } from "@/lib/use-branches";

// Generated database types predate the expanded TMS mapping columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Ledger = { id: string; account_name: string; ledger_type: string; account_kind: string };
type Mapping = {
  branch_id: string;
  driver_salary_ledger_id?: string | null;
  driver_salary_payable_ledger_id?: string | null;
  driver_advance_ledger_id?: string | null;
  vehicle_loan_ledger_id?: string | null;
  vehicle_emi_payable_ledger_id?: string | null;
  vehicle_loan_interest_ledger_id?: string | null;
  vehicle_insurance_advance_ledger_id?: string | null;
  vehicle_insurance_expense_ledger_id?: string | null;
  vehicle_road_tax_advance_ledger_id?: string | null;
  vehicle_road_tax_expense_ledger_id?: string | null;
  other_expenditure_ledger_id?: string | null;
  other_expenditure_payable_ledger_id?: string | null;
};

const FIELDS = [
  ["driver_salary_ledger_id", "Driver Salary", "expenditure"],
  ["driver_salary_payable_ledger_id", "Driver Salary Payable", "liability"],
  ["driver_advance_ledger_id", "Driver Advance", "asset"],
  ["vehicle_loan_ledger_id", "Vehicle Loan", "liability"],
  ["vehicle_emi_payable_ledger_id", "Vehicle EMI Payable", "liability"],
  ["vehicle_loan_interest_ledger_id", "Vehicle Loan Interest", "expenditure"],
  ["vehicle_insurance_advance_ledger_id", "Vehicle Insurance Advance", "asset"],
  ["vehicle_insurance_expense_ledger_id", "Vehicle Insurance Expense", "expenditure"],
  ["vehicle_road_tax_advance_ledger_id", "Vehicle Road Tax Advance", "asset"],
  ["vehicle_road_tax_expense_ledger_id", "Vehicle Road Tax Expense", "expenditure"],
  ["other_expenditure_ledger_id", "Other Expenditure", "expenditure"],
  ["other_expenditure_payable_ledger_id", "Other Expenditure Payable", "liability"],
] as const;

type FieldKey = (typeof FIELDS)[number][0];

export function TMSAccountsSettings() {
  const branches = useBranches();
  const [branchId, setBranchId] = useState("");
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load(nextBranchId: string) {
    setBranchId(nextBranchId);
    if (!nextBranchId) {
      setLedgers([]);
      setMapping(null);
      return;
    }
    setLoading(true);
    try {
      const [ledgerResult, mappingResult] = await Promise.all([
        db
          .from("ledger_accounts")
          .select("id,account_name,ledger_type,account_kind")
          .eq("branch_id", nextBranchId)
          .eq("is_active", true)
          .order("account_name"),
        db
          .from("tms_account_ledger_mappings")
          .select("*")
          .eq("branch_id", nextBranchId)
          .maybeSingle(),
      ]);
      if (ledgerResult.error) throw ledgerResult.error;
      if (mappingResult.error) throw mappingResult.error;
      setLedgers((ledgerResult.data ?? []) as Ledger[]);
      setMapping((mappingResult.data as Mapping | null) ?? { branch_id: nextBranchId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load TMS account mappings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!branchId && branches[0]?.id) void load(branches[0].id);
  }, [branches, branchId]);

  const ledgersByType = useMemo(
    () => ({
      expenditure: ledgers.filter((ledger) => ledger.ledger_type === "expenditure"),
      liability: ledgers.filter((ledger) => ledger.ledger_type === "liability"),
      asset: ledgers.filter((ledger) => ledger.ledger_type === "asset"),
    }),
    [ledgers],
  );

  async function save() {
    if (!mapping || !branchId) return;
    setSaving(true);
    try {
      const { error } = await db
        .from("tms_account_ledger_mappings")
        .upsert({ ...mapping, branch_id: branchId }, { onConflict: "branch_id" });
      if (error) throw error;
      toast.success("TMS account mappings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save TMS account mappings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card p-6">
          <h3 className="text-sm font-semibold">TMS Accounts</h3>
          <p className="mt-1 text-sm text-muted-foreground">
          Map the ledgers used for driver payroll, vehicle loans, and vehicle EMI accounting.
          Each mapping is branch-specific.
        </p>
        <div className="mt-5 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Branch</label>
          <select
            value={branchId}
            onChange={(event) => void load(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Select branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.branch_name}
              </option>
            ))}
          </select>
        </div>
      </section>
      {loading ? (
        <div className="surface-card flex justify-center py-14">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : mapping ? (
        <section className="surface-card p-6">
          <div className="mb-4 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Driver Salary, Vehicle Loan Interest, Insurance Expense, and Road Tax Expense use expenditure
            ledgers. Driver Salary Payable, Vehicle Loan, and Vehicle EMI Payable use liability ledgers.
            Driver Advance, Insurance Advance, and Road Tax Advance use asset ledgers. Cash and bank
            payment accounts are selected at the time of payment. Other Expenditure and Other
            Expenditure Payable are the defaults for general expenditure entries.
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(([key, label, type]) => (
              <label key={key} className="space-y-1.5">
                <span className="text-sm font-medium">{label}</span>
                <select
                  value={mapping[key] ?? "none"}
                  onChange={(event) =>
                    setMapping((current) =>
                      current
                        ? {
                            ...current,
                            [key]: event.target.value === "none" ? null : event.target.value,
                          }
                        : current,
                    )
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="none">Not mapped</option>
                  {ledgersByType[type].map((ledger) => (
                    <option key={ledger.id} value={ledger.id}>
                      {ledger.account_name} ({ledger.ledger_type})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <Button type="button" onClick={() => void save()} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save mappings
            </Button>
          </div>
        </section>
      ) : (
        <div className="surface-card p-8 text-center text-sm text-muted-foreground">
          Select a branch to configure TMS accounts.
        </div>
      )}
    </div>
  );
}
