import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Employee, Department, Attendance, Holiday, AppSettings, Loan, LossDeduction, LoanInstallment, AdvanceInstallment } from './types';
import { fullName } from './types';
import { parseYmd, isWorkingDay, summarizeAttendance, computeLeavesBalance } from './attendance-utils';
import { loanRemaining, loanRemainingFromInstallments } from './payroll-utils';
import { getLogoBase64 } from './logo';

// jsPDF's built-in helvetica has no ₹ glyph — using "Rs." avoids garbled output
function money(n: number) {
  const v = Number(n) || 0;
  return 'Rs. ' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function downloadPdf(doc: jsPDF, filename: string) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Draw logo + company header. Returns Y position after the header separator line. */
function header(doc: jsPDF, settings: AppSettings | null | undefined, title: string): number {
  const company = settings?.company_name || '';
  const address = settings?.company_address || '';

  const logo = getLogoBase64();
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', 36, 18, 44, 32);
    } catch { /* ignore if logo fails */ }
  }
  const textX = logo ? 88 : 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  // Keep long legal names within the first-page bordered letterhead.
  let companySize = 15;
  while (companySize > 7 && doc.getTextWidth(company) > 559 - textX - 6) {
    companySize -= 0.4;
    doc.setFontSize(companySize);
  }
  doc.text(company, textX, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (address) {
    let addrSize = 9;
    doc.setFontSize(addrSize);
    while (addrSize > 6 && doc.getTextWidth(address) > 559 - textX - 5) {
      addrSize -= 0.25;
      doc.setFontSize(addrSize);
    }
    doc.text(address, textX, 44);
  }
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.65);
  doc.line(36, 56, 559, 56);
  doc.setLineWidth(0.2);
  doc.setDrawColor(200);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(28, 28, 28);
  doc.text(title, 36, 74);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, 36, 88);
  doc.setTextColor(0);
  return 96;
}

function footer(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, 559, 820, { align: 'right' });
    doc.setTextColor(0);
  }
  poweredByFooter(doc);
}

/** Draw the product attribution separately from the existing report footer. */
function poweredByFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(220);
    doc.setLineWidth(0.4);
    doc.line(36, pageH - 18, pageW - 36, pageH - 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text('POWERED BY ORCA DEVS SURF', pageW / 2, pageH - 7, { align: 'center' });
    doc.setTextColor(0);
    doc.setLineWidth(0.2);
  }
}

