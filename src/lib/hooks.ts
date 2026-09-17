import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as any;
import type {
  Employee, EmployeeInput, Department, DepartmentInput, Position, PositionInput,
  Attendance, AttendanceStatus, Holiday, HolidayInput, AppSettings, AppSettingsInput,
  Payroll, PayrollInput, Loan, LoanInput, Advance, AdvanceInput,
  LossDeduction, LossDeductionInput,
  LoanInstallment, LoanInstallmentInput, AdvanceInstallment, AdvanceInstallmentInput,
  CheckinLog,
} from './types';
import { generateInstallmentSchedule } from './payroll-utils';
import { ymd } from './attendance-utils';
import { logAction } from './log-actions';

function hrLog(action: string, entityType: string): void {
  logAction(action, entityType);
}

/* ── Employees ────────────────────────────────────────────────────────────── */

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await sb.from('employees').select('*').order('first_name');
      if (error) throw error;
      return data as Employee[];
    },
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: ['employees', id],
    queryFn: async () => {
      const { data, error } = await sb.from('employees').select('*').eq('id', id).single();
      if (error) throw error;
      return data as Employee;
    },
    enabled: !!id,
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: EmployeeInput) => {
      const { data, error } = await sb.from('employees').insert(values).select().single();
      if (error) throw error;
      return data as Employee;
    },
    onSuccess: () => {
      hrLog('created', 'employee');
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<EmployeeInput> }) => {
      const { data, error } = await sb.from('employees').update(values).eq('id', id).select().single();
      if (error) throw error;
      return data as Employee;
    },
    onSuccess: (_r, v) => {
      hrLog('updated', 'employee');
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employees', v.id] });
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from('employees').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('deleted', 'employee');
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

export function useBulkCreateEmployees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: EmployeeInput[]) => {
      if (!rows.length) return 0;
      const { error } = await sb.from('employees').insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: () => {
      hrLog('imported', 'employee');
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

/* ── Departments ──────────────────────────────────────────────────────────── */

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await sb.from('departments').select('*').order('name');
      if (error) throw error;
      return data as Department[];
    },
  });
}

export function useDepartment(id: string) {
  return useQuery({
    queryKey: ['departments', id],
    queryFn: async () => {
      const { data, error } = await sb.from('departments').select('*').eq('id', id).single();
      if (error) throw error;
      return data as Department;
    },
    enabled: !!id,
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from('departments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('deleted', 'department');
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['positions'] });
    },
  });
}

export function useBulkCreateDepartments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Array<{ department: DepartmentInput; reportsToDepartment: string | null; positions: Array<{ name: string; reportsTo: string | null; isHead: boolean }> }>) => {
      if (!rows.length) return 0;
      const insertRows = rows.map(r => r.department);
      const { data, error } = await sb.from('departments').insert(insertRows).select();
      if (error) throw error;
      const created = data as Department[];
      const createdDepartmentByName = new Map(created.map(d => [d.name.toLowerCase(), d.id]));
      for (let i = 0; i < created.length; i++) {
        const parentName = rows[i].reportsToDepartment;
        if (!parentName) continue;
        const parentId = createdDepartmentByName.get(parentName.toLowerCase());
        if (!parentId) throw new Error(`Reports To Department "${parentName}" was not found in this workbook.`);
        if (parentId === created[i].id) throw new Error(`Department "${created[i].name}" cannot report to itself.`);
        const { error: departmentUpdateError } = await sb.from('departments')
          .update({ reports_to_department_id: parentId })
          .eq('id', created[i].id);
        if (departmentUpdateError) throw departmentUpdateError;
      }
      for (let i = 0; i < created.length; i++) {
        const specs = rows[i].positions;
        const { data: made, error: pErr } = await sb.from('positions').insert(specs.map(p => ({
          department_id: created[i].id, name: p.name, is_head: p.isHead, reports_to_position_id: null,
        }))).select();
        if (pErr) throw pErr;
        const idByName = new Map((made as Position[]).map(p => [p.name.toLowerCase(), p.id]));
        for (const spec of specs) {
          if (!spec.reportsTo) continue;
          const id = idByName.get(spec.name.toLowerCase());
          const reportsToId = idByName.get(spec.reportsTo.toLowerCase());
          if (id && reportsToId) {
            const { error: updateError } = await sb.from('positions').update({ reports_to_position_id: reportsToId }).eq('id', id);
            if (updateError) throw updateError;
          }
        }
      }
      return rows.length;
    },
    onSuccess: () => {
      hrLog('imported', 'department');
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['positions'] });
    },
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<Department> }) => {
      const { error } = await sb.from('departments').update(values).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('updated', 'department');
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
  });
}

/* ── Positions ────────────────────────────────────────────────────────────── */

export function usePositions(departmentId?: string) {
  return useQuery({
    queryKey: ['positions', departmentId ?? 'all'],
    queryFn: async () => {
      const q = sb.from('positions').select('*').order('name');
      const { data, error } = departmentId ? await q.eq('department_id', departmentId) : await q;
      if (error) throw error;
      return data as Position[];
    },
  });
}

export function useAllPositions() {
  return useQuery({
    queryKey: ['positions', 'all'],
    queryFn: async () => {
      const { data, error } = await sb.from('positions').select('*').order('name');
      if (error) throw error;
      return data as Position[];
    },
  });
}

export interface DepartmentSavePayload {
  department: DepartmentInput;
  positions: Array<PositionInput & { tempId: string }>;
  reportsToMap: Record<string, string | null>;
}

