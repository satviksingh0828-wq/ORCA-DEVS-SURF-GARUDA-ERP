import { useMemo, useState } from "react";
import {
  Banknote,
  ChevronRight,
  Download,
  Gift,
  HandCoins,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LtmsSidebar, type LtmsSidebarGroup } from "@/components/ltms/LtmsSidebar";
import { MobileTabDropdown } from "@/components/MobileTabDropdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/session";
import {
  useEmployees,
  useDepartments,
  useAllPositions,
  useAllPayrolls,
  useAppSettings,
  useLoans,
  useAdvances,
  useLossDeductions,
  useAllLoanInstallments,
  useAllAdvanceInstallments,
  useIncentiveAmounts,
} from "@/lib/hooks";
import { computeSalary, effectivePaymentStatus, fullName, type Employee } from "@/lib/types";
import { exportPayrollPdf } from "@/lib/payroll-pdf";
import { EmployeeAttendanceDetail } from "@/components/hr/attendance-history";
import { cn } from "@/lib/utils";

type Tab =
  "profile" | "attendance" | "payroll" | "loans" | "advances" | "deductions" | "incentives";
const money = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
      <span className="text-sm sm:text-right">{value || "—"}</span>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
function ReadOnlyProfile({ employee }: { employee: Employee }) {
  const { data: departments = [] } = useDepartments();
  const { data: positions = [] } = useAllPositions();
  const dept = departments.find((item) => item.id === employee.department_id);
  const position = positions.find((item) => item.id === employee.position_id);
  const salary = computeSalary(employee);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <UserRound className="size-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">{fullName(employee)}</h2>
            <p className="text-sm text-muted-foreground">
              {employee.employee_number || "Employee"} · {employee.status}
            </p>
          </div>
        </div>
      </div>
      <Section title="Personal">
        <Field label="Full name" value={fullName(employee)} />
        <Field label="Mobile" value={employee.mobile} />
        <Field label="Email" value={employee.email} />
        <Field label="Address" value={employee.address} />
        <Field label="Date of birth" value={employee.dob} />
        <Field label="Gender" value={employee.gender} />
      </Section>
      <Section title="Work and salary">
        <Field label="Joining date" value={employee.joining_date} />
        <Field
          label="Working hours"
          value={`${employee.work_start_time.slice(0, 5)} – ${employee.work_end_time.slice(0, 5)}`}
        />
        <Field label="Department" value={dept?.name} />
        <Field
          label="Position"
          value={position ? `${position.name}${position.is_head ? " (Head)" : ""}` : "—"}
        />
        <Field label="Basic salary" value={money(employee.basic_salary)} />
        <Field label="Gross salary" value={money(salary.gross)} />
        <Field label="Deductions" value={money(salary.deductions)} />
        <Field label="Net salary" value={money(salary.net)} />
      </Section>
      <Section title="Bank and other details">
        <Field label="Bank account number" value={employee.bank_account_number} />
        <Field label="Bank branch" value={employee.bank_branch_name} />
        <Field label="IFSC code" value={employee.bank_ifsc_code} />
        <Field label="Qualifications" value={employee.qualifications?.join(", ")} />
        <Field label="Emergency contact" value={employee.emergency_contact} />
        <Field label="Location" value={employee.location} />
      </Section>
    </div>
  );
}
function Status({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium capitalize">
      {children}
    </span>
  );
}
function LoansTab({ employee, advance = false }: { employee: Employee; advance?: boolean }) {
  const { data: loans = [], isLoading: loansLoading } = useLoans();
  const { data: advances = [], isLoading: advancesLoading } = useAdvances();
  const { data: loanInst = [] } = useAllLoanInstallments();
  const { data: advanceInst = [] } = useAllAdvanceInstallments();
  const records = advance ? advances : loans;
  const isLoading = advance ? advancesLoading : loansLoading;
  const rows = records.filter((item) => item.employee_id === employee.id);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No {advance ? "advances" : "loans"} found.
        </div>
      ) : (
        rows.map((record) => {
          const installments = advance
            ? advanceInst.filter((item) => item.advance_id === record.id)
            : loanInst.filter((item) => item.loan_id === record.id);
          const paid = installments.filter((item) =>
            ["paid_manual", "paid_payroll"].includes(item.status),
          ).length;
          const partial = installments.filter((item) =>
            ["paid_partial_manual", "partial_skipped", "payroll_partial_skipped"].includes(
              item.status,
            ),
          ).length;
          return (
            <section key={record.id} className="rounded-lg border bg-card p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{advance ? "Advance" : "Loan"}</h2>
                  <p className="text-xs text-muted-foreground">
                    Started {new Date(record.start_date).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <Status>{record.status}</Status>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Principal" value={money(record.principal)} />
                <Field label="EMI" value={money(record.emi)} />
                <Field label="Total payable" value={money(record.total_payable)} />
                <Field
                  label="Installments"
                  value={`${paid} paid / ${partial} partial / ${installments.length} total`}
                />
              </div>
              {installments.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    EMI schedule
                  </p>
                  <div className="space-y-2">
                    {installments.map((item) => (
                      <div key={item.id} className="flex flex-wrap justify-between gap-2 text-sm">
                        <span>
                          EMI {item.emi_number} ·{" "}
                          {new Date(item.due_date).toLocaleDateString("en-IN")}
                        </span>
                        <span className="flex gap-2">
                          <span>{money(item.amount)}</span>
                          <Status>{item.status.replaceAll("_", " ")}</Status>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
function DeductionsTab({ employee }: { employee: Employee }) {
  const { data: records = [], isLoading } = useLossDeductions();
  const rows = records.filter((item) => item.employee_id === employee.id);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="font-semibold">Loss deductions</h2>
        <p className="text-xs text-muted-foreground">
          Read-only deduction records and processing status.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No loss deductions found.</p>
      ) : (
        <div className="divide-y">
          {rows.map((item) => (
            <div key={item.id} className="flex flex-wrap justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium">{item.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.journal_date).toLocaleDateString("en-IN")}
                  {item.deducted_on
                    ? ` · deducted ${new Date(item.deducted_on).toLocaleDateString("en-IN")}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{money(item.amount)}</span>
                <Status>{item.status}</Status>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function IncentivesTab({ employee }: { employee: Employee }) {
  const { data: records = [], isLoading } = useIncentiveAmounts(employee.id);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="font-semibold">Incentives</h2>
        <p className="text-xs text-muted-foreground">
          Read-only incentive records and payroll status.
        </p>
      </div>
      {records.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No incentives found.</p>
      ) : (
        <div className="divide-y">
          {records.map((item) => (
            <div key={item.id} className="flex flex-wrap justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium">{item.reason || "Incentive"}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.journal_date).toLocaleDateString("en-IN")}
                  {item.payroll_id ? ` · payroll ${item.payroll_id.slice(0, 8)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{money(item.amount)}</span>
                <Status>{item.status}</Status>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function PayrollTab({ employee }: { employee: Employee }) {
  const { data: payrolls = [], isLoading } = useAllPayrolls();
  const { data: departments = [] } = useDepartments();
  const { data: positions = [] } = useAllPositions();
  const { data: settings } = useAppSettings();
  const { data: loans = [] } = useLoans();
  const { data: advances = [] } = useAdvances();
  const { data: deductions = [] } = useLossDeductions();
  const { data: loanInstallments = [] } = useAllLoanInstallments();
  const { data: advanceInstallments = [] } = useAllAdvanceInstallments();
  const rows = useMemo(
    () =>
      payrolls
        .filter((payroll) => payroll.employee_id === employee.id)
        .sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [employee.id, payrolls],
  );
  const department = departments.find((item) => item.id === employee.department_id) ?? null;
  const position = positions.find((item) => item.id === employee.position_id) ?? null;
  const employeeLoans = loans.filter((item) => item.employee_id === employee.id);
  const employeeAdvances = advances.filter((item) => item.employee_id === employee.id);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="font-semibold">Generated payroll</h2>
        <p className="text-xs text-muted-foreground">
          Paid, unpaid, and partially paid payroll records.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No payroll records found.</p>
      ) : (
        <div className="divide-y">
          {rows.map((payroll) => {
            const status = effectivePaymentStatus(payroll);
            return (
              <div
                key={payroll.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-medium">
                    {new Date(payroll.period_start).toLocaleDateString("en-IN")} –{" "}
                    {new Date(payroll.period_end).toLocaleDateString("en-IN")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {payroll.period_type === "half_month" ? "Half month" : "Month"} · Net{" "}
                    {money(payroll.net)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Status>
                    {status === "partial_paid"
                      ? "Partially paid"
                      : status === "generated"
                        ? "Unpaid"
                        : "Paid"}
                  </Status>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      exportPayrollPdf({
                        payroll,
                        employee,
                        department,
                        position,
                        settings,
                        loans: employeeLoans,
                        advances: employeeAdvances,
                        lossDeductions: deductions.filter((item) => item.payroll_id === payroll.id),
                        loanInstallments: loanInstallments.filter((item) =>
                          employeeLoans.some((loan) => loan.id === item.loan_id),
                        ),
                        advanceInstallments: advanceInstallments.filter((item) =>
                          employeeAdvances.some((advance) => advance.id === item.advance_id),
                        ),
                      })
                    }
                  >
                    <Download className="mr-1 size-3" />
                    Download
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function BasicHrDataPage() {
  const { user } = useSession();
  const { data: employees = [], isLoading } = useEmployees();
  const [tab, setTab] = useState<Tab>("profile");
  const [navOpen, setNavOpen] = useState(true);
  const employee = employees.find((item) => item.basic_user_id === user?.id);
  const tabs: Array<{ id: Tab; label: string; description: string; icon: typeof UserRound }> = [
    { id: "profile", label: "Profile", description: "Read-only employee details", icon: UserRound },
    {
      id: "attendance",
      label: "Attendance",
      description: "Day, week, and month history",
      icon: UserRound,
    },
    { id: "payroll", label: "Payroll", description: "Generated payroll records", icon: Banknote },
    { id: "loans", label: "Loans", description: "Loan and EMI schedule", icon: HandCoins },
    { id: "advances", label: "Advances", description: "Advance and EMI schedule", icon: Banknote },
    {
      id: "deductions",
      label: "Loss deductions",
      description: "Deduction records",
      icon: ShieldAlert,
    },
    { id: "incentives", label: "Incentives", description: "Incentive records", icon: Gift },
  ];
  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!employee)
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold">HR Data is not connected</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask an administrator to connect your Basic User account to an employee record.
        </p>
      </div>
    );
  const active = tabs.find((item) => item.id === tab) ?? tabs[0];
  const mobileTabs = tabs.map((item) => ({
    id: item.id,
    label: item.label,
    desc: item.description,
    icon: item.icon,
  }));
  const sidebarGroups: LtmsSidebarGroup[] = [
    {
      section: "hr-data",
      label: "HR Data",
      items: tabs.map((item) => ({ id: item.id, label: item.label })),
    },
  ];
  return (
    <AppShell
      variant="ltms"
      shellTitle="HRMS"
      breadcrumb={
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/home" className="hover:text-foreground">
            Workspace
          </Link>
          <ChevronRight className="size-3.5" />
          <Link to="/hrms" className="hover:text-foreground">
            HRMS
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">HR Data</span>
        </span>
      }
      headerEnd={
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          title={navOpen ? "Hide sidebar" : "Show sidebar"}
          className="hidden items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
        >
          {navOpen ? (
            <>
              <PanelLeftClose className="size-3.5" />
              <span>Hide sidebar</span>
            </>
          ) : (
            <>
              <PanelLeftOpen className="size-3.5" />
              <span>Show sidebar</span>
            </>
          )}
        </button>
      }
    >
      <div
        className={`ltms-reference-shell grid items-start gap-6 ${navOpen ? "lg:grid-cols-[192px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {navOpen && (
          <LtmsSidebar
            section="hr-data"
            activeTabId={tab}
            onSelectTab={(id) => setTab(id as Tab)}
            label="HR data"
            groups={sidebarGroups}
          />
        )}
        <div className="ltms-reference-content min-w-0">
          {" "}
          <div className="mb-6 lg:hidden">
            <MobileTabDropdown
              tabs={mobileTabs}
              activeId={active.id}
              label="HR Data"
              onChange={(id) => setTab(id as Tab)}
            />
          </div>
          <header className="mb-6">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
              HRMS / HR Data
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">My HR Data</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Read-only employee profile, attendance, payroll, loans, advances, deductions, and
              incentives.
            </p>
          </header>
          {tab === "profile" ? (
            <ReadOnlyProfile employee={employee} />
          ) : tab === "attendance" ? (
            <EmployeeAttendanceDetail id={employee.id} />
          ) : tab === "payroll" ? (
            <PayrollTab employee={employee} />
          ) : tab === "loans" ? (
            <LoansTab employee={employee} />
          ) : tab === "advances" ? (
            <LoansTab employee={employee} advance />
          ) : tab === "deductions" ? (
            <DeductionsTab employee={employee} />
          ) : (
            <IncentivesTab employee={employee} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
