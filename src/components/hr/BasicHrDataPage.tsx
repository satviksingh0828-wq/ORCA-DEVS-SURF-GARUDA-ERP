import { useMemo, useState } from "react";
import { Download, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/session";
import { useEmployees, useDepartments, useAllPositions, useAllPayrolls, useAppSettings, useLoans, useAdvances, useLossDeductions, useAllLoanInstallments, useAllAdvanceInstallments } from "@/lib/hooks";
import { computeSalary, effectivePaymentStatus, fullName, type Employee } from "@/lib/types";
import { exportPayrollPdf } from "@/lib/payroll-pdf";
import { EmployeeAttendanceDetail } from "@/components/hr/attendance-history";
import { cn } from "@/lib/utils";

type Tab = "profile" | "attendance" | "payroll";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4"><span className="text-xs text-muted-foreground sm:text-sm">{label}</span><span className="text-sm sm:text-right">{value || "—"}</span></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border bg-card p-4 sm:p-6"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2><div className="space-y-2">{children}</div></section>;
}
function ReadOnlyProfile({ employee }: { employee: Employee }) {
  const { data: departments = [] } = useDepartments();
  const { data: positions = [] } = useAllPositions();
  const dept = departments.find((item) => item.id === employee.department_id);
  const position = positions.find((item) => item.id === employee.position_id);
  const salary = computeSalary(employee);
  return <div className="space-y-4"><div className="rounded-lg border bg-card p-4 sm:p-6"><div className="flex items-center gap-3"><UserRound className="size-6 text-primary" /><div><h2 className="text-2xl font-bold">{fullName(employee)}</h2><p className="text-sm text-muted-foreground">{employee.employee_number || "Employee"} · {employee.status}</p></div></div></div><Section title="Personal"><Field label="Full name" value={fullName(employee)} /><Field label="Mobile" value={employee.mobile} /><Field label="Email" value={employee.email} /><Field label="Address" value={employee.address} /><Field label="Date of birth" value={employee.dob} /><Field label="Gender" value={employee.gender} /></Section><Section title="Work and salary"><Field label="Joining date" value={employee.joining_date} /><Field label="Working hours" value={`${employee.work_start_time.slice(0, 5)} – ${employee.work_end_time.slice(0, 5)}`} /><Field label="Department" value={dept?.name} /><Field label="Position" value={position ? `${position.name}${position.is_head ? " (Head)" : ""}` : "—"} /><Field label="Basic salary" value={`₹${Number(employee.basic_salary).toLocaleString("en-IN")}`} /><Field label="Gross salary" value={`₹${salary.gross.toLocaleString("en-IN")}`} /><Field label="Deductions" value={`₹${salary.deductions.toLocaleString("en-IN")}`} /><Field label="Net salary" value={`₹${salary.net.toLocaleString("en-IN")}`} /></Section><Section title="Bank and other details"><Field label="Bank account number" value={employee.bank_account_number} /><Field label="Bank branch" value={employee.bank_branch_name} /><Field label="IFSC code" value={employee.bank_ifsc_code} /><Field label="Qualifications" value={employee.qualifications?.join(", ")} /><Field label="Emergency contact" value={employee.emergency_contact} /><Field label="Location" value={employee.location} /></Section></div>;
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
  const rows = useMemo(() => payrolls.filter((payroll) => payroll.employee_id === employee.id).sort((a, b) => b.period_start.localeCompare(a.period_start)), [employee.id, payrolls]);
  const department = departments.find((item) => item.id === employee.department_id) ?? null;
  const position = positions.find((item) => item.id === employee.position_id) ?? null;
  const employeeLoans = loans.filter((item) => item.employee_id === employee.id);
  const employeeAdvances = advances.filter((item) => item.employee_id === employee.id);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return <div className="rounded-lg border bg-card"><div className="border-b p-4"><h2 className="font-semibold">Generated payroll</h2><p className="text-xs text-muted-foreground">Paid, unpaid, and partially paid payroll records.</p></div>{rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No payroll records found.</p> : <div className="divide-y">{rows.map((payroll) => { const status = effectivePaymentStatus(payroll); return <div key={payroll.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{new Date(payroll.period_start).toLocaleDateString("en-IN")} – {new Date(payroll.period_end).toLocaleDateString("en-IN")}</p><p className="text-xs text-muted-foreground">{payroll.period_type === "half_month" ? "Half month" : "Month"} · Net ₹{Number(payroll.net).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p></div><div className="flex items-center gap-2"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", status === "paid" ? "bg-emerald-100 text-emerald-800" : status === "partial_paid" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>{status === "partial_paid" ? "Partially paid" : status === "generated" ? "Unpaid" : "Paid"}</span><Button size="sm" variant="outline" onClick={() => exportPayrollPdf({ payroll, employee, department, position, settings, loans: employeeLoans, advances: employeeAdvances, lossDeductions: deductions.filter((item) => item.payroll_id === payroll.id), loanInstallments: loanInstallments.filter((item) => employeeLoans.some((loan) => loan.id === item.loan_id)), advanceInstallments: advanceInstallments.filter((item) => employeeAdvances.some((advance) => advance.id === item.advance_id)) })}><Download className="mr-1 size-3" />Download</Button></div></div>; })}</div>}</div>;
}

export function BasicHrDataPage() {
  const { user } = useSession();
  const { data: employees = [], isLoading } = useEmployees();
  const [tab, setTab] = useState<Tab>("profile");
  const employee = employees.find((item) => item.basic_user_id === user?.id);
  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!employee) return <div className="rounded-lg border bg-card p-8 text-center"><h1 className="text-xl font-semibold">HR Data is not connected</h1><p className="mt-2 text-sm text-muted-foreground">Ask an administrator to connect your Basic User account to an employee record.</p></div>;
  return <div className="space-y-5"><header><p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">HRMS / HR Data</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">My HR Data</h1><p className="mt-2 text-sm text-muted-foreground">Read-only employee profile, attendance history, and generated payroll.</p></header><div className="flex flex-wrap gap-2 border-b pb-3">{(["profile", "attendance", "payroll"] as Tab[]).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={cn("rounded-lg border px-4 py-2 text-sm font-medium capitalize", tab === item ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{item}</button>)}</div>{tab === "profile" ? <ReadOnlyProfile employee={employee} /> : tab === "attendance" ? <EmployeeAttendanceDetail id={employee.id} /> : <PayrollTab employee={employee} />}</div>;
}