export function useSaveDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id?: string; payload: DepartmentSavePayload }) => {
      let departmentId = id;
      if (id) {
        const { error } = await sb.from('departments').update(payload.department).eq('id', id);
        if (error) throw error;
        const { error: delErr } = await sb.from('positions').delete().eq('department_id', id);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await sb.from('departments').insert(payload.department).select().single();
        if (error) throw error;
        departmentId = (data as Department).id;
      }
      if (!departmentId) throw new Error('Missing department id');

      const rows = payload.positions.map(p => ({
        department_id: departmentId,
        name: p.name,
        is_head: p.is_head,
        reports_to_position_id: null as string | null,
      }));
      const { data: created, error: insErr } = await sb.from('positions').insert(rows).select();
      if (insErr) throw insErr;
      const createdRows = created as Position[];
      const idMap: Record<string, string> = {};
      payload.positions.forEach((p, i) => { idMap[p.tempId] = createdRows[i].id; });
      const updates = payload.positions
        .map(p => ({ p, reportsTempId: payload.reportsToMap[p.tempId] }))
        .filter(x => x.reportsTempId && idMap[x.reportsTempId]);
      for (const u of updates) {
        await sb.from('positions')
          .update({ reports_to_position_id: idMap[u.reportsTempId!] })
          .eq('id', idMap[u.p.tempId]);
      }
      return departmentId;
    },
    onSuccess: () => {
      hrLog('saved', 'department');
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['positions'] });
    },
  });
}

/* ── Attendance ───────────────────────────────────────────────────────────── */

/** Alias for useAttendanceByDate — used by Automarker */
export function useAttendance(date: string) {
  return useAttendanceByDate(date);
}

export function useAttendanceByDate(date: string) {
  return useQuery({
    queryKey: ['attendance', 'date', date],
    queryFn: async () => {
      const { data, error } = await sb.from('attendance').select('*').eq('date', date);
      if (error) throw error;
      return data as Attendance[];
    },
    enabled: !!date,
  });
}

export function useAttendanceForEmployee(employeeId: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ['attendance', 'emp', employeeId, from ?? '-', to ?? '-'],
    queryFn: async () => {
      let q = sb.from('attendance').select('*').eq('employee_id', employeeId);
      if (from) q = q.gte('date', from);
      if (to)   q = q.lte('date', to);
      const { data, error } = await q.order('date', { ascending: false });
      if (error) throw error;
      return data as Attendance[];
    },
    enabled: !!employeeId,
  });
}

export function useAllAttendance(from?: string, to?: string) {
  return useQuery({
    queryKey: ['attendance', 'range', from ?? '-', to ?? '-'],
    queryFn: async () => {
      let q = sb.from('attendance').select('*');
      if (from) q = q.gte('date', from);
      if (to)   q = q.lte('date', to);
      const { data, error } = await q;
      if (error) throw error;
      return data as Attendance[];
    },
  });
}

export function useUpsertAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Array<{ employee_id: string; date: string; status: AttendanceStatus }>) => {
      const { error } = await sb.from('attendance').upsert(rows, { onConflict: 'employee_id,date' });
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('saved', 'attendance');
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employee_id, date }: { employee_id: string; date: string }) => {
      const { error } = await sb.from('attendance').delete().eq('employee_id', employee_id).eq('date', date);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('deleted', 'attendance');
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

/* ── Holidays ─────────────────────────────────────────────────────────────── */

export function useHolidays() {
  return useQuery({
    queryKey: ['holidays'],
    queryFn: async () => {
      const { data, error } = await sb.from('holidays').select('*').order('date');
      if (error) throw error;
      return data as Holiday[];
    },
  });
}

export function useCreateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: HolidayInput) => {
      const { data, error } = await sb.from('holidays').insert(values).select().single();
      if (error) throw error;
      return data as Holiday;
    },
    onSuccess: () => {
      hrLog('created', 'holiday');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
  });
}

export function useBulkCreateHolidays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: HolidayInput[]) => {
      if (!rows.length) return 0;
      const { error } = await sb.from('holidays').upsert(rows, { onConflict: 'date' });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: () => {
      hrLog('imported', 'holiday');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
  });
}

export function useUpdateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<HolidayInput> }) => {
      const { error } = await sb.from('holidays').update(values).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('updated', 'holiday');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from('holidays').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('deleted', 'holiday');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    },
  });
}

/* ── Settings ─────────────────────────────────────────────────────────────── */

export function useAppSettings() {
  return useQuery({
    queryKey: ['app_settings'],
    queryFn: async () => {
      const { data, error } = await sb.from('app_settings').select('*').limit(1).maybeSingle();
      if (error) throw error;
      return data as AppSettings | null;
    },
  });
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: AppSettingsInput }) => {
      if (id) {
        const { error } = await sb.from('app_settings').update(values).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('app_settings').insert(values);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      hrLog('updated', 'hr_settings');
      qc.invalidateQueries({ queryKey: ['app_settings'] });
    },
  });
}

/* ── Payrolls ─────────────────────────────────────────────────────────────── */

