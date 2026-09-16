export type EmployeeStatus = 'active' | 'inactive';
export type Gender = 'male' | 'female' | 'other';

export interface Employee {
  id: string;
  employee_number: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  mobile: string;
  email?: string | null;
  address: string;
  dob: string;
  gender: Gender;
  joining_date: string;
  work_start_time: string;
  work_end_time: string;
  basic_salary: number;
  hra: number;
  travel_allowance: number;
  special_allowance: number;
  other_allowance: number;
  pf_deduction: number;
  tax_deduction: number;
  paid_holidays_per_month: number;
  /** Fixed deduction per unpaid day (half for half-day). If 0, falls back to pro-rata gross/workingDays. */
  unpaid_leave_deduction_rate: number;
  /** Legacy configured payout rate; payroll payout uses the calculated daily salary rate. */
  paid_leave_payout_rate: number;
  /** Legacy configured extra-work rate; payroll payout uses the calculated daily salary rate. */
  pay_per_extra_work_day: number;
  emergency_contact: string | null;
  status: EmployeeStatus;
  inactive_reason: string | null;
  date_of_leaving: string | null;
  department_id: string | null;
  accounting_branch_id: string | null;
  position_id: string | null;
  /** Employee's work location (branch, site, city, etc.) */
  location: string | null;
  bank_account_number: string | null;
  bank_branch_name: string | null;
  bank_branch_address: string | null;
  bank_ifsc_code: string | null;
  aadhaar_number: string | null;
  pan_number: string | null;
  /** Optional Basic app user linked to this employee. */
  basic_user_id?: string | null;
  qualifications: string[];
  created_at: string;
  updated_at: string;
}

export type EmployeeInput = Omit<Employee, 'id' | 'created_at' | 'updated_at'>;

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  name: string;
  address: string;
  working_days_of_week: string[];
  reports_to_department_id: string | null;
  /** Geofencing latitude for attendance module sync */
  latitude: number | null;
  /** Geofencing longitude for attendance module sync */
  longitude: number | null;
  /** Device ID assigned by the attendance module service after sync */
  device_id: string | null;
  /** Device password assigned by the attendance module service after sync */
  device_password: string | null;
  /** Optional TMS branch associated with this HR department. */
  branch_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type DepartmentInput = Omit<Department, 'id' | 'created_at' | 'updated_at'>;

