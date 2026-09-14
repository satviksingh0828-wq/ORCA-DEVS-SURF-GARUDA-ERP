import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { computeSalary, type Employee, type EmployeeInput, type Gender, type EmployeeStatus } from '@/lib/types';
import { useCreateEmployee, useUpdateEmployee, useDepartments, useAllPositions } from '@/lib/hooks';
import { employeeDocumentsApi, type EmployeeDocumentRecord } from '@/lib/employee-documents';
import { serverListBasicUsers, type BasicUserOption } from '@/lib/user-auth';
import { useBranches } from '@/lib/use-branches';

type FormState = {
  employee_number: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  mobile: string;
  email: string;
  address: string;
  dob: string;
  gender: Gender | '';
  joining_date: string;
  work_start_time: string;
  work_end_time: string;
  basic_salary: string;
  hra: string;
  travel_allowance: string;
  special_allowance: string;
  other_allowance: string;
  pf_deduction: string;
  tax_deduction: string;
  paid_holidays_per_month: string;
  emergency_contact: string;
  location: string;
  status: EmployeeStatus;
  inactive_reason: string;
  date_of_leaving: string;
  department_id: string;
  accounting_branch_id: string;
  position_id: string;
  basic_user_id: string;
  bank_account_number: string;
  bank_branch_name: string;
  bank_branch_address: string;
  bank_ifsc_code: string;
  aadhaar_number: string;
  pan_number: string;
};

type Qualification = { id: string; name: string };

function stripMobile(m: string) {
  // Always keep the last 10 digits — handles raw 10-digit, +91-prefixed, and 91-prefixed inputs.
  return m.replace(/\D/g, '').slice(-10);
}

function fromEmployee(e?: Employee): FormState {
  return {
    employee_number:              e?.employee_number ?? '',
    first_name:                   e?.first_name ?? '',
    middle_name:                  e?.middle_name ?? '',
    last_name:                    e?.last_name ?? '',
    mobile:                       e ? stripMobile(e.mobile) : '',
    email:                        e?.email ?? '',
    address:                      e?.address ?? '',
    dob:                          e?.dob ?? '',
    gender:                       e?.gender ?? '',
    joining_date:                 e?.joining_date ?? '',
    work_start_time:              e?.work_start_time?.slice(0, 5) ?? '09:00',
    work_end_time:                e?.work_end_time?.slice(0, 5) ?? '18:00',
    basic_salary:                 e ? String(e.basic_salary) : '',
    hra:                          e ? String(e.hra) : '',
    travel_allowance:             e ? String(e.travel_allowance) : '',
    special_allowance:            e ? String(e.special_allowance) : '',
    other_allowance:              e ? String(e.other_allowance) : '0',
    pf_deduction:                 e ? String(e.pf_deduction) : '',
    tax_deduction:                e ? String(e.tax_deduction) : '0',
    paid_holidays_per_month:      e ? String(e.paid_holidays_per_month) : '1',
    emergency_contact:            e?.emergency_contact ?? '',
    location:                     e?.location ?? '',
    status:                       e?.status ?? 'active',
    inactive_reason:              e?.inactive_reason ?? '',
    date_of_leaving:              e?.date_of_leaving ?? '',
    department_id:                e?.department_id ?? '',
    accounting_branch_id:         e?.accounting_branch_id ?? '',
    position_id:                  e?.position_id ?? '',
    basic_user_id:                e?.basic_user_id ?? '',
    bank_account_number:          e?.bank_account_number ?? '',
    bank_branch_name:             e?.bank_branch_name ?? '',
    bank_branch_address:          e?.bank_branch_address ?? '',
    bank_ifsc_code:               e?.bank_ifsc_code ?? '',
    aadhaar_number:               e?.aadhaar_number ?? '',
    pan_number:                   e?.pan_number ?? '',
  };
}

const STEPS = ['Personal', 'Salary & work', 'Other', 'Status'] as const;