export function usePayrolls(employeeId?: string) {
  return useQuery({
    queryKey: ['payrolls', employeeId ?? 'all'],
    queryFn: async () => {
      let q = sb.from('payrolls').select('*').order('period_start', { ascending: false });
      if (employeeId) q = q.eq('employee_id', employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Payroll[];
    },
  });
}

export function usePaidLeaveAccruals(employeeId?: string) {
  return useQuery({
    queryKey: ['paid_leave_accruals', employeeId ?? 'all'],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      let q = sb.from('paid_leave_accruals').select('*').order('accrual_month', { ascending: true });
      if (employeeId) q = q.eq('employee_id', employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return data as import('./types').PaidLeaveAccrual[];
    },
  });
}

export function useAllPayrolls() {
  return useQuery({
    queryKey: ['payrolls', 'all'],
    queryFn: async () => {
      const { data, error } = await sb.from('payrolls').select('*');
      if (error) throw error;
      return data as Payroll[];
    },
  });
}

export function useCreatePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: PayrollInput) => {
      const payload = {
        ...values,
        payment_status: values.payment_status || 'generated',
      };
      const { data, error } = await sb.from('payrolls').insert(payload).select().single();
      if (error) throw error;
      return data as Payroll;
    },
    onSuccess: () => {
      hrLog('created', 'payroll');
      qc.invalidateQueries({ queryKey: ['payrolls'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: ['loss_deductions'] });
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
    },
  });
}

/** Mark a payroll as paid (full or partial) */
export function useMarkPayrollPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      payrollId,
      paymentDate,
      paymentAmount,
      paymentLedgerId,
      partial,
      historyEntry,
      existingHistory,
    }: {
      payrollId: string;
      paymentDate: string;
      paymentAmount: number;
      paymentLedgerId: string;
      partial: boolean;
      /** The incentiveal amount being paid in this transaction */
      historyEntry: { date: string; amount: number };
      /** Existing payment_history from the payroll record */
      existingHistory: { date: string; amount: number }[] | null;
    }) => {
      const newHistory = [...(existingHistory ?? []), historyEntry];
      const { error } = await sb.from('payrolls').update({
        payment_status: partial ? 'partial_paid' : 'paid',
        payment_date: paymentDate,
        payment_amount: paymentAmount,
        payment_ledger_id: paymentLedgerId,
        payment_history: newHistory,
      }).eq('id', payrollId);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('paid', 'payroll');
      qc.invalidateQueries({ queryKey: ['payrolls'] });
    },
  });
}

export function useDeletePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Load payroll record for reference
      const { data: pRow, error: pErr } = await sb.from('payrolls').select('*').eq('id', id).single();
      if (pErr) throw pErr;
      const p = pRow as Payroll;

      // 1. Reset loss deductions linked to this payroll
      const { data: lossRows } = await sb.from('loss_deductions').select('*').eq('payroll_id', id);
      for (const d of ((lossRows ?? []) as LossDeduction[])) {
        await sb.from('loss_deductions').update({ status: 'pending', payroll_id: null, deducted_on: null }).eq('id', d.id);
      }

      // 2. Reset loan installments that were paid via this payroll
      const { data: lInstRows } = await sb.from('loan_installments').select('*').eq('payroll_id', id);
      for (const inst of ((lInstRows ?? []) as LoanInstallment[])) {
        // Reset to pending, clearing partial payment info too
        await sb.from('loan_installments').update({
          status: 'pending',
          payroll_id: null,
          paid_amount: 0,
        }).eq('id', inst.id);
        // Recalculate paid_months for the loan
        const { data: allInst } = await sb.from('loan_installments').select('*').eq('loan_id', inst.loan_id);
        const paidCount = ((allInst ?? []) as LoanInstallment[]).filter(i => i.id !== inst.id && i.status !== 'pending').length;
        await sb.from('loans').update({ paid_months: paidCount, status: 'active', paid_off_date: null }).eq('id', inst.loan_id);
      }

      // 3. Reset advance installments that were paid via this payroll
      const { data: aInstRows } = await sb.from('advance_installments').select('*').eq('payroll_id', id);
      for (const inst of ((aInstRows ?? []) as AdvanceInstallment[])) {
        await sb.from('advance_installments').update({
          status: 'pending',
          payroll_id: null,
          paid_amount: 0,
        }).eq('id', inst.id);
        const { data: allInst } = await sb.from('advance_installments').select('*').eq('advance_id', inst.advance_id);
        const paidCount = ((allInst ?? []) as AdvanceInstallment[]).filter(i => i.id !== inst.id && i.status !== 'pending').length;
        await sb.from('advances').update({ paid_months: paidCount, status: 'active', paid_off_date: null }).eq('id', inst.advance_id);
      }

      // 4. Delete the payroll
      const { error } = await sb.from('payrolls').delete().eq('id', id);
      if (error) throw error;

      void p;
    },
    onSuccess: () => {
      hrLog('deleted', 'payroll');
      qc.invalidateQueries({ queryKey: ['payrolls'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: ['loss_deductions'] });
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
    },
  });
}

/* ── Loans ────────────────────────────────────────────────────────────────── */

