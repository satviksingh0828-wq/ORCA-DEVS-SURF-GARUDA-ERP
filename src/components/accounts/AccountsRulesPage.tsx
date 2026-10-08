import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Save, ShieldCheck, Users, WalletCards } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { AccountsAccessGuard } from "@/components/accounts/AccountsAccessGuard";
import {
  AccountsSectionNav,
  consumeAccountsTabNavigation,
  type AutoRulesTab,
} from "@/components/accounts/AccountsSectionNav";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/use-branches";

// Accounts/HRMS tables are newer than the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type Subtab = "verify" | "base" | "rules";
type RuleKey = "payroll_paid" | "loan_given" | "advance_given";
type Rule = {
  id: string;
  branch_id: string;
  rule_key: RuleKey;
  enabled: boolean;
  requires_verification: boolean;
  default_bank_cash_ledger_id: string | null;
  debit_ledger_id: string | null;
  effective_from: string | null;
};
type Ledger = {
  id: string;
  branch_id: string;
  account_name: string;
  ledger_type: string;
  account_kind: string;
};
type Employee = {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string | null;
  department_id: string | null;
};
type Mapping = { employee_id: string; branch_id: string };
type Pending = {
  id: string;
  event_type: RuleKey;
  source_id: string;
  branch_id: string;
  event_date: string;
  amount: number | string;
  description: string;
  debit_ledger_id: string | null;
  credit_ledger_id: string | null;
};
const RULES: Array<{ key: RuleKey; title: string; description: string }> = [
  {
    key: "payroll_paid",
    title: "Salary paid",
    description:
      "Debit the configured salary ledger and credit the branch bank/cash account when HRMS marks salary paid.",
  },
  {
    key: "loan_given",
    title: "Loan given",
    description:
      "Debit the configured employee-loan ledger and credit the branch bank/cash account for the loan principal.",
  },
  {
    key: "advance_given",
    title: "Advance given",
    description:
      "Debit the configured employee-advance ledger and credit the branch bank/cash account for the advance principal.",
  },
];
const tabItems: Array<{ id: Subtab; label: string; description: string }> = [
  { id: "verify", label: "VERIFY", description: "Review pending HRMS entries" },
  { id: "base", label: "HRMS BASE", description: "Assign employee accounting branches" },
  { id: "rules", label: "HRMS RULES", description: "Configure the three posting rules" },
];
const employeeName = (employee: Employee) =>
  `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim() ||
  employee.employee_number ||
  "Employee";

export function AccountsRulesPage() {
  const branches = useBranches();
  const [tab, setTab] = useState<Subtab>(() => {
    const pending = consumeAccountsTabNavigation("auto-rules");
    return tabItems.find((item) => item.id === pending)?.id ?? "verify";
  });
  const [branchId, setBranchId] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [selectedPending, setSelectedPending] = useState<string[]>([]);
  const branchName = useMemo(
    () => branches.find((b) => b.id === branchId)?.branch_name ?? "Selected branch",
    [branches, branchId],
  );

  async function loadAll() {
    const [ruleResult, ledgerResult, employeeResult, mappingResult, pendingResult] =
      await Promise.all([
        db.from("hrms_accounting_rules").select("*").order("rule_key"),
        db
          .from("ledger_accounts")
          .select("id,branch_id,account_name,ledger_type,account_kind")
          .eq("is_active", true)
          .order("account_name"),
        db
          .from("employees")
          .select("id,employee_number,first_name,last_name,department_id")
          .order("first_name"),
        db.from("hrms_employee_accounting_branches").select("employee_id,branch_id"),
        db
          .from("hrms_accounting_queue")
          .select("*")
          .eq("status", "pending")
          .order("event_date", { ascending: false }),
      ]);
    const error =
      ruleResult.error ??
      ledgerResult.error ??
      employeeResult.error ??
      mappingResult.error ??
      pendingResult.error;
    if (error) toast.error(`Could not load Auto Rules: ${error.message}`);
    setRules((ruleResult.data as Rule[]) ?? []);
    setLedgers((ledgerResult.data as Ledger[]) ?? []);
    setEmployees((employeeResult.data as Employee[]) ?? []);
    setMappings((mappingResult.data as Mapping[]) ?? []);
    setPending((pendingResult.data as Pending[]) ?? []);
  }
  useEffect(() => {
    void loadAll();
  }, []);
  useEffect(() => {
    if (!branchId && branches[0]) setBranchId(branches[0].id);
  }, [branches, branchId]);

  function currentRule(key: RuleKey) {
    return (
      rules.find((rule) => rule.branch_id === branchId && rule.rule_key === key) ?? {
        id: "",
        branch_id: branchId,
        rule_key: key,
        enabled: true,
        requires_verification: true,
        default_bank_cash_ledger_id: null,
        debit_ledger_id: null,
        effective_from: null,
      }
    );
  }
  async function saveRule(rule: Rule) {
    if (!branchId) return toast.error("Select a branch first.");
    const debit = ledgers.find((item) => item.id === rule.debit_ledger_id);
    const credit = ledgers.find((item) => item.id === rule.default_bank_cash_ledger_id);
    if (!debit || debit.branch_id !== branchId)
      return toast.error("Select a debit ledger from the selected branch.");
    if (rule.rule_key === "payroll_paid" && debit.ledger_type !== "expenditure")
      return toast.error(
        "Salary paid must debit an active expenditure ledger from the employee branch.",
      );
    if (rule.rule_key !== "payroll_paid" && !["asset", "capital"].includes(debit.ledger_type))
      return toast.error("Loan and advance rules must debit an asset or capital ledger.");
    if (!credit || credit.branch_id !== branchId || !["bank", "cash"].includes(credit.ledger_type))
      return toast.error("Select a bank or cash credit account from the selected branch.");
    setSaving(rule.rule_key);
    const { error } = await db.from("hrms_accounting_rules").upsert(
      {
        branch_id: branchId,
        rule_key: rule.rule_key,
        enabled: rule.enabled,
        requires_verification: rule.requires_verification,
        default_bank_cash_ledger_id: rule.default_bank_cash_ledger_id,
        debit_ledger_id: rule.debit_ledger_id,
        effective_from: rule.effective_from || null,
      },
      { onConflict: "branch_id,rule_key" },
    );
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success(`${RULES.find((item) => item.key === rule.rule_key)?.title} rule saved.`);
    await loadAll();
  }
  async function saveEmployeeBranch(employeeId: string, value: string) {
    if (!value) return toast.error("Select an Accounts branch.");
    const { error } = await db
      .from("hrms_employee_accounting_branches")
      .upsert({ employee_id: employeeId, branch_id: value }, { onConflict: "employee_id" });
    if (error) return toast.error(error.message);
    setMappings((current) => [
      ...current.filter((item) => item.employee_id !== employeeId),
      { employee_id: employeeId, branch_id: value },
    ]);
    toast.success("Employee accounting branch saved.");
  }
  async function verify(ids: string[]) {
    if (!ids.length) return toast.error("Select at least one pending HRMS item.");
    const { error } = await db.rpc("verify_hrms_accounting_queue", { p_queue_ids: ids });
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} HRMS journal entr${ids.length === 1 ? "y" : "ies"} posted.`);
    setSelectedPending([]);
    await loadAll();
  }
  function updateRule(rule: Rule, patch: Partial<Rule>) {
    setRules((all) => [
      ...all.filter((item) => !(item.branch_id === branchId && item.rule_key === rule.rule_key)),
      { ...rule, ...patch },
    ]);
  }

  return (
    <AccountsAccessGuard>
      <AppShell
        variant="ltms"
        shellTitle="Accounts"
        breadcrumb={
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Link to="/home">Workspace</Link>
            <span>/</span>
            <Link to="/accounts">Accounts</Link>
            <span>/</span>
            <span className="text-foreground">Auto Rules</span>
          </span>
        }
      >
        <div className="ltms-reference-shell accounts-reference-shell grid grid-cols-1 lg:grid-cols-[192px_minmax(0,1fr)]">
          <AccountsSectionNav
            desktop
            mode="auto-rules"
            autoRulesTab={tab}
            onAutoRulesTabChange={(nextTab: AutoRulesTab) => setTab(nextTab)}
          />
          <div className="ltms-reference-content min-w-0">
            <AccountsSectionNav
              mode="auto-rules"
              autoRulesTab={tab}
              onAutoRulesTabChange={(nextTab: AutoRulesTab) => setTab(nextTab)}
            />
            {tab === "base" && (
              <section className="surface-card p-5">
                <div className="mb-5 flex items-start gap-3">
                  <Users className="mt-1 size-5 text-primary" />
                  <div>
                    <h2 className="font-semibold">HRMS Base — employee accounting branches</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Choose the Accounts branch where each employee&apos;s salary, loan, and
                      advance are processed and paid.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-3">Employee</th>
                        <th className="px-3 py-3">Employee No.</th>
                        <th className="px-3 py-3">Accounts branch</th>
                        <th className="px-3 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {employees.map((employee) => {
                        const mapping = mappings.find((item) => item.employee_id === employee.id);
                        return (
                          <tr key={employee.id}>
                            <td className="px-3 py-3 font-medium">{employeeName(employee)}</td>
                            <td className="px-3 py-3">{employee.employee_number ?? "—"}</td>
                            <td className="px-3 py-3">
                              <select
                                value={mapping?.branch_id ?? ""}
                                onChange={(event) =>
                                  void saveEmployeeBranch(employee.id, event.target.value)
                                }
                                className="h-9 min-w-52 rounded-md border border-input bg-background px-2 text-sm"
                              >
                                <option value="">Select branch</option>
                                {branches.map((branch) => (
                                  <option key={branch.id} value={branch.id}>
                                    {branch.branch_name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              {mapping ? (
                                <span className="text-emerald-700">Assigned</span>
                              ) : (
                                <span className="text-amber-700">Not assigned</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!employees.length && (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-muted-foreground">
                            No employees found in HRMS.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {tab === "rules" && (
              <div className="space-y-4">
                <section className="surface-card p-5">
                  <label className="block max-w-sm space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Branch</span>
                    <select
                      value={branchId}
                      onChange={(event) => setBranchId(event.target.value)}
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
                </section>
                {RULES.map((definition) => {
                  const rule = currentRule(definition.key);
                  const branchLedgers = ledgers.filter((ledger) => ledger.branch_id === branchId);
                  return (
                    <section key={definition.key} className="surface-card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h2 className="font-semibold">{definition.title}</h2>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {definition.description}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                          <ShieldCheck className="size-3.5" /> {branchName}
                        </span>
                      </div>
                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <label className="space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            Effective from *
                          </span>
                          <input
                            type="date"
                            value={rule.effective_from ?? ""}
                            onChange={(event) =>
                              updateRule(rule, { effective_from: event.target.value || null })
                            }
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            required
                          />
                          <span className="block text-xs text-muted-foreground">
                            Entries on or after this date can use the rule, including past entries.
                          </span>
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            Debit ledger *
                          </span>
                          <select
                            value={rule.debit_ledger_id ?? ""}
                            onChange={(event) =>
                              updateRule(rule, { debit_ledger_id: event.target.value || null })
                            }
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="">Select debit ledger</option>
                            {branchLedgers
                              .filter((ledger) => !["bank", "cash"].includes(ledger.ledger_type))
                              .map((ledger) => (
                                <option key={ledger.id} value={ledger.id}>
                                  {ledger.account_name} · {ledger.ledger_type}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">
                            Credit bank / cash account *
                          </span>
                          <select
                            value={rule.default_bank_cash_ledger_id ?? ""}
                            onChange={(event) =>
                              updateRule(rule, {
                                default_bank_cash_ledger_id: event.target.value || null,
                              })
                            }
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="">Select bank or cash</option>
                            {branchLedgers
                              .filter((ledger) => ["bank", "cash"].includes(ledger.ledger_type))
                              .map((ledger) => (
                                <option key={ledger.id} value={ledger.id}>
                                  {ledger.account_name} · {ledger.ledger_type}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) =>
                              updateRule(rule, { enabled: event.target.checked })
                            }
                          />{" "}
                          Enabled
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={rule.requires_verification}
                            onChange={(event) =>
                              updateRule(rule, { requires_verification: event.target.checked })
                            }
                          />{" "}
                          Require verification before posting
                        </label>
                      </div>
                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          onClick={() => void saveRule(rule)}
                          disabled={saving === rule.rule_key}
                          className="gap-2"
                        >
                          <Save className="size-4" />
                          {saving === rule.rule_key ? "Saving…" : "Save rule"}
                        </Button>
                      </div>
                      {rule.enabled && !rule.requires_verification && (
                        <p className="mt-3 flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 className="size-3.5" /> Posts automatically when the HRMS
                          event occurs.
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
            {tab === "verify" && (
              <section className="surface-card p-5">
                <div className="mb-5 flex items-start gap-3">
                  <WalletCards className="mt-1 size-5 text-primary" />
                  <div>
                    <h2 className="font-semibold">Verify pending HRMS entries</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      When a rule requires verification, no journal is posted until you verify it
                      here.
                    </p>
                  </div>
                </div>
                <div className="mb-4 flex justify-end">
                  <Button
                    type="button"
                    onClick={() => void verify(selectedPending)}
                    disabled={!selectedPending.length}
                  >
                    Verify selected ({selectedPending.length})
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-3">Select</th>
                        <th className="px-3 py-3">Event</th>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Branch</th>
                        <th className="px-3 py-3">Description</th>
                        <th className="px-3 py-3">Amount</th>
                        <th className="px-3 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pending.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedPending.includes(item.id)}
                              onChange={(event) =>
                                setSelectedPending((current) =>
                                  event.target.checked
                                    ? [...current, item.id]
                                    : current.filter((id) => id !== item.id),
                                )
                              }
                            />
                          </td>
                          <td className="px-3 py-3 font-medium">
                            {RULES.find((rule) => rule.key === item.event_type)?.title ??
                              item.event_type}
                          </td>
                          <td className="px-3 py-3">{item.event_date}</td>
                          <td className="px-3 py-3">
                            {branches.find((branch) => branch.id === item.branch_id)?.branch_name ??
                              "—"}
                          </td>
                          <td className="px-3 py-3">{item.description}</td>
                          <td className="px-3 py-3">
                            Rs.{" "}
                            {Number(item.amount).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                          <td className="px-3 py-3">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void verify([item.id])}
                            >
                              Verify
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {!pending.length && (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-muted-foreground">
                            No pending HRMS entries require verification.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        </div>
      </AppShell>
    </AccountsAccessGuard>
  );
}
export function AccountsRulesRoute() {
  return <AccountsRulesPage />;
}