export interface Position {
  id: string;
  department_id: string;
  name: string;
  is_head: boolean;
  reports_to_position_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PositionInput = Omit<Position, 'id' | 'created_at' | 'updated_at'>;

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'extra_work' | 'half_extra_work';

export interface Attendance {
  id: string;
  employee_id: string;
  date: string;
  status: AttendanceStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}
export type AttendanceInput = Omit<Attendance, 'id' | 'created_at' | 'updated_at'>;

export interface Holiday {
  id: string;
  date: string;
  name: string;
  description: string | null;
  /** Department IDs that are EXEMPT from this holiday (it is a normal working day for them). */
  exempt_department_ids: string[] | null;
  created_at: string;
  updated_at: string;
}
export type HolidayInput = Omit<Holiday, 'id' | 'created_at' | 'updated_at'>;

export interface AppSettings {
  id: string;
  company_name: string;
  company_address: string;
  /** Attendance module integration */
  attendance_module_enabled: boolean | null;
  attendance_module_url: string | null;
  attendance_module_key: string | null;
  /** WhatsApp automation */
  wa_auto_send_payroll: boolean | null;
  /** Email automation */
  email_auto_send_payroll?: boolean | null;
  wa_send_on_payment: boolean | null;
  wa_send_loan: boolean | null;
  wa_send_advance: boolean | null;
  wa_send_loss_deduction: boolean | null;
  wa_send_attendance_monthly: boolean | null;
  /** Admin-controlled full-app WebAuthn/Windows Hello gate. */
  passkey_protection_enabled?: boolean | null;
  created_at: string;
  updated_at: string;
}
export type AppSettingsInput = Pick<
  AppSettings,
  'company_name' | 'company_address' |
  'attendance_module_enabled' | 'attendance_module_url' | 'attendance_module_key' |
  'wa_auto_send_payroll' | 'email_auto_send_payroll' | 'wa_send_on_payment' | 'wa_send_loan' |
  'wa_send_advance' | 'wa_send_loss_deduction' | 'wa_send_attendance_monthly' |
  'passkey_protection_enabled'
>;

/** A single check-in or check-out event fetched from the attendance module */
export interface CheckinLog {
  id: string;
  employee_number: string;
  employee_name: string;
  department: string;
  kind: 'check_in' | 'check_out';
  logged_at: string;  // ISO UTC timestamp
  date: string;       // YYYY-MM-DD local date (derived on save)
  created_at: string;
}

export type PayrollPeriodType = 'month' | 'half_month';
export type InterestMethod = 'simple' | 'compound' | 'none';
export type LoanStatus = 'active' | 'paid';
export type LossDedStatus = 'pending' | 'deducted' | 'paid';

/**
 * Installment statuses:
 *   pending              — not yet paid
 *   paid_manual          — fully paid by direct cash (skipped by payroll)
 *   paid_partial_manual  — partially paid by cash; remaining balance deducted via payroll
 *   paid_payroll         — fully settled via payroll deduction (may have had a prior partial manual payment)
 */
export type InstallmentStatus =
  | 'pending'
  | 'paid_manual'
  | 'paid_payroll'
  | 'paid_partial_manual'
  /** Full EMI deferred — obligation moved to a tail installment at the end of the schedule. */
  | 'skipped'
  /** Partial cash received; remainder deferred — tail installment carries the balance. */
   | 'partial_skipped'
   /** Partial amount deferred by payroll generation. */
   | 'payroll_partial_skipped';

/**
 * Payroll payment status:
 *   generated    — payroll calculated and saved; salary not yet disbursed to bank
 *   paid         — full net salary paid (bank entry done)
 *   partial_paid — partial amount disbursed; remainder pending
 *
 * NOTE: existing records with no payment_status field are treated as 'paid' for backwards compat.
 */
export type PayrollPaymentStatus = 'generated' | 'paid' | 'partial_paid';

export interface Payroll {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  period_type: PayrollPeriodType;
  basic_salary: number;
  hra: number;
  travel_allowance: number;
  special_allowance: number;
  other_allowance: number;
  gross: number;
  pf_deduction: number;
  tax_deduction: number;
  loan_deduction: number;
  advance_deduction: number;
  loss_deduction: number;
  unpaid_leave_deduction: number;
  /** Separate payout for paid leave taken in this payroll period. */
  paid_leave_payout_amount: number;
  /** Final settlement payout for all remaining paid leave balance. */
  paid_leave_final_settlement_amount: number;
  /** Calendar-day salary rate for this payroll month, used to value its accrued leave. */
  paid_leave_daily_rate: number;
  net: number;
  working_days: number;
  present_days: number;
  paid_leaves_used: number;
  paid_leaves_left: number;
  unpaid_leaves: number;
  /** Snapshot of employee's unpaid_leave_deduction_rate at generation time. */
  unpaid_leave_deduction_rate: number;
  /** Snapshot of employee's paid_leave_payout_rate at generation time. */
  paid_leave_payout_rate: number;
  /** Number of extra days worked on non-working days (weekends / holidays). */
  extra_work_days: number;
  /** Pay earned for extra work days (extra_work_days × pay_per_extra_work_day). */
  extra_work_pay: number;
  /**
   * Payment status — new field; old records default to 'paid' for backwards compat.
   * Use effectivePaymentStatus() helper instead of reading this directly.
   */
  payment_status: PayrollPaymentStatus | null;
  /** Date the salary was actually transferred (bank/cash). Null until marked paid. */
  payment_date: string | null;
  /** Actual amount disbursed. Used for partial payments; null means full net. */
  payment_amount: number | null;
  /** Full chronological log of every payment made against this payroll. */
  payment_history?: { date: string; amount: number }[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export type PayrollInput = Omit<Payroll, 'id' | 'created_at' | 'updated_at'>;

export interface PaidLeaveAccrual {
  id: string;
  employee_id: string;
  accrual_month: string;
  earned_units: number;
  used_units: number;
  daily_pay_rate: number;
  source_payroll_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Returns the effective payment status, defaulting old records (null) to 'paid'. */
export function effectivePaymentStatus(p: Pick<Payroll, 'payment_status'>): PayrollPaymentStatus {
  return p.payment_status ?? 'paid';
}

export interface Loan {
  id: string;
  employee_id: string;
  /** Branch bank/cash ledger used to disburse the loan or advance. */
  disbursement_ledger_id: string | null;
  principal: number;
  interest_rate: number;
  interest_method: InterestMethod;
  months: number;
  emi: number;
  total_payable: number;
  start_date: string;
  paid_months: number;
  status: LoanStatus;
  paid_off_date: string | null;
  discount_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export type LoanInput = Omit<Loan, 'id' | 'created_at' | 'updated_at'>;
export type Advance = Loan;
export type AdvanceInput = LoanInput;

/** One EMI installment for a loan — strict period-wise tracking. */
export interface LoanInstallment {
  id: string;
  loan_id: string;
  emi_number: number;   // 1-based
  due_year: number;
  due_month: number;    // 0-11 (JS month)
  due_date: string;     // YYYY-MM-DD
  status: InstallmentStatus;
  payroll_id: string | null;  // set when paid via payroll generation
  amount: number;
  /**
   * Amount already paid directly by cash (partial payment).
   * Relevant for 'paid_partial_manual', 'partial_skipped', and preserved on 'paid_payroll'.
   * Old records without this field default to 0.
  */
  paid_amount: number;
  direct_payment_journal_entry_id?: string | null;
  direct_payment_ledger_id?: string | null;
  /**
   * True for installments auto-generated at the end of the schedule
   * to absorb deferred amounts from skipped/partial_skipped periods.
   * Old records without this field default to false.
   */
  skip_generated?: boolean;
  created_at: string;
  updated_at: string;
}
export type LoanInstallmentInput = Omit<LoanInstallment, 'id' | 'created_at' | 'updated_at'>;

/** One EMI installment for an advance — same shape as LoanInstallment but linked to advance_id. */
export interface AdvanceInstallment {
  id: string;
  advance_id: string;
  emi_number: number;
  due_year: number;
  due_month: number;
  due_date: string;
  status: InstallmentStatus;
  payroll_id: string | null;
  amount: number;
  /** Amount already paid directly (partial payment). Old records default to 0. */
  paid_amount: number;
  direct_payment_journal_entry_id?: string | null;
  direct_payment_ledger_id?: string | null;
  /** True for tail installments auto-generated to absorb deferred skip amounts. */
  skip_generated?: boolean;
  created_at: string;
  updated_at: string;
}
export type AdvanceInstallmentInput = Omit<AdvanceInstallment, 'id' | 'created_at' | 'updated_at'>;

export interface LossDeduction {
  id: string;
  employee_id: string;
  amount: number;
  reason: string;
  /** Date used only for the automatic accounting journal. */
  journal_date: string;
  status: LossDedStatus;
  payroll_id: string | null;
  deducted_on: string | null;
  created_at: string;
  updated_at: string;
}
export type LossDeductionInput = Omit<LossDeduction, 'id' | 'created_at' | 'updated_at'>;

export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function fullName(e: Pick<Employee, 'first_name' | 'middle_name' | 'last_name'>) {
  return [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ');
}

export function computeSalary(e: Pick<Employee,
  'basic_salary' | 'hra' | 'travel_allowance' | 'special_allowance' | 'other_allowance' | 'pf_deduction' | 'tax_deduction'
>) {
  const n = (v: number | string) => Number(v) || 0;
  const gross = n(e.basic_salary) + n(e.hra) + n(e.travel_allowance) + n(e.special_allowance) + n(e.other_allowance);
  const deductions = n(e.pf_deduction) + n(e.tax_deduction);
  return { gross, deductions, net: gross - deductions };
}

export function dailyHours(e: Pick<Employee, 'work_start_time' | 'work_end_time'>) {
  const parse = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h + (m || 0) / 60;
  };
  const s = parse(e.work_start_time);
  const en = parse(e.work_end_time);
  return Math.max(0, en - s);
}

export function ageFrom(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}
