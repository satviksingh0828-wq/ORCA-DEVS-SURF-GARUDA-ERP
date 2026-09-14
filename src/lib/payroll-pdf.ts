import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Employee, Department, Position, Payroll, AppSettings, Loan, Advance, LossDeduction, LoanInstallment, AdvanceInstallment } from './types';
import { fullName, effectivePaymentStatus } from './types';
import { loanRemaining, loanRemainingFromInstallments } from './payroll-utils';
import { getLogoBase64 } from './logo';

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

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Draw the product attribution separately from the existing payslip footer. */
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

/** Draw logo + company header on the current page at the top. Returns the Y after the header line. */
function drawHeader(doc: jsPDF, company: string, address: string): number {
  const logo = getLogoBase64();
  if (logo) {
    try { doc.addImage(logo, 'PNG', 36, 20, 44, 32); } catch { /* ignore */ }
  }
  const textX = logo ? 88 : 40;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(company, textX, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (address) doc.text(address, textX, 46);
  doc.setDrawColor(155, 28, 28);
  doc.setLineWidth(1.2);
  doc.line(36, 58, 559, 58);
  doc.setLineWidth(0.2);
  doc.setDrawColor(200);
  return 62;
}

/** Draw a coloured payment-status banner. Returns the Y after the banner. */
function drawPaymentStatus(doc: jsPDF, payroll: Payroll, startY: number): number {
  const ps = effectivePaymentStatus(payroll);
  const net = Number(payroll.net) || 0;

  // Banner colours
  const colours: Record<string, [number, number, number]> = {
    paid:         [22, 163, 74],   // green
    partial_paid: [37, 99, 235],   // blue
    generated:    [217, 119, 6],   // amber
  };
  const [r, g, b] = colours[ps] ?? [100, 100, 100];

  // Determine history entries to display
  const history: { date: string; amount: number }[] = payroll.payment_history?.length
    ? payroll.payment_history
    : [];

  // Calculate box height based on content
  let boxH: number;
  if (ps === 'paid') {
    boxH = 16 + Math.max(1, history.length) * 12;
  } else if (ps === 'partial_paid') {
    boxH = 16 + Math.max(1, history.length) * 12 + 14;
  } else {
    boxH = 28;
  }

  doc.setFillColor(r, g, b);
  doc.setDrawColor(r, g, b);
  doc.roundedRect(36, startY, 523, boxH, 3, 3, 'FD');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);

  if (ps === 'paid') {
    doc.text('PAID', 48, startY + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (history.length > 0) {
      history.forEach((entry, idx) => {
        const label = history.length > 1
          ? `Payment ${idx + 1}: ${money(entry.amount)}  on  ${fmtDate(entry.date)}`
          : `${money(entry.amount)} transferred on ${fmtDate(entry.date)}`;
        doc.text(label, 48, startY + 22 + idx * 12);
      });
    } else {
      doc.text(
        `${money(Number(payroll.payment_amount ?? net))} transferred on ${fmtDate(payroll.payment_date!)}`,
        48, startY + 22,
      );
    }
  } else if (ps === 'partial_paid') {
    const paid = Number(payroll.payment_amount || 0);
    const outstanding = Math.max(0, net - paid);
    doc.text('PARTIAL PAYMENT MADE', 48, startY + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (history.length > 0) {
      history.forEach((entry, idx) => {
        doc.text(
          `Payment ${idx + 1}: ${money(entry.amount)}  on  ${fmtDate(entry.date)}`,
          48, startY + 22 + idx * 12,
        );
      });
      const outY = startY + 22 + history.length * 12;
      doc.text(
        `Outstanding: ${money(outstanding)}  |  Total net payable: ${money(net)}`,
        48, outY,
      );
    } else {
      doc.text(
        `Paid: ${money(paid)}  on  ${fmtDate(payroll.payment_date!)}`,
        48, startY + 22,
      );
      doc.text(
        `Outstanding: ${money(outstanding)}  |  Total net payable: ${money(net)}`,
        48, startY + 34,
      );
    }
  } else {
    // generated — pending
    doc.text('PAYMENT PENDING', 48, startY + 11);
    doc.setFont('helvetica', 'normal');
    doc.text('Salary not yet disbursed to bank/cash.', 48, startY + 22);
  }

  doc.setTextColor(0);
  doc.setDrawColor(200);
  return startY + boxH + 10;
}

export function exportPayrollPdf(opts: {
  payroll: Payroll;
  employee: Employee;
  department: Department | null;
  position: Position | null;
  settings: AppSettings | null | undefined;
  /** Active loans for this employee — shown as remaining-balance table in payslip */
  loans?: Loan[];
  /** Active advances for this employee */
  advances?: Advance[];
  /** Loss deductions included in this specific payroll (filter by payroll_id before passing) */
  lossDeductions?: LossDeduction[];
  /** All loan installments for this employee — used for accurate remaining balance */
  loanInstallments?: LoanInstallment[];
  /** All advance installments for this employee — used for accurate remaining balance */
  advanceInstallments?: AdvanceInstallment[];
}) {
  const { payroll, employee, department, position, settings, loans, advances, lossDeductions, loanInstallments, advanceInstallments } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = 595;
  const company = settings?.company_name || '';
  const address = settings?.company_address || '';

  drawHeader(doc, company, address);

  // ── "Payslip" heading — centered ──────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(155, 28, 28);
  doc.text('Payslip', pageW / 2, 82, { align: 'center' });
  doc.setTextColor(0);

  const from = new Date(payroll.period_start);
  const to   = new Date(payroll.period_end);
  const periodLabel = `${from.toLocaleDateString('en-IN')} — ${to.toLocaleDateString('en-IN')} (${payroll.period_type === 'half_month' ? 'Half month' : 'Month'})`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const meta: [string, string][] = [
    ['Employee',                 fullName(employee)],
    ['Address',                  employee.address],
    ['Department',               department?.name ?? '—'],
    ['Position',                 position?.name ?? '—'],
    ['Location',                 (employee as Employee & { location?: string | null }).location ?? '—'],
    ['Period',                   periodLabel],
    ['Working days',             String(payroll.working_days)],
    ['Days worked',              String(payroll.present_days)],
    ['Paid leaves used (period)',String(payroll.paid_leaves_used)],
    ['Paid leaves left',         String(payroll.paid_leaves_left)],
    ['Unpaid leaves (period)',   String(payroll.unpaid_leaves)],
  ];
  meta.forEach((m, i) => {
    doc.setFont('helvetica', 'bold');
    doc.text(m[0] + ':', 36, 104 + i * 14);
    doc.setFont('helvetica', 'normal');
    doc.text(m[1], 200, 104 + i * 14);
  });

  // Payment status banner — below meta block (11 meta items × 14px = 154 + 104 = 258 → 266 for banner)
  const bannerY = drawPaymentStatus(doc, payroll, 266);

  const paidLeavePayout = Number(payroll.paid_leave_payout_amount) || 0;
  const extraWorkDays   = Number(payroll.extra_work_days) || 0;
  const extraWorkPay    = Number(payroll.extra_work_pay) || 0;
  const earningsRows: [string, string][] = [
    ['Basic',            money(payroll.basic_salary)],
    ['HRA',              money(payroll.hra)],
    ['Travel allowance', money(payroll.travel_allowance)],
    ['Special allowance',money(payroll.special_allowance)],
    ['Other allowance',  money(payroll.other_allowance)],
  ];
  if (extraWorkPay > 0) {
    earningsRows.push([`Extra work days (${extraWorkDays} days)`, money(extraWorkPay)]);
  }
  if (paidLeavePayout > 0) {
    earningsRows.push(['Paid leave payout (final settlement)', money(paidLeavePayout)]);
  }
  earningsRows.push(['Gross', money(Number(payroll.gross) + extraWorkPay + paidLeavePayout)]);

  autoTable(doc, {
    startY: bannerY,
    head: [['Earnings', 'Amount']],
    body: earningsRows,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [155, 28, 28] },
    margin: { left: 36, right: 36 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y1 = (doc as any).lastAutoTable?.finalY ?? 420;

  // ── Deduction rows (with per-reason loss breakdown) ────────────────────────
  const deductionRows: [string, string][] = [
    ['PF',           money(payroll.pf_deduction)],
    ['Tax',          money(payroll.tax_deduction)],
    ['Unpaid leave', money(payroll.unpaid_leave_deduction)],
    ['Loan EMI',     money(payroll.loan_deduction)],
    ['Advance EMI',  money(payroll.advance_deduction)],
  ];

  if (lossDeductions && lossDeductions.length > 0) {
    lossDeductions.forEach(d => {
      deductionRows.push([`Loss deduction${d.reason ? ` (${d.reason})` : ''}`, money(d.amount)]);
    });
  } else if (Number(payroll.loss_deduction) > 0) {
    deductionRows.push(['Loss deduction', money(payroll.loss_deduction)]);
  }

  autoTable(doc, {
    startY: y1 + 16,
    head: [['Deductions', 'Amount']],
    body: deductionRows,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [155, 28, 28] },
    margin: { left: 36, right: 36 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y2 = (doc as any).lastAutoTable?.finalY ?? 540;

  // ── Loans & Advances balance (if any) ─────────────────────────────────────
  const hasLoans    = loans    && loans.length > 0;
  const hasAdvances = advances && advances.length > 0;
  let y3 = y2;

  if (hasLoans || hasAdvances) {
    const loanRows: [string, string, string, string][] = [];
    (loans ?? []).forEach(l => {
      const insts = (loanInstallments ?? []).filter(i => i.loan_id === l.id);
      const remaining = insts.length > 0
        ? loanRemainingFromInstallments(insts)
        : loanRemaining(l);
      loanRows.push([
        'Loan',
        money(l.principal),
        money(l.emi),
        money(remaining),
      ]);
    });
    (advances ?? []).forEach(a => {
      const insts = (advanceInstallments ?? []).filter(i => i.advance_id === a.id);
      const remaining = insts.length > 0
        ? loanRemainingFromInstallments(insts)
        : loanRemaining(a);
      loanRows.push([
        'Advance',
        money(a.principal),
        money(a.emi),
        money(remaining),
      ]);
    });

    autoTable(doc, {
      startY: y2 + 16,
      head: [['Type', 'Principal', 'EMI / month', 'Balance remaining']],
      body: loanRows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [100, 60, 160] },
      margin: { left: 36, right: 36 },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y3 = (doc as any).lastAutoTable?.finalY ?? y2 + 40;
  }

  // ── Net payable ────────────────────────────────────────────────────────────
  const net = Number(payroll.net);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  if (net < 0) {
    doc.setTextColor(200, 30, 30);
    doc.text(`Net payable: ${money(net)}  ⚠ NEGATIVE — deductions exceed earnings`, 36, y3 + 30);
    doc.setTextColor(0);
  } else {
    doc.setTextColor(30, 30, 30);
    doc.text(`Net payable: ${money(net)}`, 36, y3 + 30);
    doc.setTextColor(0);
  }

  if (paidLeavePayout > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text('(Includes paid leave payout of ' + money(paidLeavePayout) + ' for final settlement)', 36, y3 + 46);
    doc.setTextColor(0);
  }

  // ── Confidentiality notice — centered at bottom ────────────────────────────
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(100);
  const notice =
    'Since all matters related to compensation are private between you and the Company, ' +
    'you are requested to maintain strict confidentiality about the same.';
  doc.text(notice, pageW / 2, 808, { align: 'center', maxWidth: 480 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, 36, 820);
  doc.setTextColor(0);
  poweredByFooter(doc);

  downloadPdf(doc, `payslip-${fullName(employee).replace(/\s+/g, '_')}-${payroll.period_start}.pdf`);
}

/**
 * Same as exportPayrollPdf but returns the PDF as a pure base64 string (no data-URI prefix).
 * Useful for sending the PDF via WhatsApp or other channels without saving to disk.
 */
export function getPayrollPdfBase64(opts: Parameters<typeof exportPayrollPdf>[0]): string {
  const { payroll, employee, department, position, settings, loans, advances, lossDeductions, loanInstallments, advanceInstallments } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = 595;
  const company = settings?.company_name || '';
  const address = settings?.company_address || '';

  drawHeader(doc, company, address);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(155, 28, 28);
  doc.text('Payslip', pageW / 2, 82, { align: 'center' });
  doc.setTextColor(0);

  const from = new Date(payroll.period_start);
  const to   = new Date(payroll.period_end);
  const periodLabel = `${from.toLocaleDateString('en-IN')} — ${to.toLocaleDateString('en-IN')} (${payroll.period_type === 'half_month' ? 'Half month' : 'Month'})`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const meta: [string, string][] = [
    ['Employee',                  fullName(employee)],
    ['Address',                   employee.address],
    ['Department',                department?.name ?? '—'],
    ['Position',                  position?.name ?? '—'],
    ['Location',                  (employee as Employee & { location?: string | null }).location ?? '—'],
    ['Period',                    periodLabel],
    ['Working days',              String(payroll.working_days)],
    ['Days worked',               String(payroll.present_days)],
    ['Paid leaves used (period)', String(payroll.paid_leaves_used)],
    ['Paid leaves left',          String(payroll.paid_leaves_left)],
    ['Unpaid leaves (period)',    String(payroll.unpaid_leaves)],
  ];
  meta.forEach((m, i) => {
    doc.setFont('helvetica', 'bold');
    doc.text(m[0] + ':', 36, 104 + i * 14);
    doc.setFont('helvetica', 'normal');
    doc.text(m[1], 200, 104 + i * 14);
  });

  const bannerY = drawPaymentStatus(doc, payroll, 266);

  const paidLeavePayout = Number(payroll.paid_leave_payout_amount) || 0;
  const extraWorkDays   = Number(payroll.extra_work_days) || 0;
  const extraWorkPay    = Number(payroll.extra_work_pay) || 0;
  const earningsRows: [string, string][] = [
    ['Basic',            money(payroll.basic_salary)],
    ['HRA',              money(payroll.hra)],
    ['Travel allowance', money(payroll.travel_allowance)],
    ['Special allowance',money(payroll.special_allowance)],
    ['Other allowance',  money(payroll.other_allowance)],
  ];
  if (extraWorkPay > 0) earningsRows.push([`Extra work days (${extraWorkDays} days)`, money(extraWorkPay)]);
  if (paidLeavePayout > 0) earningsRows.push(['Paid leave payout (final settlement)', money(paidLeavePayout)]);
  const incentiveAmount = Number(payroll.incentive_amount) || 0;
  if (incentiveAmount > 0) earningsRows.push(['One-time incentive', money(incentiveAmount)]);
  earningsRows.push(['Gross', money(Number(payroll.gross) + extraWorkPay + incentiveAmount + paidLeavePayout)]);

  autoTable(doc, { startY: bannerY, head: [['Earnings', 'Amount']], body: earningsRows, styles: { fontSize: 10 }, headStyles: { fillColor: [155, 28, 28] }, margin: { left: 36, right: 36 } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y1 = (doc as any).lastAutoTable?.finalY ?? 420;

  const deductionRows: [string, string][] = [
    ['PF',           money(payroll.pf_deduction)],
    ['Tax',          money(payroll.tax_deduction)],
    ['Unpaid leave', money(payroll.unpaid_leave_deduction)],
    ['Loan EMI',     money(payroll.loan_deduction)],
    ['Advance EMI',  money(payroll.advance_deduction)],
  ];
  if (lossDeductions && lossDeductions.length > 0) {
    lossDeductions.forEach(d => { deductionRows.push([`Loss deduction${d.reason ? ` (${d.reason})` : ''}`, money(d.amount)]); });
  } else if (Number(payroll.loss_deduction) > 0) {
    deductionRows.push(['Loss deduction', money(payroll.loss_deduction)]);
  }
  autoTable(doc, { startY: y1 + 16, head: [['Deductions', 'Amount']], body: deductionRows, styles: { fontSize: 10 }, headStyles: { fillColor: [155, 28, 28] }, margin: { left: 36, right: 36 } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y2 = (doc as any).lastAutoTable?.finalY ?? 540;

  const hasLoans    = loans    && loans.length > 0;
  const hasAdvances = advances && advances.length > 0;
  let y3 = y2;
  if (hasLoans || hasAdvances) {
    const loanRows: [string, string, string, string][] = [];
    (loans ?? []).forEach(l => {
      const insts = (loanInstallments ?? []).filter(i => i.loan_id === l.id);
      loanRows.push(['Loan', money(l.principal), money(l.emi), money(insts.length > 0 ? loanRemainingFromInstallments(insts) : loanRemaining(l))]);
    });
    (advances ?? []).forEach(a => {
      const insts = (advanceInstallments ?? []).filter(i => i.advance_id === a.id);
      loanRows.push(['Advance', money(a.principal), money(a.emi), money(insts.length > 0 ? loanRemainingFromInstallments(insts) : loanRemaining(a))]);
    });
    autoTable(doc, { startY: y2 + 16, head: [['Type', 'Principal', 'EMI / month', 'Balance remaining']], body: loanRows, styles: { fontSize: 9 }, headStyles: { fillColor: [100, 60, 160] }, margin: { left: 36, right: 36 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y3 = (doc as any).lastAutoTable?.finalY ?? y2 + 40;
  }

  const net = Number(payroll.net);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  if (net < 0) {
    doc.setTextColor(200, 30, 30);
    doc.text(`Net payable: ${money(net)}  ⚠ NEGATIVE — deductions exceed earnings`, 36, y3 + 30);
  } else {
    doc.setTextColor(30, 30, 30);
    doc.text(`Net payable: ${money(net)}`, 36, y3 + 30);
  }
  doc.setTextColor(0);
  if (paidLeavePayout > 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80);
    doc.text('(Includes paid leave payout of ' + money(paidLeavePayout) + ' for final settlement)', 36, y3 + 46);
    doc.setTextColor(0);
  }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(100);
  doc.text('Since all matters related to compensation are private between you and the Company, you are requested to maintain strict confidentiality about the same.', pageW / 2, 808, { align: 'center', maxWidth: 480 });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, 36, 820);
  doc.setTextColor(0);
  poweredByFooter(doc);

  return doc.output('datauristring').split(',')[1];
}
