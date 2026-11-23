import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";

export type PdfTableRow = (string | number)[];

type PdfOptions = {
  title: string;
  subtitle?: string;
  filename: string;
  columns: string[];
  rows: PdfTableRow[];
  summary?: Array<[string, string]>;
  orientation?: "portrait" | "landscape";
  /** The actual issuing branch. Null means a consolidated multi-branch report. */
  branchId?: string | null;
};
const PT_BLACK: [number, number, number] = [28, 28, 28];
const PALE: [number, number, number] = [228, 228, 228];

function display(value: unknown) {
  const result = String(value ?? "—").trim();
  return (result || "—").replace(/₹/g, "Rs. ");
}
function htmlSafe(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function widths(headers: string[], total: number) {
  const weights = headers.map((head) => {
    const t = head.toLowerCase();
    if (/amount|debit|credit|balance|total|weight|^₹$|^rs/.test(t)) return 1.0;
    if (/description|particular|narration|detail/.test(t)) return 2.2;
    if (/account|ledger|liabilit|asset|expenditure|income/.test(t)) return 1.65;
    if (/voucher|reference|document/.test(t)) return 1.3;
    if (/date|type|side|line/.test(t)) return 0.95;
    return 1.2;
  });
  const denominator = weights.reduce((n, w) => n + w, 0) || 1;
  return weights.map((weight) => total * weight / denominator);
}
async function imageData(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
async function issuingBranch(branchId?: string | null) {
  const [branch, company, logo] = await Promise.all([
    branchId ? supabase.from("branches")
      .select("branch_name,address_line1,address_line2,area_locality,city,state,pin_code,gstin,pan,mobile_number")
      .eq("id", branchId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("company").select("company_name").limit(1).maybeSingle(),
    imageData("/garuda-logo.png"),
  ]);
  if (branch.error) throw new Error("Could not load branch for PDF: " + branch.error.message);
  return { company: display(company.data?.company_name || "GARUDA LOGISTICS"), branch: branch.data, logo };
}

/**
 * One bounded, multi-page GR-style tabular PDF renderer, shared by Accounts,
 * billing, reporting and other ERP exports. Every text line survives page
 * breaks: unlike the previous renderer, only the first line is not extracted.
 */
export async function openBrandedTablePdf(options: PdfOptions) {
  const tab = typeof window === "undefined" ? null : window.open("", "_blank");
  const pdf = new jsPDF({
    unit: "mm", format: "a4",
    orientation: options.orientation ?? "portrait",
  });
  const info = await issuingBranch(options.branchId);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 9;
  const width = pageWidth - 2 * left;
  const endY = pageHeight - 15;
  const cols = options.columns.length;
  if (cols < 1) throw new Error("A PDF report needs at least one column.");
  const colWidths = widths(options.columns, width);
  const fontSize = cols >= 10 ? 5.9 : cols >= 8 ? 6.5 : cols >= 6 ? 7.0 : 7.6;
  const lineHeight = fontSize * 0.40 + 0.65;
  let y = 0;
  pdf.setDrawColor(...PT_BLACK);
  pdf.setLineWidth(0.16);

  const fit = (value: string, x: number, top: number, maxWidth: number, size = 7.3, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    let current = size;
    while (current > 5.1 && pdf.getTextWidth(value) > maxWidth) {
      current -= 0.25;
      pdf.setFontSize(current);
    }
    let visible = value;
    if (pdf.getTextWidth(visible) > maxWidth) {
      while (visible && pdf.getTextWidth(visible + "...") > maxWidth)
        visible = visible.slice(0, -1);
      visible += "...";
    }
    pdf.text(visible, x, top);
  };
  const header = () => {
    y = 9;
    pdf.setDrawColor(...PT_BLACK);
    pdf.setTextColor(...PT_BLACK);
    pdf.rect(left, y, width, 28.5);
    pdf.line(left + 30, y, left + 30, y + 28.5);
    if (info.logo) {
      try { pdf.addImage(info.logo, "PNG", left + 2, y + 4.5, 26, 19); }
      catch { fit("GARUDA", left + 3, y + 17, 24, 11, true); }
    } else fit("GARUDA", left + 3, y + 17, 24, 11, true);
    const tx = left + 33;
    fit(info.company, tx, y + 6, width - 36, 10.3, true);
    const branch = info.branch;
    const address = [branch?.address_line1, branch?.address_line2, branch?.area_locality]
      .filter(Boolean).join(", ");
    const location = [branch?.city, branch?.state, branch?.pin_code]
      .filter(Boolean).join(", ");
    fit(options.branchId ? (branch?.branch_name || "Issuing Branch") : "Consolidated / Multiple Branches",
      tx, y + 11.8, width - 36, 7.1, true);
    if (options.branchId) {
      fit(address, tx, y + 16.1, width - 36, 6.7);
      fit(location, tx, y + 20.4, width - 36, 6.7);
      fit("GSTIN: " + (branch?.gstin || "—") + "    PAN: " + (branch?.pan || "—") +
        "    Contact: " + (branch?.mobile_number || "—"), tx, y + 25, width - 36, 6.7);
    } else {
      fit("Amounts may include multiple issuing branches. No single-branch GSTIN/PAN is implied.",
        tx, y + 20, width - 36, 6.9);
    }
    y += 31;
    pdf.setFillColor(...PALE);
    pdf.rect(left, y, width, 9, "FD");
    fit(display(options.title), left + 2, y + 6.2, width - 4, 10, true);
    y += 11;
    if (options.subtitle) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      const notes = pdf.splitTextToSize(display(options.subtitle), width - 4) as string[];
      pdf.text(notes, left + 2, y + 1);
      y += 2 + notes.length * 3.1;
    }
    y += 2;
  };
  const columnHeader = () => {
    const lines = options.columns.map((column, i) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(fontSize);
      return (pdf.splitTextToSize(display(column), colWidths[i] - 2.6) as string[]);
    });
    const longest = Math.max(1, ...lines.map((parts) => parts.length));
    const height = Math.max(9.5, longest * lineHeight + 3);
    let x = left;
    pdf.setDrawColor(...PT_BLACK);
    pdf.setFillColor(...PALE);
    lines.forEach((pieces, i) => {
      pdf.rect(x, y, colWidths[i], height, "FD");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(fontSize);
      pdf.text(pieces, x + 1.3, y + 3.4);
      x += colWidths[i];
    });
    y += height;
  };
  const nextPage = () => { pdf.addPage(); header(); columnHeader(); };
  const rawRows = options.rows;
  header();
  columnHeader();
  rawRows.forEach((row) => {
    const contents = options.columns.map((_, i) => {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(fontSize);
      return pdf.splitTextToSize(display(row[i]), colWidths[i] - 2.6) as string[];
    });
    const lineCount = Math.max(1, ...contents.map((v) => v.length));
    let lineOffset = 0;
    while (lineOffset < lineCount) {
      const capacity = Math.floor((endY - y - 3) / lineHeight);
      if (capacity < 1 || endY - y < 7) { nextPage(); continue; }
      const take = Math.min(lineCount - lineOffset, capacity);
      const rowHeight = Math.max(6.6, take * lineHeight + 2.5);
      if (y + rowHeight > endY) { nextPage(); continue; }
      let x = left;
      contents.forEach((pieces, i) => {
        pdf.setDrawColor(...PT_BLACK);
        pdf.rect(x, y, colWidths[i], rowHeight);
        pdf.setTextColor(...PT_BLACK);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(fontSize);
        const fragment = pieces.slice(lineOffset, lineOffset + take);
        if (fragment.length) pdf.text(fragment, x + 1.3, y + 3.4);
        x += colWidths[i];
      });
      y += rowHeight;
      lineOffset += take;
    }
  });
  if (options.summary?.length) {
    if (y + 8 + options.summary.length * 7 > endY) nextPage();
    y += 3;
    for (const [label, amount] of options.summary) {
      if (y + 7 > endY) nextPage();
      pdf.setFillColor(...PALE);
      pdf.rect(left, y, width, 7, "FD");
      fit(display(label), left + 2, y + 4.8, width * 0.58, 7.7, true);
      fit(display(amount), left + width * 0.59, y + 4.8, width * 0.39, 7.7, true);
      y += 7;
    }
  }
  if (y + 14 < endY) {
    y += 4;
    pdf.setDrawColor(...PT_BLACK);
    pdf.line(left, y, left + width, y);
    fit("Prepared by", left + 5, y + 9, width / 2 - 10, 7.1);
    fit("Authorised by", left + width / 2 + 5, y + 9, width / 2 - 10, 7.1);
  }
  for (let i = 1; i <= pdf.getNumberOfPages(); i += 1) {
    pdf.setPage(i);
    pdf.setTextColor(...PT_BLACK);
    pdf.line(left, pageHeight - 11, left + width, pageHeight - 11);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.6);
    pdf.text("POWERED BY ORCA DEVS SURF", pageWidth / 2, pageHeight - 6, { align: "center" });
    pdf.text(i + " / " + pdf.getNumberOfPages(), left + width, pageHeight - 6,
      { align: "right" });
  }

  if (!tab) {
    pdf.save(options.filename);
    return;
  }
  const url = URL.createObjectURL(pdf.output("blob"));
  const safeTitle = htmlSafe(options.title);
  const safeSubtitle = htmlSafe(options.subtitle || "PDF document");
  const safeFilename = htmlSafe(options.filename);
  tab.document.open();
  tab.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>' + safeTitle +
    '</title><style>body{margin:0;background:#eee;font-family:Arial;display:flex;flex-direction:column;height:100vh}' +
    '.bar{height:52px;background:#fff;border-bottom:1px solid #bbb;display:flex;align-items:center;' +
    'justify-content:space-between;padding:0 18px}.title{font-weight:bold;font-size:14px}' +
    '.sub{font-size:11px;color:#555}.btn{border:1px solid #444;color:#111;background:#f1f1f1;' +
    'border-radius:5px;padding:9px 13px;text-decoration:none;font-size:12px;font-weight:bold}' +
    'iframe{width:100%;height:100%;border:0}.wrap{flex:1;min-height:0;padding:10px}</style></head><body>' +
    '<div class="bar"><div><div class="title">' + safeTitle + '</div><div class="sub">' +
    safeSubtitle + '</div></div><a class="btn" download="' + safeFilename + '" href="' +
    htmlSafe(url) + '">Download PDF</a></div><div class="wrap"><iframe title="' + safeTitle +
    '" src="' + htmlSafe(url) + '"></iframe></div></body></html>',
  );
  tab.document.close();
}
