/**
 * Branch-issued income, expenditure, salary and advance vouchers.
 * The layout follows the ERP's bordered GR/Manifest form: grey title cells,
 * real issuing-branch tax identity, column-aligned fields and continuation pages.
 */
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

export type PdfField = [label: string, value: string | number | null | undefined];
export type PdfSection = { title: string; fields: PdfField[] };
export type PdfBreakdown = { label: string; amount: number | null | undefined; sign?: "-" | "+" };
export type FinancialDocumentOptions = {
  title: string;
  documentNumber: string;
  documentDate: string;
  branchId?: string | null;
  status: string;
  statusNote?: string;
  amountLabel: string;
  amount: number;
  sections: PdfSection[];
  breakdown?: PdfBreakdown[];
  remarks?: string | null;
  footerLabel?: string;
  filename: string;
};

const LEFT = 24;
const PAPER_WIDTH = 595.28;
const PAPER_HEIGHT = 841.89;
const CONTENT_WIDTH = PAPER_WIDTH - LEFT * 2;
const BOTTOM = PAPER_HEIGHT - 40;
const BLACK: [number, number, number] = [29, 29, 29];
const GREY: [number, number, number] = [222, 222, 222];
const NAVY: [number, number, number] = [25, 49, 77];
const str = (value: unknown) => String(value ?? "").trim();
const currency = (n: number | null | undefined) =>
  "INR " + (Number(n ?? 0) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
const shortDate = (input: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : input;
};
const safeName = (filename: string) => filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");

function border(doc: jsPDF, x: number, y: number, width: number, height: number, shaded = false) {
  doc.setLineWidth(0.65);
  doc.setDrawColor(...BLACK);
  if (shaded) {
    doc.setFillColor(...GREY);
    doc.rect(x, y, width, height, "FD");
  } else {
    doc.rect(x, y, width, height);
  }
}
function fit(doc: jsPDF, content: string, x: number, y: number, width: number, size = 8, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  while (size > 5.2 && doc.getTextWidth(content) > width) {
    size -= 0.2;
    doc.setFontSize(size);
  }
  let visible = content;
  if (doc.getTextWidth(visible) > width) {
    while (visible.length && doc.getTextWidth(visible + "...") > width)
      visible = visible.slice(0, -1);
    visible += "...";
  }
  doc.text(visible, x, y);
}
function wrapped(doc: jsPDF, content: string, width: number, size = 8) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  return doc.splitTextToSize(content || " ", width) as string[];
}
async function asset(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(str(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
async function letterhead(branchId: string | null | undefined) {
  // Never take GST/PAN/address from the company table: the issuing branch owns
  // the tax identity printed on each voucher.
  const [branch, company, logo] = await Promise.all([
    branchId
      ? supabase.from("branches")
          .select("branch_name,address_line1,address_line2,area_locality,city,state,pin_code,gstin,pan,mobile_number")
          .eq("id", branchId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("company").select("company_name").limit(1).maybeSingle(),
    asset("/garuda-logo.png"),
  ]);
  if (branchId && branch.error) throw new Error("Unable to load issuing branch: " + branch.error.message);
  return {
    companyName: str(company.data?.company_name) || "GARUDA LOGISTICS SOLUTION PRIVATE LIMITED",
    branch: branch.data,
    logo,
  };
}
function documentTitle(doc: jsPDF, title: string, letter: Awaited<ReturnType<typeof letterhead>>) {
  border(doc, LEFT, 22, CONTENT_WIDTH, 24, true);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(title.toUpperCase(), PAPER_WIDTH / 2, 38, { align: "center" });
  border(doc, LEFT, 46, CONTENT_WIDTH, 98);
  doc.line(LEFT + 89, 46, LEFT + 89, 144);
  doc.line(LEFT + CONTENT_WIDTH - 165, 46, LEFT + CONTENT_WIDTH - 165, 144);
  if (letter.logo) {
    try { doc.addImage(letter.logo, "PNG", LEFT + 5, 66, 78, 58); }
    catch { fit(doc, "GARUDA", LEFT + 6, 100, 80, 13, true); }
  } else fit(doc, "GARUDA", LEFT + 6, 100, 80, 13, true);
  const branch = letter.branch;
  const centerX = LEFT + 95;
  const centerW = CONTENT_WIDTH - 266;
  fit(doc, letter.companyName, centerX, 62, centerW, 11.8, true);
  fit(doc, str(branch?.branch_name), centerX, 77, centerW, 8, true);
  const addr1 = [str(branch?.address_line1), str(branch?.address_line2), str(branch?.area_locality)]
    .filter(Boolean).join(", ");
  const addr2 = [str(branch?.city), str(branch?.state), str(branch?.pin_code)]
    .filter(Boolean).join(", ");
  fit(doc, addr1, centerX, 92, centerW, 7.5);
  fit(doc, addr2, centerX, 103, centerW, 7.5);
  fit(doc, "GSTIN: " + str(branch?.gstin), centerX, 117, centerW, 7.4, true);
  fit(doc, "PAN: " + str(branch?.pan), centerX, 129, centerW, 7.4, true);
  const rightX = LEFT + CONTENT_WIDTH - 159;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("ISSUING BRANCH", rightX, 60);
  doc.line(rightX - 6, 65, LEFT + CONTENT_WIDTH, 65);
  fit(doc, str(branch?.branch_name), rightX, 78, 152, 7.8, true);
  fit(doc, "GST: " + str(branch?.gstin), rightX, 91, 152, 7);
  fit(doc, "PAN: " + str(branch?.pan), rightX, 104, 152, 7);
  fit(doc, "Phone: " + str(branch?.mobile_number), rightX, 117, 152, 7);
  return 153;
}
function labelValue(doc: jsPDF, x: number, y: number, width: number, label: string, content: string, valueH = 25) {
  border(doc, x, y, width, 17, true);
  fit(doc, label, x + 5, y + 11.3, width - 10, 7.3, true);
  border(doc, x, y + 17, width, valueH);
  fit(doc, content || "—", x + 5, y + 17 + Math.min(15, valueH - 4), width - 10, 8.4);
}
function newContinuation(doc: jsPDF, title: string, reference: string) {
  doc.addPage();
  doc.setTextColor(...BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  fit(doc, title + " — CONTINUED", LEFT + 5, 27, CONTENT_WIDTH - 180, 10, true);
  fit(doc, reference, LEFT + CONTENT_WIDTH - 173, 27, 169, 8, true);
  doc.line(LEFT, 35, LEFT + CONTENT_WIDTH, 35);
  return 46;
}
function sectionHeader(doc: jsPDF, name: string, y: number) {
  border(doc, LEFT, y, CONTENT_WIDTH, 19, true);
  fit(doc, name.toUpperCase(), LEFT + 5, y + 13, CONTENT_WIDTH - 10, 8, true);
  return y + 19;
}
function fields(doc: jsPDF, title: string, rows: PdfField[], y: number, ref: string) {
  if (rows.length === 0) return y;
  if (y + 54 > BOTTOM) y = newContinuation(doc, title, ref);
  y = sectionHeader(doc, title, y);
  const half = CONTENT_WIDTH / 2;
  for (let i = 0; i < rows.length; i += 2) {
    const pair = [rows[i], rows[i + 1]];
    const chunks = pair.map(entry => entry ? wrapped(doc, str(entry[1]) || "—", half - 104, 7.7) : []);
    const length = Math.max(1, ...chunks.map(x => x.length));
    let read = 0;
    while (read < length) {
      const capacity = Math.floor((BOTTOM - y - 11) / 9);
      if (capacity < 2) { y = newContinuation(doc, title, ref); continue; }
      const take = Math.min(capacity, length - read);
      const h = Math.max(20, take * 9 + 7);
      pair.forEach((entry, col) => {
        border(doc, LEFT + col * half, y, half, h);
        if (!entry) return;
        fit(doc, entry[0] + (read ? " cont." : "") + ":", LEFT + col * half + 5,
          y + 12, 94, 7.1, true);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.7);
        const part = chunks[col].slice(read, read + take);
        if (part.length) doc.text(part, LEFT + col * half + 101, y + 12);
      });
      y += h;
      read += take;
    }
  }
  return y + 6;
}
function breakdown(doc: jsPDF, rows: PdfBreakdown[], amount: number, amountLabel: string,
  y: number, title: string, reference: string) {
  if (y + 45 + 24 * rows.length > BOTTOM) y = newContinuation(doc, title, reference);
  y = sectionHeader(doc, "Financial summary", y);
  for (const row of rows) {
    if (y + 22 > BOTTOM) y = newContinuation(doc, title, reference);
    border(doc, LEFT, y, CONTENT_WIDTH, 22);
    fit(doc, row.label, LEFT + 8, y + 14, CONTENT_WIDTH - 190, 8);
    fit(doc, (row.sign || "") + currency(row.amount),
      LEFT + CONTENT_WIDTH - 170, y + 14, 160, 8.3, true);
    y += 22;
  }
  if (y + 35 > BOTTOM) y = newContinuation(doc, title, reference);
  border(doc, LEFT, y, CONTENT_WIDTH, 32, true);
  fit(doc, amountLabel.toUpperCase(), LEFT + 9, y + 21, 260, 9.4, true);
  fit(doc, currency(amount), LEFT + CONTENT_WIDTH - 210, y + 21, 198, 11.3, true);
  return y + 38;
}
function signature(doc: jsPDF, y: number, title: string, ref: string) {
  if (y + 73 > BOTTOM) y = newContinuation(doc, title, ref);
  border(doc, LEFT, y, CONTENT_WIDTH, 56);
  doc.line(LEFT + CONTENT_WIDTH / 2, y, LEFT + CONTENT_WIDTH / 2, y + 56);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Received / Prepared By", LEFT + CONTENT_WIDTH / 4, y + 45, { align: "center" });
  doc.text("Authorised Signatory / Stamp", LEFT + 3 * CONTENT_WIDTH / 4,
    y + 45, { align: "center" });
}
function footer(doc: jsPDF, title: string, reference: string) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setTextColor(...BLACK);
    doc.setLineWidth(0.5);
    doc.line(LEFT, PAPER_HEIGHT - 28, LEFT + CONTENT_WIDTH, PAPER_HEIGHT - 28);
    fit(doc, title + "  |  " + reference + "  |  POWERED BY ORCA DEVS SURF",
      LEFT + 2, PAPER_HEIGHT - 17, CONTENT_WIDTH - 70, 6.7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(i + " / " + pages, LEFT + CONTENT_WIDTH - 2, PAPER_HEIGHT - 17, { align: "right" });
  }
}

/** Download one accurate financial voucher without modifying accounting records. */
export async function printFinancialDocumentPdf(options: FinancialDocumentOptions) {
  const letter = await letterhead(options.branchId);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  pdf.setTextColor(...BLACK);
  pdf.setDrawColor(...BLACK);
  let y = documentTitle(pdf, options.title, letter);
  labelValue(pdf, LEFT, y, 194, "Document Reference", options.documentNumber);
  labelValue(pdf, LEFT + 194, y, 159, "Document Date", shortDate(options.documentDate));
  labelValue(pdf, LEFT + 353, y, CONTENT_WIDTH - 353, "Status", options.status);
  y += 51;

  if (options.statusNote) {
    const status = str(options.statusNote);
    const notes = wrapped(pdf, status, CONTENT_WIDTH - 12, 7.7);
    const height = Math.max(21, notes.length * 10 + 10);
    border(pdf, LEFT, y, CONTENT_WIDTH, height);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.7);
    pdf.text(notes, LEFT + 6, y + 13);
    y += height + 8;
  }
  for (const section of options.sections) {
    const meaningful = section.fields.filter(([name]) => str(name));
    y = fields(pdf, section.title, meaningful, y, options.documentNumber);
  }
  y = breakdown(pdf, options.breakdown ?? [], options.amount, options.amountLabel,
    y, options.title, options.documentNumber);
  if (str(options.remarks)) {
    y = fields(pdf, "Remarks", [["Note", options.remarks]], y, options.documentNumber);
  }
  signature(pdf, y + 4, options.title, options.documentNumber);
  footer(pdf, options.title, options.documentNumber);
  pdf.save(safeName(options.filename));
}