export function useLoans() {
  return useQuery({
    queryKey: ['loans'],
    queryFn: async () => {
      const { data, error } = await sb.from('loans').select('*').order('start_date', { ascending: false });
      if (error) throw error;
      return data as Loan[];
    },
  });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: LoanInput) => {
      const { data, error } = await sb.from('loans').insert(values).select().single();
      if (error) throw error;
      const loan = data as Loan;
      // Generate installment schedule
      const schedule = generateInstallmentSchedule(loan.start_date, loan.months, loan.emi);
      for (const s of schedule) {
        const inst: LoanInstallmentInput = { loan_id: loan.id, ...s, status: 'pending', payroll_id: null, paid_amount: 0 };
        await sb.from('loan_installments').insert(inst);
      }
      // Keep the accounting invariant even when an older database has no insert trigger.
      // The queue RPC is idempotent on (event_type, source_id), so this is safe when the
      // database trigger has already queued/posted the same loan disbursement.
      const { data: employee, error: employeeError } = await sb
        .from('employees')
        .select('accounting_branch_id')
        .eq('id', loan.employee_id)
        .single();
      if (employeeError) throw employeeError;
      if (employee?.accounting_branch_id) {
        const accountingArgs = {
          p_event_type: 'loan_given',
          p_source_id: loan.id,
          p_branch_id: employee.accounting_branch_id,
          p_event_date: loan.start_date,
          p_amount: loan.principal,
          p_description: 'Loan given',
          p_disbursement_ledger_id: loan.disbursement_ledger_id,
        };
        let { error: accountingError } = await sb.rpc('hrms_queue_event', accountingArgs);
        // Older deployments expose the original six-argument RPC without the
        // explicit disbursement-ledger parameter; retain compatibility there.
        if (accountingError) {
          const legacyArgs = { ...accountingArgs };
          delete (legacyArgs as { p_disbursement_ledger_id?: string | null }).p_disbursement_ledger_id;
          const legacyResult = await sb.rpc('hrms_queue_event', legacyArgs);
          accountingError = legacyResult.error;
        }
        if (accountingError) throw accountingError;
      }
      return loan;
    },
    onSuccess: () => {
      hrLog('created', 'loan');
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
    },
  });
}

export function useUpdateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<LoanInput> }) => {
      const { error } = await sb.from('loans').update(values).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('updated', 'loan');
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

export function useDeleteLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc('hrms_delete_with_reversal', { p_record_kind: 'loan', p_record_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('deleted', 'loan');
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
    },
  });
}

/* ── Advances ─────────────────────────────────────────────────────────────── */

export function useAdvances() {
  return useQuery({
    queryKey: ['advances'],
    queryFn: async () => {
      const { data, error } = await sb.from('advances').select('*').order('start_date', { ascending: false });
      if (error) throw error;
      return data as Advance[];
    },
  });
}

export function useCreateAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: AdvanceInput) => {
      const { data, error } = await sb.from('advances').insert(values).select().single();
      if (error) throw error;
      const advance = data as Advance;
      // Generate installment schedule
      const schedule = generateInstallmentSchedule(advance.start_date, advance.months, advance.emi);
      for (const s of schedule) {
        const inst: AdvanceInstallmentInput = { advance_id: advance.id, ...s, status: 'pending', payroll_id: null, paid_amount: 0 };
        await sb.from('advance_installments').insert(inst);
      }
      return advance;
    },
    onSuccess: () => {
      hrLog('created', 'advance');
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
    },
  });
}

export function useUpdateAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<AdvanceInput> }) => {
      const { error } = await sb.from('advances').update(values).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('updated', 'advance');
      qc.invalidateQueries({ queryKey: ['advances'] });
    },
  });
}

export function useDeleteAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc('hrms_delete_with_reversal', { p_record_kind: 'advance', p_record_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('deleted', 'advance');
      qc.invalidateQueries({ queryKey: ['advances'] });
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
    },
  });
}

/* ── Skip-tail rebuild helpers ────────────────────────────────────────────── */

/**
 * After any skip action on a loan, rebuild the pending tail installments.
 * Tail installments (skip_generated=true) absorb all deferred amounts in
 * full-EMI chunks.  Paid tail installments are left untouched.
 */
async function rebuildLoanSkipTail(
  allInsts: LoanInstallment[],
  loanId: string,
  emi: number,
) {
  const isGen     = (i: LoanInstallment) => !!(i as never as Record<string,unknown>).skip_generated;
  const generated = allInsts.filter(isGen);
  const pendingGen = generated.filter(i => i.status === 'pending');
  const paidGen    = generated.filter(i => i.status !== 'pending');

  // Remove only pending tail installments (preserve paid history)
  for (const g of pendingGen) await sb.from('loan_installments').delete().eq('id', g.id);

  // Pool = deferred amounts from original skipped/partial_skipped/payroll_partial_skipped installments
  let pool = 0;
  const originals = allInsts.filter(i => !isGen(i));
  for (const inst of originals) {
    if (inst.status === 'skipped')                 pool += Number(inst.amount);
    if (inst.status === 'partial_skipped')         pool += Number(inst.amount) - Number(inst.paid_amount || 0);
    if (inst.status === 'payroll_partial_skipped') pool += Number(inst.amount) - Number(inst.paid_amount || 0);
  }
  // Subtract already-paid generated installments from pool
  for (const pg of paidGen) pool -= Number(pg.amount);

  if (pool <= 0.01) return;

  // Find the date to start appending from
  const allSorted  = [...allInsts].sort((a, b) => a.emi_number - b.emi_number);
  const paidGenSorted = [...paidGen].sort((a, b) => a.emi_number - b.emi_number);
  const lastRef    = paidGenSorted.length ? paidGenSorted.at(-1)! : originals.at(-1)!;
  let   prevDate   = new Date(lastRef.due_year, lastRef.due_month, 1);
  let   nextNum    = Math.max(...allSorted.map(i => i.emi_number)) + 1;

  while (pool > 0.01) {
    prevDate = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 1);
    const amt = Math.round(Math.min(emi, pool) * 100) / 100;
    await sb.from('loan_installments').insert({
      loan_id: loanId, emi_number: nextNum++,
      due_year: prevDate.getFullYear(), due_month: prevDate.getMonth(), due_date: ymd(prevDate),
      amount: amt, status: 'pending', payroll_id: null, paid_amount: 0, skip_generated: true,
    });
    pool -= amt;
  }
}