export function EmployeeForm({ employee }: { employee?: Employee }) {
  const navigate   = useNavigate();
  const create     = useCreateEmployee();
  const update     = useUpdateEmployee();
  const { data: departments = [] } = useDepartments();
  const { data: allPositions = [] } = useAllPositions();
  const branches = useBranches();
  const [basicUsers, setBasicUsers] = useState<BasicUserOption[]>([]);
  const [step, setStep] = useState(0);
  const [f, setF] = useState<FormState>(() => fromEmployee(employee));
  const [qualifications, setQualifications] = useState<Qualification[]>(
    () => (employee?.qualifications ?? []).map((name, i) => ({ id: `${i}-${name}`, name })),
  );
  const [newQualification, setNewQualification] = useState('');
  const [documents, setDocuments] = useState<EmployeeDocumentRecord[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    serverListBasicUsers().then(setBasicUsers).catch(() => setBasicUsers([]));
  }, []);

  useEffect(() => {
    if (!employee) return;
    setDocumentsLoading(true);
    employeeDocumentsApi.list(employee.id)
      .then(setDocuments)
      .catch(() => toast.error('Could not load employee documents'))
      .finally(() => setDocumentsLoading(false));
  }, [employee]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF(s => ({ ...s, [k]: v }));

  const availablePositions = useMemo(
    () => allPositions.filter(p => p.department_id === f.department_id),
    [allPositions, f.department_id],
  );

  const salary = computeSalary({
    basic_salary:      Number(f.basic_salary) || 0,
    hra:               Number(f.hra) || 0,
    travel_allowance:  Number(f.travel_allowance) || 0,
    special_allowance: Number(f.special_allowance) || 0,
    other_allowance:   Number(f.other_allowance) || 0,
    pf_deduction:      Number(f.pf_deduction) || 0,
    tax_deduction:     Number(f.tax_deduction) || 0,
  });

  function validateStep(idx: number): string | null {
    if (idx === 0) {
      if (!f.first_name.trim()) return 'First name is required';
      if (!f.last_name.trim())  return 'Last name is required';
      if (f.mobile.length !== 10) return 'Mobile must be 10 digits';
      if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'Email is invalid';
      if (!f.address.trim())    return 'Address is required';
      if (!f.dob)               return 'Date of birth is required';
      if (!f.gender)            return 'Gender is required';
    }
    if (idx === 1) {
      if (!f.joining_date) return 'Joining date is required';
      if (!f.work_start_time || !f.work_end_time) return 'Working hours are required';
      for (const k of ['basic_salary', 'hra', 'travel_allowance', 'special_allowance', 'pf_deduction'] as const) {
        if (f[k] === '' || isNaN(Number(f[k]))) return `${k.replace(/_/g, ' ')} is required`;
      }
    }
    if (idx === 3) {
      if (f.status === 'inactive') {
        if (!f.inactive_reason.trim()) return 'Reason is required for inactive employees';
        if (!f.date_of_leaving)        return 'Date of leaving is required';
      }
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) { toast.error(err); return; }
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  }

  async function submit() {
    const err = validateStep(3);
    if (err) { toast.error(err); return; }
    const payload: EmployeeInput = {
      employee_number:             f.employee_number.trim() || null,
      first_name:                  f.first_name.trim(),
      middle_name:                 f.middle_name.trim() || null,
      last_name:                   f.last_name.trim(),
      mobile:                      `+91${f.mobile}`,
      email:                       f.email.trim() || null,
      address:                     f.address.trim(),
      dob:                         f.dob,
      gender:                      f.gender as Gender,
      joining_date:                f.joining_date,
      work_start_time:             f.work_start_time,
      work_end_time:               f.work_end_time,
      basic_salary:                Number(f.basic_salary),
      hra:                         Number(f.hra),
      travel_allowance:            Number(f.travel_allowance),
      special_allowance:           Number(f.special_allowance),
      other_allowance:             Number(f.other_allowance || 0),
      pf_deduction:                Number(f.pf_deduction),
      tax_deduction:               Number(f.tax_deduction || 0),
      paid_holidays_per_month:     Number(f.paid_holidays_per_month || 0),
      unpaid_leave_deduction_rate: 0,
      paid_leave_payout_rate:      0,
      pay_per_extra_work_day:      0,
      emergency_contact:           f.emergency_contact.trim() || null,
      location:                    f.location.trim() || null,
      status:                      f.status,
      inactive_reason:             f.status === 'inactive' ? f.inactive_reason.trim() : null,
      date_of_leaving:             f.status === 'inactive' ? f.date_of_leaving : null,
            department_id:               f.department_id || null,
            accounting_branch_id:        f.accounting_branch_id || null,
      position_id:                  f.department_id && f.position_id ? f.position_id : null,
      basic_user_id:                f.basic_user_id || null,
      bank_account_number:         f.bank_account_number.trim() || null,
      bank_branch_name:            f.bank_branch_name.trim() || null,
      bank_branch_address:         f.bank_branch_address.trim() || null,
      bank_ifsc_code:              f.bank_ifsc_code.trim().toUpperCase() || null,
      aadhaar_number:              f.aadhaar_number.trim() || null,
      pan_number:                  f.pan_number.trim().toUpperCase() || null,
      qualifications:              qualifications.map(q => q.name.trim()).filter(Boolean),
    };
    try {
      if (employee) {
        await update.mutateAsync({ id: employee.id, values: payload });
        const uploaded = await Promise.all(selectedFiles.map(file => employeeDocumentsApi.upload(employee.id, file)));
        if (uploaded.length) setDocuments(items => [...uploaded, ...items]);
        toast.success('Employee updated');
        navigate({ to: '/employees/$id', params: { id: employee.id } });
      } else {
        const created = await create.mutateAsync(payload);
        await Promise.all(selectedFiles.map(file => employeeDocumentsApi.upload(created.id, file)));
        toast.success('Employee added');
        navigate({ to: '/employees/$id', params: { id: created.id } });
      }
    } catch (e) {
      toast.error((e as Error).message || 'Failed to save');
    }
  }

  const isBusy  = create.isPending || update.isPending;
  const inputCls = 'min-h-[44px] sm:min-h-0';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ol className="flex items-center gap-2 text-xs sm:text-sm">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium',
                i === step
                  ? 'border-primary bg-primary text-primary-foreground'
                  : i < step
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
              )}
            >{i + 1}</button>
            <span className={cn(i === step ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
          </li>
        ))}
      </ol>

      <div className="rounded-lg border bg-card p-4 sm:p-6">

        {/* ── Step 0: Personal ── */}
        {step === 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Employee number <span className="text-xs text-muted-foreground">(for attendance module)</span></Label>
              <Input className={inputCls} value={f.employee_number} onChange={e => set('employee_number', e.target.value)} placeholder="e.g. E001" />
            </div>
            <div className="space-y-2">
              <Label>First name *</Label>
              <Input className={inputCls} value={f.first_name} onChange={e => set('first_name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Middle name</Label>
              <Input className={inputCls} value={f.middle_name} onChange={e => set('middle_name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Last name *</Label>
              <Input className={inputCls} value={f.last_name} onChange={e => set('last_name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Mobile *</Label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">+91</span>
                <Input
                  className={cn(inputCls, 'rounded-l-none')}
                  inputMode="numeric"
                  maxLength={10}
                  value={f.mobile}
                  onChange={e => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit number"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input className={inputCls} type="email" value={f.email} onChange={e => set('email', e.target.value)} placeholder="employee@example.com (optional)" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Address *</Label>
              <Textarea rows={3} value={f.address} onChange={e => set('address', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Date of birth *</Label>
              <Input className={inputCls} type="date" value={f.dob} onChange={e => set('dob', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Gender *</Label>
              <Select value={f.gender} onValueChange={v => set('gender', v as Gender)}>
                <SelectTrigger className={inputCls}><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* ── Step 1: Salary & work ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Joining date *</Label>
                <Input className={inputCls} type="date" value={f.joining_date} onChange={e => set('joining_date', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Work start *</Label>
                <Input className={inputCls} type="time" value={f.work_start_time} onChange={e => set('work_start_time', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Work end *</Label>
                <Input className={inputCls} type="time" value={f.work_end_time} onChange={e => set('work_end_time', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {([
                ['basic_salary',      'Basic salary *'],
                ['hra',               'HRA *'],
                ['travel_allowance',  'Travel allowance *'],
                ['special_allowance', 'Special allowance *'],
                ['other_allowance',   'Other allowance'],
                ['pf_deduction',      'Provident fund deduction *'],
                ['tax_deduction',     'Tax deduction'],
                ['paid_holidays_per_month', 'Paid holidays / month'],
              ] as const).map(([k, label]) => (
                <div className="space-y-2" key={k}>
                  <Label>{label}</Label>
                  <Input
                    className={inputCls}
                    inputMode="decimal"
                    value={f[k]}
                    onChange={e => set(k, e.target.value.replace(/[^\d.]/g, ''))}
                  />
                </div>
              ))}
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between"><span>Gross</span><span className="font-medium">₹{salary.gross.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>Deductions</span><span className="font-medium">−₹{salary.deductions.toLocaleString('en-IN')}</span></div>
              <div className="mt-1 flex justify-between border-t pt-1 text-base font-semibold"><span>Net</span><span>₹{salary.net.toLocaleString('en-IN')}</span></div>
            </div>
          </div>
        )}

        {/* ── Step 2: Other ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-3 text-base font-semibold">Bank details</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {([
                  ['bank_account_number', 'Bank account number'],
                  ['bank_branch_name', 'Bank branch name'],
                  ['bank_ifsc_code', 'Bank IFSC code'],
                ] as const).map(([k, label]) => (
                  <div className="space-y-2" key={k}>
                    <Label>{label}</Label>
                    <Input className={inputCls} value={f[k]} onChange={e => set(k, e.target.value)} />
                  </div>
                ))}
                <div className="space-y-2 sm:col-span-2">
                  <Label>Bank branch address</Label>
                  <Textarea rows={2} value={f.bank_branch_address} onChange={e => set('bank_branch_address', e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-base font-semibold">Government IDs</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Aadhaar number</Label>
                  <Input className={inputCls} inputMode="numeric" maxLength={12} value={f.aadhaar_number} onChange={e => set('aadhaar_number', e.target.value.replace(/\D/g, '').slice(0, 12))} />
                </div>
                <div className="space-y-2">
                  <Label>PAN number</Label>
                  <Input className={inputCls} maxLength={10} value={f.pan_number} onChange={e => set('pan_number', e.target.value.toUpperCase().slice(0, 10))} />
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-base font-semibold">Qualifications</h2>
              <div className="flex gap-2">
                <Input
                  value={newQualification}
                  onChange={e => setNewQualification(e.target.value)}
                  placeholder="e.g. B.Com, MBA"
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const name = newQualification.trim();
                    if (!name) return;
                    setQualifications(items => [...items, { id: `${Date.now()}-${name}`, name }]);
                    setNewQualification('');
                  }}
                />
                <Button type="button" variant="outline" onClick={() => {
                  const name = newQualification.trim();
                  if (!name) return;
                  setQualifications(items => [...items, { id: `${Date.now()}-${name}`, name }]);
                  setNewQualification('');
                }}>Add</Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {qualifications.map(q => (
                  <span key={q.id} className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm">
                    {q.name}
                    <button type="button" aria-label={`Remove ${q.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setQualifications(items => items.filter(item => item.id !== q.id))}>×</button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-1 text-base font-semibold">Documents</h2>
              <p className="mb-3 text-xs text-muted-foreground">Uploaded files are stored securely in the Supabase employee-documents bucket.</p>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => setSelectedFiles(files => [...files, ...Array.from(e.target.files ?? [])])} />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>Choose documents</Button>
              {selectedFiles.length > 0 && (
                <div className="mt-2 space-y-1 text-sm">
                  {selectedFiles.map((file, i) => (
                    <div key={`${file.name}-${i}`} className="flex items-center justify-between gap-3 rounded border px-3 py-2">
                      <span className="truncate">{file.name}</span>
                      <button type="button" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setSelectedFiles(files => files.filter((_, j) => j !== i))}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              {documentsLoading && <p className="mt-3 text-xs text-muted-foreground">Loading saved documents…</p>}
              {!documentsLoading && documents.length > 0 && (
                <div className="mt-3 space-y-1 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">Saved documents</p>
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2">
                      <span className="truncate">{doc.original_name}</span>
                      <button type="button" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={async () => {
                        try {
                          await employeeDocumentsApi.remove(doc.id);
                          setDocuments(items => items.filter(item => item.id !== doc.id));
                          toast.success('Document removed');
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Status ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={f.department_id || 'none'}
                  onValueChange={v => {
                    const val = v === 'none' ? '' : v;
                    setF(s => ({ ...s, department_id: val, position_id: '' }));
                  }}
                >
                  <SelectTrigger className={inputCls}><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Select
                  value={f.position_id || 'none'}
                  onValueChange={v => set('position_id', v === 'none' ? '' : v)}
                  disabled={!f.department_id}
                >
                  <SelectTrigger className={inputCls}>
                    <SelectValue placeholder={f.department_id ? 'Select position' : 'Choose a department first'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {availablePositions.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}{p.is_head ? ' (Head)' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Basic user (optional)</Label>
                <Select value={f.basic_user_id || 'none'} onValueChange={v => set('basic_user_id', v === 'none' ? '' : v)}>
                  <SelectTrigger className={inputCls}><SelectValue placeholder="No linked user" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked user</SelectItem>
                    {basicUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        {(u.full_name || u.username) + (u.is_active ? '' : ' (inactive)')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Accounting Branch</Label>
                <Select value={f.accounting_branch_id || 'none'} onValueChange={v => set('accounting_branch_id', v === 'none' ? '' : v)}>
                  <SelectTrigger className={inputCls}><SelectValue placeholder="Select accounting branch" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {branches.map(branch => <SelectItem key={branch.id} value={branch.id}>{branch.branch_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input className={inputCls} value={f.location} onChange={e => set('location', e.target.value)} placeholder="Branch / site / city" />
            </div>
            <div className="space-y-2">
              <Label>Emergency contact</Label>
              <Input className={inputCls} value={f.emergency_contact} onChange={e => set('emergency_contact', e.target.value)} placeholder="Name / phone" />
            </div>
            <div className="space-y-2">
              <Label>Status *</Label>
              <RadioGroup value={f.status} onValueChange={v => set('status', v as EmployeeStatus)} className="flex gap-6">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="active" /> Active</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="inactive" /> Inactive (left job)</label>
              </RadioGroup>
            </div>
            {f.status === 'inactive' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Reason for inactive *</Label>
                  <Textarea rows={2} value={f.inactive_reason} onChange={e => set('inactive_reason', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Date of leaving *</Label>
                  <Input className={inputCls} type="date" value={f.date_of_leaving} onChange={e => set('date_of_leaving', e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          className="min-h-[44px]"
          onClick={() => step === 0 ? navigate({ to: '/employees' }) : setStep(s => s - 1)}
          disabled={isBusy}
        >
          {step === 0 ? 'Cancel' : 'Previous'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button className="min-h-[44px]" onClick={next}>Next</Button>
        ) : (
          <Button className="min-h-[44px]" onClick={submit} disabled={isBusy}>
            {isBusy ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}
          </Button>
        )}
      </div>
    </div>
  );
}