export function exportEmployeeAttendancePdf(opts: {
  employee: Employee;
  department: Department | null;
  attendance: Attendance[];
  holidays: Holiday[];
  from: Date;
  to: Date;
  periodLabel: string;
  settings: AppSettings | null | undefined;
  allAttendance?: Attendance[];
}, outputMode?: 'save' | 'base64'): string | void {
  const { employee, department, attendance, holidays, from, to, periodLabel, settings, allAttendance } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  header(doc, settings, `Attendance report — ${fullName(employee)}`);

  doc.setFontSize(10);
  const lines = [
    `Period: ${periodLabel}   (${from.toLocaleDateString('en-IN')} to ${to.toLocaleDateString('en-IN')})`,
    `Department: ${department?.name ?? '—'}`,
    `Joined: ${new Date(employee.joining_date).toLocaleDateString('en-IN')}`,
    `Mobile: ${employee.mobile}`,
  ];
  lines.forEach((t, i) => doc.text(t, 36, 108 + i * 14));

  const summary = summarizeAttendance(attendance, employee, department, holidays, from, to);
  const leaves = computeLeavesBalance(employee, allAttendance ?? attendance, to);

  autoTable(doc, {
    theme: 'grid',
    startY: 182,
    head: [['Metric', 'Value']],
    body: [
      ['Present', String(summary.present)],
      ['Half day', String(summary.halfDay)],
      ['Absent', String(summary.absent)],
      ['Unmarked', String(summary.unmarked)],
      ['Working days', String(summary.workingDays)],
      ['Paid leaves earned (lifetime)', String(leaves.earned)],
      ['Paid leaves used', String(leaves.used)],
      ['Paid leaves left', String(leaves.left)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [222, 222, 222], textColor: [25, 25, 25], lineColor: [40, 40, 40], lineWidth: 0.45 },
    margin: { left: 36, right: 36 },
  });

  const recByDate = new Map(attendance.map(r => [r.date, r] as const));
  const rows: string[][] = [];
  const cur = new Date(from);
  while (cur <= to) {
    const key = cur.toISOString().slice(0, 10);
    const working = isWorkingDay(cur, department, holidays);
    const joinD = parseYmd(employee.joining_date);
    const beforeJoin = cur < joinD;
    let status = '—';
    if (beforeJoin) status = 'Not joined';
    else if (!working) status = 'Non-working';
    else status = recByDate.get(key)?.status ?? 'Unmarked';
    rows.push([
      cur.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      cur.toLocaleDateString('en-IN', { weekday: 'short' }),
      status,
    ]);
    cur.setDate(cur.getDate() + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY ?? 240;
  autoTable(doc, {
    theme: 'grid',
    startY: finalY + 20,
    head: [['Date', 'Day', 'Status']],
    body: rows,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [222, 222, 222], textColor: [25, 25, 25], lineColor: [40, 40, 40], lineWidth: 0.45 },
    margin: { left: 36, right: 36 },
  });

  footer(doc);
  if (outputMode === 'base64') return doc.output('datauristring').split(',')[1];
  downloadPdf(doc, `attendance-${fullName(employee).replace(/\s+/g, '_')}-${periodLabel.replace(/\s+/g, '_')}.pdf`);
}

/** Returns the attendance PDF as a pure base64 string (no data-URI prefix). */
export function getAttendancePdfBase64(opts: Parameters<typeof exportEmployeeAttendancePdf>[0]): string {
  return exportEmployeeAttendancePdf(opts, 'base64') as string;
}

function addMonths(d: Date, n: number) {
  const x = new Date(d); x.setMonth(x.getMonth() + n); return x;
}

/** Loan / advance detail PDF (single record) with EMI schedule */
export function exportLoanDetailPdf(opts: {
  loan: Loan;
  employee: Employee;
  settings: AppSettings | null | undefined;
  kind: 'loan' | 'advance';
  /** Actual installment records — if provided, schedule is built from these (includes skip/ext rows) */
  installments?: Array<LoanInstallment | AdvanceInstallment>;
}, outputMode?: 'save' | 'base64'): string | void {
  const { loan, employee, settings, kind, installments } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const title = kind === 'loan' ? 'Loan details' : 'Advance details';
  header(doc, settings, `${title} — ${fullName(employee)}`);

  autoTable(doc, {
    theme: 'grid',
    startY: 108,
    head: [['Field', 'Value']],
    body: [
      ['Employee', fullName(employee)],
      ['Mobile', employee.mobile],
      ['Principal', money(loan.principal)],
      ['Interest', `${loan.interest_rate}% (${loan.interest_method})`],
      ['Original months', String(loan.months)],
      ['EMI', money(loan.emi)],
      ['Total payable', money(loan.total_payable)],
      ['Start date', new Date(loan.start_date).toLocaleDateString('en-IN')],
      ['Status', loan.status],
      ['EMIs paid', `${loan.paid_months} / ${loan.months}`],
      ['Remaining balance', money(
        installments && installments.length > 0
          ? loanRemainingFromInstallments(installments)
          : loanRemaining(loan)
      )],
      ['Discount', money(loan.discount_amount)],
      ['Paid off', loan.paid_off_date ? new Date(loan.paid_off_date).toLocaleDateString('en-IN') : '—'],
      ['Notes', loan.notes ?? '—'],
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [222, 222, 222], textColor: [25, 25, 25], lineColor: [40, 40, 40], lineWidth: 0.45 },
    margin: { left: 36, right: 36 },
  });

  // Build schedule — use real installments if available (respects skips/ext rows)
  const schedule: string[][] = [];
  if (installments && installments.length > 0) {
    const sorted = [...installments].sort((a, b) => a.emi_number - b.emi_number);
    const statusLabel = (inst: LoanInstallment | AdvanceInstallment): string => {
      switch (inst.status) {
        case 'paid_manual':         return 'Paid (cash)';
        case 'paid_payroll':        return 'Paid (payroll)';
        case 'paid_partial_manual': {
          const pa = Number(inst.paid_amount || 0);
          return `Partial: ${money(pa)} paid, ${money(Number(inst.amount) - pa)} via payroll`;
        }
        case 'skipped':        return 'Skipped — deferred to end';
        case 'partial_skipped': {
          const pa = Number(inst.paid_amount || 0);
          return `${money(pa)} paid — rest deferred`;
        }
        default:
          return inst.skip_generated ? 'Pending (extended)' : 'Pending';
      }
    };
    sorted.forEach(inst => {
      schedule.push([
        inst.skip_generated ? `${inst.emi_number} (ext.)` : String(inst.emi_number),
        new Date(inst.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        money(inst.amount),
        statusLabel(inst),
      ]);
    });
  } else {
    // Fallback — generate from loan fields alone
    const start = new Date(loan.start_date);
    for (let i = 0; i < loan.months; i++) {
      const due = addMonths(start, i);
      schedule.push([
        String(i + 1),
        due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        money(loan.emi),
        i < loan.paid_months ? 'Paid' : (loan.status === 'paid' ? 'Paid' : 'Pending'),
      ]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y1 = (doc as any).lastAutoTable?.finalY ?? 400;
  autoTable(doc, {
    theme: 'grid',
    startY: y1 + 16,
    head: [['EMI #', 'Due date', 'Amount', 'Status']],
    body: schedule,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [222, 222, 222], textColor: [25, 25, 25], lineColor: [40, 40, 40], lineWidth: 0.45 },
    margin: { left: 36, right: 36 },
  });

  footer(doc);
  if (outputMode === 'base64') return doc.output('datauristring').split(',')[1];
  downloadPdf(doc, `${kind}-${fullName(employee).replace(/\s+/g, '_')}-${loan.start_date}.pdf`);
}

/** Returns the loan/advance detail PDF as a pure base64 string (no data-URI prefix). */
export function getLoanDetailPdfBase64(opts: Parameters<typeof exportLoanDetailPdf>[0]): string {
  return exportLoanDetailPdf(opts, 'base64') as string;
}

/** All loans or advances summary PDF */
export function exportLoansSummaryPdf(opts: {
  loans: Loan[];
  employees: Employee[];
  settings: AppSettings | null | undefined;
  kind: 'loan' | 'advance';
}) {
  const { loans, employees, settings, kind } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const title = kind === 'loan' ? 'All loans' : 'All advances';
  header(doc, settings, title);

  const empMap = new Map(employees.map(e => [e.id, e] as const));
  const body = loans.map(l => {
    const e = empMap.get(l.employee_id);
    return [
      e ? fullName(e) : '—',
      money(l.principal),
      money(l.emi),
      `${l.paid_months}/${l.months}`,
      money(loanRemaining(l)),
      l.status,
      new Date(l.start_date).toLocaleDateString('en-IN'),
    ];
  });

  const totalPrincipal = loans.reduce((s, l) => s + Number(l.principal), 0);
  const totalRemaining = loans.reduce((s, l) => s + loanRemaining(l), 0);

  autoTable(doc, {
    theme: 'grid',
    startY: 108,
    head: [['Employee', 'Principal', 'EMI', 'Paid', 'Remaining', 'Status', 'Start']],
    body,
    foot: [['Totals', money(totalPrincipal), '', '', money(totalRemaining), '', '']],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [222, 222, 222], textColor: [25, 25, 25], lineColor: [40, 40, 40], lineWidth: 0.45 },
    footStyles: { fillColor: [245, 238, 238], textColor: 20, fontStyle: 'bold' },
    margin: { left: 36, right: 36 },
  });

  footer(doc);
  downloadPdf(doc, `${kind}s-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** Loss deductions summary PDF */
export function exportLossDeductionsPdf(opts: {
  deductions: LossDeduction[];
  employees: Employee[];
  settings: AppSettings | null | undefined;
}) {
  const { deductions, employees, settings } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  header(doc, settings, 'Loss deductions');

  const empMap = new Map(employees.map(e => [e.id, e] as const));
  const body = deductions.map(d => {
    const e = empMap.get(d.employee_id);
    return [
      e ? fullName(e) : '—',
      money(d.amount),
      d.reason || '—',
      d.status,
      d.deducted_on ? new Date(d.deducted_on).toLocaleDateString('en-IN') : '—',
      new Date(d.created_at).toLocaleDateString('en-IN'),
    ];
  });

  const total = deductions.reduce((s, d) => s + Number(d.amount), 0);
  const pending = deductions.filter(d => d.status === 'pending').reduce((s, d) => s + Number(d.amount), 0);

  autoTable(doc, {
    theme: 'grid',
    startY: 108,
    head: [['Employee', 'Amount', 'Reason', 'Status', 'Deducted on', 'Created']],
    body,
    foot: [['Totals', money(total), `Pending: ${money(pending)}`, '', '', '']],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [222, 222, 222], textColor: [25, 25, 25], lineColor: [40, 40, 40], lineWidth: 0.45 },
    footStyles: { fillColor: [245, 238, 238], textColor: 20, fontStyle: 'bold' },
    margin: { left: 36, right: 36 },
  });

  footer(doc);
  downloadPdf(doc, `loss-deductions-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── Ledger PDF ──────────────────────────────────────────────────────────────

interface LedgerEntry {
  date: string;
  narration: string;
  tag: string;
  dr: number;
  cr: number;
  balance: number;
  amountDue?: number;
}

function balanceLabel(bal: number): string {
  if (Math.abs(bal) < 0.01) return `Rs. 0.00 (Nil)`;
  const tag = bal > 0 ? '(DR)' : '(CR)';
  return `Rs. ${Math.abs(bal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${tag}`;
}

export function exportLedgerPdf(opts: {
  entries: LedgerEntry[];
  employeeName: string;
  periodLabel: string;
  openingBalance: number;
  totals: { dr: number; cr: number; bal: number };
  settings?: AppSettings | null;
}) {
  const { entries, employeeName, periodLabel, openingBalance, totals, settings } = opts;

  // Use landscape A4 for the wider ledger table
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageW = 841;

  const company = settings?.company_name || '';
  const address = settings?.company_address || '';

  const logo = getLogoBase64();
  if (logo) {
    try { doc.addImage(logo, 'JPEG', 36, 14, 36, 26); } catch { /* ignore */ }
  }
  const textX = logo ? 80 : 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  let titleSize = 14;
  while (titleSize > 7 && doc.getTextWidth(company) > pageW - textX - 40) {
    titleSize -= 0.35;
    doc.setFontSize(titleSize);
  }
  doc.text(company, textX, 27);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  if (address) doc.text(address, textX, 38);

  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(1);
  doc.line(36, 48, pageW - 36, 48);
  doc.setLineWidth(0.2);
  doc.setDrawColor(200);

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(28, 28, 28);
  doc.text('Employee Ledger', pageW / 2, 64, { align: 'center' });
  doc.setTextColor(0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Employee: ${employeeName}`, 36, 78);
  doc.text(`Period: ${periodLabel}`, 36, 89);

  // Summary row
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const summaryY = 99;
  doc.text(`Total DR: ${money(totals.dr)}`, 36, summaryY);
  doc.text(`Total CR: ${money(totals.cr)}`, 220, summaryY);
  doc.text(`Closing Balance: ${balanceLabel(totals.bal)}`, 400, summaryY);

  // Build table rows — opening balance first
  type Row = (string | { content: string; styles?: object })[];
  const tableBody: Row[] = [];

  const showOpening = Math.abs(openingBalance) > 0.01;
  if (showOpening) {
    tableBody.push([
      { content: '—', styles: { textColor: [130, 130, 130], fontStyle: 'italic' } },
      { content: 'Opening Balance (brought forward)', styles: { textColor: [130, 130, 130], fontStyle: 'italic' } },
      openingBalance > 0.01 ? money(openingBalance) : '—',
      openingBalance < -0.01 ? money(Math.abs(openingBalance)) : '—',
      '—',
      { content: balanceLabel(openingBalance), styles: { fontStyle: 'bold' } },
    ]);
  }

  for (const e of entries) {
    const dateStr = new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const narration = e.tag === 'salary-pending'
      ? `${e.narration}  [PENDING]`
      : e.narration;
    tableBody.push([
      dateStr,
      narration,
      e.dr > 0 ? money(e.dr) : '—',
      e.cr > 0 ? money(e.cr) : '—',
      (e.amountDue ?? 0) > 0 ? money(e.amountDue!) : '—',
      balanceLabel(e.balance),
    ]);
  }

  // Totals footer row
  const footRow: string[] = [
    `TOTAL — ${periodLabel}`,
    '',
    money(totals.dr),
    money(totals.cr),
    money(entries.reduce((s, e) => s + (e.amountDue ?? 0), 0)),
    balanceLabel(totals.bal),
  ];

  autoTable(doc, {
    theme: 'grid',
    startY: summaryY + 10,
    head: [['Date', 'Narration', 'DR (Rs.)', 'CR (Rs.)', 'Amount Due (Rs.)', 'Balance']],
    body: tableBody,
    foot: [footRow],
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: [155, 28, 28], fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 238, 238], textColor: 20, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 68 },
      2: { halign: 'right', cellWidth: 80 },
      3: { halign: 'right', cellWidth: 80 },
      4: { halign: 'right', cellWidth: 80 },
      5: { halign: 'right', cellWidth: 96, fontStyle: 'bold' },
    },
    margin: { left: 36, right: 36 },
  });

  // Footer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastY = (doc as any).lastAutoTable?.finalY ?? 500;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, 36, lastY + 16);
  doc.setTextColor(0);
  poweredByFooter(doc);

  downloadPdf(doc, `ledger-${employeeName.replace(/\s+/g, '_')}-${periodLabel}.pdf`);
}