/** Same logic as rebuildLoanSkipTail but for advances. */
async function rebuildAdvanceSkipTail(
  allInsts: AdvanceInstallment[],
  advanceId: string,
  emi: number,
) {
  const isGen     = (i: AdvanceInstallment) => !!(i as never as Record<string,unknown>).skip_generated;
  const generated = allInsts.filter(isGen);
  const pendingGen = generated.filter(i => i.status === 'pending');
  const paidGen    = generated.filter(i => i.status !== 'pending');

  for (const g of pendingGen) await sb.from('advance_installments').delete().eq('id', g.id);

  let pool = 0;
  const originals = allInsts.filter(i => !isGen(i));
  for (const inst of originals) {
    if (inst.status === 'skipped')                 pool += Number(inst.amount);
    if (inst.status === 'partial_skipped')         pool += Number(inst.amount) - Number(inst.paid_amount || 0);
    if (inst.status === 'payroll_partial_skipped') pool += Number(inst.amount) - Number(inst.paid_amount || 0);
  }
  for (const pg of paidGen) pool -= Number(pg.amount);

  if (pool <= 0.01) return;

  const allSorted     = [...allInsts].sort((a, b) => a.emi_number - b.emi_number);
  const paidGenSorted = [...paidGen].sort((a, b) => a.emi_number - b.emi_number);
  const lastRef       = paidGenSorted.length ? paidGenSorted.at(-1)! : originals.at(-1)!;
  let   prevDate      = new Date(lastRef.due_year, lastRef.due_month, 1);
  let   nextNum       = Math.max(...allSorted.map(i => i.emi_number)) + 1;

  while (pool > 0.01) {
    prevDate = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 1);
    const amt = Math.round(Math.min(emi, pool) * 100) / 100;
    await sb.from('advance_installments').insert({
      advance_id: advanceId, emi_number: nextNum++,
      due_year: prevDate.getFullYear(), due_month: prevDate.getMonth(), due_date: ymd(prevDate),
      amount: amt, status: 'pending', payroll_id: null, paid_amount: 0, skip_generated: true,
    });
    pool -= amt;
  }
}

/* ── Loan Installments ────────────────────────────────────────────────────── */

export function useAllLoanInstallments() {
  return useQuery({
    queryKey: ['loan_installments'],
    queryFn: async () => {
      const { data, error } = await sb.from('loan_installments').select('*').order('due_date');
      if (error) throw error;
      return data as LoanInstallment[];
    },
  });
}

export function useLoanInstallments(loanId: string) {
  return useQuery({
    queryKey: ['loan_installments', loanId],
    queryFn: async () => {
      const { data, error } = await sb.from('loan_installments').select('*').eq('loan_id', loanId).order('emi_number');
      if (error) throw error;
      return data as LoanInstallment[];
    },
    enabled: !!loanId,
  });
}

export function useMarkLoanInstallmentPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, loanId, currentStatus, payrollId, directPaymentLedgerId }: {
      installmentId: string;
      loanId: string;
      currentStatus: string;
      payrollId: string | null;
      directPaymentLedgerId?: string;
    }) => {
      if (directPaymentLedgerId && currentStatus !== 'paid_payroll') {
        const { error } = await sb.rpc('hrms_record_direct_emi_payment', {
          p_installment_kind: 'loan', p_installment_id: installmentId,
          p_payment_ledger_id: directPaymentLedgerId, p_amount: (await sb.from('loan_installments').select('amount').eq('id', installmentId).single()).data?.amount,
          p_status: 'paid_manual',
        });
        if (error) throw error;
      } else {
      const updates: Record<string, unknown> = { status: 'paid_manual', paid_amount: 0 };
      if (currentStatus === 'paid_payroll') updates.payroll_id = null;
      const { error } = await sb.from('loan_installments').update(updates).eq('id', installmentId);
      if (error) throw error;
      }
      const { data: allInst } = await sb.from('loan_installments').select('*').eq('loan_id', loanId);
      const arr  = (allInst ?? []) as LoanInstallment[];
      const paid = arr.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      const done = arr.filter(i => i.status === 'pending').length === 0;
      await sb.from('loans').update({
        paid_months: paid,
        status: done ? 'paid' : 'active',
        paid_off_date: done ? ymd(new Date()) : null,
      }).eq('id', loanId);
      return { wasPayroll: currentStatus === 'paid_payroll', payrollId };
    },
    onSuccess: () => {
      hrLog('paid', 'loan_installment');
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

/** Mark an installment as partially paid by direct cash; remainder will be deducted via payroll. */
export function useMarkLoanInstallmentPartialPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, loanId, paidAmount, paymentLedgerId }: {
      installmentId: string;
      loanId: string;
      paidAmount: number;
      paymentLedgerId: string;
    }) => {
      const { error } = await sb.rpc('hrms_record_direct_emi_payment', {
        p_installment_kind: 'loan', p_installment_id: installmentId,
        p_payment_ledger_id: paymentLedgerId, p_amount: paidAmount,
        p_status: 'paid_partial_manual',
      });
      if (error) throw error;
      // paid_months unchanged — installment is not fully settled yet
    },
    onSuccess: () => {
      hrLog('partial_paid', 'loan_installment');
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

export function useMarkLoanInstallmentUnpaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, loanId }: { installmentId: string; loanId: string }) => {
      const { data: current } = await sb.from('loan_installments').select('direct_payment_journal_entry_id').eq('id', installmentId).single();
      if (current?.direct_payment_journal_entry_id) {
        const { error } = await sb.rpc('hrms_reverse_journal_entry', {
          p_original_entry_id: current.direct_payment_journal_entry_id,
          p_reference: `hrms:reversal:loan-emi:undo:${installmentId}:${current.direct_payment_journal_entry_id}`,
          p_description: 'Reversal of direct loan EMI receipt',
        });
        if (error) throw error;
      }
      await sb.from('loan_installments').update({ status: 'pending', payroll_id: null, paid_amount: 0, direct_payment_journal_entry_id: null, direct_payment_ledger_id: null }).eq('id', installmentId);
      // Re-fetch and rebuild skip tail (handles undoing a 'skipped'/'partial_skipped' installment)
      const { data: allInst } = await sb.from('loan_installments').select('*').eq('loan_id', loanId);
      const arr = (allInst ?? []) as LoanInstallment[];
      const { data: loanRow } = await sb.from('loans').select('*').eq('id', loanId).single();
      await rebuildLoanSkipTail(arr, loanId, (loanRow as Loan).emi);
      const { data: refreshed } = await sb.from('loan_installments').select('*').eq('loan_id', loanId);
      const r    = (refreshed ?? []) as LoanInstallment[];
      const paid = r.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      await sb.from('loans').update({ paid_months: paid, status: 'active', paid_off_date: null }).eq('id', loanId);
    },
    onSuccess: () => {
      hrLog('unpaid', 'loan_installment');
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

export function useMarkLoanInstallmentPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, payrollId, loanId }: {
      installmentId: string;
      payrollId: string;
      loanId: string;
    }) => {
      await sb.from('loan_installments').update({ status: 'paid_payroll', payroll_id: payrollId }).eq('id', installmentId);
      const { data: allInst } = await sb.from('loan_installments').select('*').eq('loan_id', loanId);
      const arr  = (allInst ?? []) as LoanInstallment[];
      const paid = arr.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      const done = arr.filter(i => i.status === 'pending').length === 0;
      await sb.from('loans').update({
        paid_months: paid,
        status: done ? 'paid' : 'active',
        paid_off_date: done ? ymd(new Date()) : null,
      }).eq('id', loanId);
    },
    onSuccess: () => {
      hrLog('paid_payroll', 'loan_installment');
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

/** Skip a loan EMI period, deferring the (remaining) amount to tail installments. */
export function useSkipLoanInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, loanId, paidAmount, payrollAmount = 0, paymentLedgerId }: {
      installmentId: string;
      loanId: string;
      paidAmount: number;    // 0 = full skip; >0 = partial cash collected + rest deferred
      payrollAmount?: number; // >0 = partial deducted from payroll + rest deferred
      paymentLedgerId?: string;
    }) => {
      const isPayrollPartial = payrollAmount > 0;
      const isPartial = !isPayrollPartial && paidAmount > 0;
      const status     = isPayrollPartial ? 'payroll_partial_skipped' : (isPartial ? 'partial_skipped' : 'skipped');
      const storedPaid = isPayrollPartial ? payrollAmount : paidAmount;
      if (isPartial) {
        const { error } = await sb.rpc('hrms_record_direct_emi_payment', {
          p_installment_kind: 'loan', p_installment_id: installmentId,
          p_payment_ledger_id: paymentLedgerId, p_amount: paidAmount,
          p_status: 'partial_skipped',
        });
        if (error) throw error;
      } else {
        const { error } = await sb.from('loan_installments').update({
          status, paid_amount: storedPaid, payroll_id: null,
        }).eq('id', installmentId);
        if (error) throw error;
      }

      const { data: allInst } = await sb.from('loan_installments').select('*').eq('loan_id', loanId);
      const arr = (allInst ?? []) as LoanInstallment[];
      const { data: loanRow } = await sb.from('loans').select('*').eq('id', loanId).single();
      await rebuildLoanSkipTail(arr, loanId, (loanRow as Loan).emi);

      const { data: refreshed } = await sb.from('loan_installments').select('*').eq('loan_id', loanId);
      const r    = (refreshed ?? []) as LoanInstallment[];
      const paid = r.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      const done = r.filter(i => i.status === 'pending').length === 0;
      await sb.from('loans').update({
        paid_months: paid,
        status: done ? 'paid' : 'active',
        paid_off_date: done ? ymd(new Date()) : null,
      }).eq('id', loanId);
    },
    onSuccess: () => {
      hrLog('skipped', 'loan_installment');
      qc.invalidateQueries({ queryKey: ['loan_installments'] });
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
  });
}

/* ── Advance Installments ─────────────────────────────────────────────────── */

export function useAllAdvanceInstallments() {
  return useQuery({
    queryKey: ['advance_installments'],
    queryFn: async () => {
      const { data, error } = await sb.from('advance_installments').select('*').order('due_date');
      if (error) throw error;
      return data as AdvanceInstallment[];
    },
  });
}

export function useAdvanceInstallments(advanceId: string) {
  return useQuery({
    queryKey: ['advance_installments', advanceId],
    queryFn: async () => {
      const { data, error } = await sb.from('advance_installments').select('*').eq('advance_id', advanceId).order('emi_number');
      if (error) throw error;
      return data as AdvanceInstallment[];
    },
    enabled: !!advanceId,
  });
}

export function useMarkAdvanceInstallmentPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, advanceId, currentStatus, payrollId, directPaymentLedgerId }: {
      installmentId: string;
      advanceId: string;
      currentStatus: string;
      payrollId: string | null;
      directPaymentLedgerId?: string;
    }) => {
      if (directPaymentLedgerId && currentStatus !== 'paid_payroll') {
        const { data: row } = await sb.from('advance_installments').select('amount').eq('id', installmentId).single();
        const { error } = await sb.rpc('hrms_record_direct_emi_payment', {
          p_installment_kind: 'advance', p_installment_id: installmentId,
          p_payment_ledger_id: directPaymentLedgerId, p_amount: row?.amount,
          p_status: 'paid_manual',
        });
        if (error) throw error;
      } else {
      const updates: Record<string, unknown> = { status: 'paid_manual', paid_amount: 0 };
      if (currentStatus === 'paid_payroll') updates.payroll_id = null;
      const { error } = await sb.from('advance_installments').update(updates).eq('id', installmentId);
      if (error) throw error;
      }
      const { data: allInst } = await sb.from('advance_installments').select('*').eq('advance_id', advanceId);
      const arr  = (allInst ?? []) as AdvanceInstallment[];
      const paid = arr.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      const done = arr.filter(i => i.status === 'pending').length === 0;
      await sb.from('advances').update({
        paid_months: paid,
        status: done ? 'paid' : 'active',
        paid_off_date: done ? ymd(new Date()) : null,
      }).eq('id', advanceId);
      return { wasPayroll: currentStatus === 'paid_payroll', payrollId };
    },
    onSuccess: () => {
      hrLog('paid', 'advance_installment');
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
    },
  });
}

/** Mark an advance installment as partially paid by direct cash. */
export function useMarkAdvanceInstallmentPartialPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, advanceId, paidAmount, paymentLedgerId }: {
      installmentId: string;
      advanceId: string;
      paidAmount: number;
      paymentLedgerId: string;
    }) => {
      const { error } = await sb.rpc('hrms_record_direct_emi_payment', {
        p_installment_kind: 'advance', p_installment_id: installmentId,
        p_payment_ledger_id: paymentLedgerId, p_amount: paidAmount,
        p_status: 'paid_partial_manual',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('partial_paid', 'advance_installment');
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
    },
  });
}

export function useMarkAdvanceInstallmentUnpaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, advanceId }: { installmentId: string; advanceId: string }) => {
      const { data: current } = await sb.from('advance_installments').select('direct_payment_journal_entry_id').eq('id', installmentId).single();
      if (current?.direct_payment_journal_entry_id) {
        const { error } = await sb.rpc('hrms_reverse_journal_entry', {
          p_original_entry_id: current.direct_payment_journal_entry_id,
          p_reference: `hrms:reversal:advance-emi:undo:${installmentId}:${current.direct_payment_journal_entry_id}`,
          p_description: 'Reversal of direct advance EMI receipt',
        });
        if (error) throw error;
      }
      await sb.from('advance_installments').update({ status: 'pending', payroll_id: null, paid_amount: 0, direct_payment_journal_entry_id: null, direct_payment_ledger_id: null }).eq('id', installmentId);
      const { data: allInst } = await sb.from('advance_installments').select('*').eq('advance_id', advanceId);
      const arr = (allInst ?? []) as AdvanceInstallment[];
      const { data: advRow } = await sb.from('advances').select('*').eq('id', advanceId).single();
      await rebuildAdvanceSkipTail(arr, advanceId, (advRow as Advance).emi);
      const { data: refreshed } = await sb.from('advance_installments').select('*').eq('advance_id', advanceId);
      const r    = (refreshed ?? []) as AdvanceInstallment[];
      const paid = r.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      await sb.from('advances').update({ paid_months: paid, status: 'active', paid_off_date: null }).eq('id', advanceId);
    },
    onSuccess: () => {
      hrLog('unpaid', 'advance_installment');
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
    },
  });
}

export function useMarkAdvanceInstallmentPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, payrollId, advanceId }: {
      installmentId: string;
      payrollId: string;
      advanceId: string;
    }) => {
      await sb.from('advance_installments').update({ status: 'paid_payroll', payroll_id: payrollId }).eq('id', installmentId);
      const { data: allInst } = await sb.from('advance_installments').select('*').eq('advance_id', advanceId);
      const arr  = (allInst ?? []) as AdvanceInstallment[];
      const paid = arr.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      const done = arr.filter(i => i.status === 'pending').length === 0;
      await sb.from('advances').update({
        paid_months: paid,
        status: done ? 'paid' : 'active',
        paid_off_date: done ? ymd(new Date()) : null,
      }).eq('id', advanceId);
    },
    onSuccess: () => {
      hrLog('paid_payroll', 'advance_installment');
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
    },
  });
}

