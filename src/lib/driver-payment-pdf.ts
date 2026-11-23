import { printFinancialDocumentPdf, type PdfSection } from "@/lib/financial-document-pdf";

export type DriverPaymentDriver = Record<string, unknown> & {
  full_name: string;
  driver_code: string;
  branch_id?: string | null;
};
export type DriverPaymentReceipt = {
  kind: "Advance" | "Salary";
  amount: number;
  date: string;
  branchId?: string | null;
  reference?: string;
  isPaid?: boolean;
  month?: string;
  salaryAmount?: number;
  advanceDeduction?: number;
  monthlyDeduction?: number;
  remainingBalance?: number;
  note?: string | null;
  deductions?: Array<{ month: string; amount: number; applied: boolean }>;
};

const show = (value: unknown) => value == null || String(value).trim() === ""
  ? "Not recorded" : String(value);
const amountText = (amount: number | undefined) => "INR " + Number(amount ?? 0)
  .toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Save a branch-issued salary slip or advance voucher with accurate payment status. */
export function downloadDriverPaymentReceipt(driver: DriverPaymentDriver, payment: DriverPaymentReceipt) {
  const isSalary = payment.kind === "Salary";
  const paid = !isSalary || payment.isPaid === true;
  const number = payment.reference || [
    driver.driver_code, payment.kind, payment.month || payment.date,
  ].filter(Boolean).join("-");
  const id: PdfSection = {
    title: "Driver details",
    fields: [
      ["Driver", driver.full_name],
      ["Driver Code", driver.driver_code],
      ["Phone", show(driver.mobile_number)],
      ["Licence Number", show(driver.licence_number)],
      ["Bank Name", show(driver.bank_name)],
      ["Bank Account", show(driver.bank_account_number)],
      ["Salary Type", isSalary ? show(driver.salary_type) : "—"],
    ],
  };
  const payroll: PdfSection = {
    title: "Payroll details",
    fields: [
      ["Salary Month", show(payment.month)],
      ["Gross Salary", amountText(payment.salaryAmount)],
      ["Advance Deduction", amountText(payment.advanceDeduction)],
      ["Net Payable", amountText(payment.amount)],
      ["Payment Status", paid ? "Paid" : "Unpaid"],
      [paid ? "Payment Date" : "Payroll Created", payment.date],
    ],
  };
  const advance: PdfSection = {
    title: "Advance details",
    fields: [
      ["Advance Amount", amountText(payment.amount)],
      ["Disbursement Date", payment.date],
      ["Monthly Recovery", amountText(payment.monthlyDeduction)],
      ["Outstanding Balance", amountText(payment.remainingBalance)],
      ["Recovery Mode", "Deduct from future payroll"],
    ],
  };
  const schedule: PdfSection | null = !isSalary && payment.deductions?.length
    ? {
        title: "Recovery / deduction schedule",
        fields: payment.deductions.map((row) => [
          row.month + (row.applied ? " (Applied)" : " (Scheduled)"),
          amountText(row.amount),
        ]),
      }
    : null;
  return printFinancialDocumentPdf({
    title: isSalary ? "DRIVER SALARY SLIP" : "DRIVER ADVANCE RECEIPT",
    branchId: payment.branchId ?? driver.branch_id,
    documentNumber: number,
    documentDate: payment.date,
    status: isSalary ? (paid ? "Paid" : "Unpaid") : "Advance Recorded",
    statusNote: isSalary && !paid
      ? "Salary is not marked as paid. This slip is not a payment receipt."
      : undefined,
    amountLabel: isSalary ? (paid ? "NET SALARY PAID" : "NET SALARY PAYABLE") : "ADVANCE DISBURSED",
    amount: payment.amount,
    sections: [id, isSalary ? payroll : advance, ...(schedule ? [schedule] : [])],
    breakdown: isSalary
      ? [
          { label: "Gross Salary", amount: payment.salaryAmount ?? payment.amount },
          { label: "Advance Deduction", amount: payment.advanceDeduction, sign: "-" },
        ]
      : [
          { label: "Advance Amount", amount: payment.amount },
          { label: "Monthly Recovery", amount: payment.monthlyDeduction },
          { label: "Outstanding Balance (as of print)", amount: payment.remainingBalance },
        ],
    remarks: payment.note,
    filename: [
      isSalary ? "Driver-Salary" : "Driver-Advance",
      driver.driver_code || driver.full_name,
      payment.month || payment.date,
      payment.reference || "",
    ].filter(Boolean).join("-") + ".pdf",
  });
}