/** Skip an advance EMI period, deferring the (remaining) amount to tail installments. */
export function useSkipAdvanceInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ installmentId, advanceId, paidAmount, payrollAmount = 0, paymentLedgerId }: {
      installmentId: string;
      advanceId: string;
      paidAmount: number;    // 0 = full skip; >0 = partial cash collected + rest deferred
      payrollAmount?: number; // >0 = partial deducted from payroll + rest deferred
      paymentLedgerId?: string;
    }) => {
      const isPayrollPartial = payrollAmount > 0;
      const isPartial = !isPayrollPartial && paidAmount > 0;
      const status     = isPayrollPartial ? 'payroll_partial_skipped' : (isPartial ? 'partial_skipped' : 'skipped');
      const storedPaid = isPayrollPartial ? payrollAmount : paidAmount;
      if (isPartial) {
        const { error } = await sb.rpc('hrms_record_direct_emi_payment', {
          p_installment_kind: 'advance', p_installment_id: installmentId,
          p_payment_ledger_id: paymentLedgerId, p_amount: paidAmount,
          p_status: 'partial_skipped',
        });
        if (error) throw error;
      } else {
        const { error } = await sb.from('advance_installments').update({
          status, paid_amount: storedPaid, payroll_id: null,
        }).eq('id', installmentId);
        if (error) throw error;
      }

      const { data: allInst } = await sb.from('advance_installments').select('*').eq('advance_id', advanceId);
      const arr = (allInst ?? []) as AdvanceInstallment[];
      const { data: advRow } = await sb.from('advances').select('*').eq('id', advanceId).single();
      await rebuildAdvanceSkipTail(arr, advanceId, (advRow as Advance).emi);

      const { data: refreshed } = await sb.from('advance_installments').select('*').eq('advance_id', advanceId);
      const r    = (refreshed ?? []) as AdvanceInstallment[];
      const paid = r.filter(i => ['paid_manual','paid_payroll','paid_partial_manual'].includes(i.status)).length;
      const done = r.filter(i => i.status === 'pending').length === 0;
      await sb.from('advances').update({
        paid_months: paid,
        status: done ? 'paid' : 'active',
        paid_off_date: done ? ymd(new Date()) : null,
      }).eq('id', advanceId);
    },
    onSuccess: () => {
      hrLog('skipped', 'advance_installment');
      qc.invalidateQueries({ queryKey: ['advance_installments'] });
      qc.invalidateQueries({ queryKey: ['advances'] });
    },
  });
}

/* ── Loss Deductions ──────────────────────────────────────────────────────── */

export function useLossDeductions() {
  return useQuery({
    queryKey: ['loss_deductions'],
    queryFn: async () => {
      const { data, error } = await sb.from('loss_deductions').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as LossDeduction[];
    },
  });
}

export function useCreateLossDeduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: LossDeductionInput) => {
      const { data, error } = await sb.from('loss_deductions').insert(values).select().single();
      if (error) throw error;
      return data as LossDeduction;
    },
    onSuccess: () => {
      hrLog('created', 'loss_deduction');
      qc.invalidateQueries({ queryKey: ['loss_deductions'] });
    },
  });
}

export function useUpdateLossDeduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<LossDeductionInput> }) => {
      const { error } = await sb.from('loss_deductions').update(values).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('updated', 'loss_deduction');
      qc.invalidateQueries({ queryKey: ['loss_deductions'] });
    },
  });
}

export function useDeleteLossDeduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc('hrms_delete_with_reversal', { p_record_kind: 'loss_deduction', p_record_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('deleted', 'loss_deduction');
      qc.invalidateQueries({ queryKey: ['loss_deductions'] });
    },
  });
}

/* ── Attendance Module (Checkin Logs) ─────────────────────────────────────── */

export function useCheckinLogs(date?: string) {
  return useQuery({
    queryKey: ['checkin_logs', date ?? 'all'],
    queryFn: async () => {
      let q = sb.from('checkin_logs').select('*').order('logged_at', { ascending: true });
      if (date) q = q.eq('date', date);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CheckinLog[];
    },
  });
}

export function useSaveCheckinLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (logs: CheckinLog[]) => {
      if (!logs.length) return;
      const { error } = await sb.from('checkin_logs').upsert(logs, { onConflict: 'id' });
      if (error) throw error;
    },
    onSuccess: () => {
      hrLog('saved', 'checkin_log');
      qc.invalidateQueries({ queryKey: ['checkin_logs'] });
    },
  });
}

/** POST /api/public/sync — push employees to attendance module, get dept credentials back */
export async function syncToAttendanceModule(
  baseUrl: string,
  apiKey: string,
  employees: Employee[],
  departments: Department[],
): Promise<{ ok: boolean; employees_synced: number; departments: Array<{ id: string; name: string; device_id: string; device_password: string }> }> {
  const payload = {
    employees: employees
      .filter(e => e.status === 'active' && e.employee_number && e.department_id)
      .map(e => {
        const dept = departments.find(d => d.id === e.department_id);
        return {
          name: [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' '),
          number: e.employee_number!,
          department: dept?.name ?? 'General',
          department_latitude: dept?.latitude ?? 0,
          department_longitude: dept?.longitude ?? 0,
        };
      }),
  };
  const url = baseUrl.replace(/\/$/, '') + '/api/public/sync';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-panel-key': apiKey },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Sync failed');
  return json;
}

/** POST /api/public/panel-logs — fetch check-in/out logs for a date */
export async function fetchModuleLogs(
  baseUrl: string,
  apiKey: string,
  date: string,
): Promise<CheckinLog[]> {
  const url = baseUrl.replace(/\/$/, '') + '/api/public/panel-logs';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-panel-key': apiKey },
    body: JSON.stringify({ date }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Fetch logs failed');
  return (json.logs ?? []).map((l: { id: string; kind: string; logged_at: string; employee_number: string; employee_name: string; department: string }) => ({
    id: l.id,
    employee_number: l.employee_number,
    employee_name: l.employee_name,
    department: l.department,
    kind: l.kind as 'check_in' | 'check_out',
    logged_at: l.logged_at,
    date,
    created_at: new Date().toISOString(),
  }));
}

export { useIncentiveAmounts, useCreateIncentiveAmount, useMarkIncentivePaid, useDeleteIncentiveAmount } from "./hr/hooks";
