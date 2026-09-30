import { jsPDF } from "jspdf";

export type PdfTableRow = (string | number)[];

export async function openBrandedTablePdf(options: {
  title: string;
  subtitle?: string;
  filename: string;
  columns: string[];
  rows: PdfTableRow[];
  summary?: Array<[string, string]>;
  orientation?: "portrait" | "landscape";
}) {
  const tab = window.open("", "_blank");
  const pdf = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: options.orientation ?? "portrait",
  });
  let logo: string | null = null;
  try {
    const blob = await fetch("/garuda-logo.png").then((response) => response.blob());
    logo = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    /* Text header remains available if the logo cannot load. */
  }
  const left = 14;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const width = pageWidth - left * 2;
  const colWidth = width / options.columns.length;
  let y = 18;

  const header = () => {
    pdf.setFillColor(79, 70, 229);
    pdf.rect(0, 0, pageWidth, 5, "F");
    if (logo) pdf.addImage(logo, "PNG", left, 9, 22, 14);
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("GARUDA LOGISTICS SOLUTIONS", logo ? 40 : left, 16);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text("OPERATIONS & TRANSPORT MANAGEMENT", logo ? 40 : left, 21);
    pdf.setDrawColor(203, 213, 225);
    pdf.line(left, 27, left + width, 27);
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text(options.title, left, 37);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139);
    if (options.subtitle) pdf.text(options.subtitle, left, 43);
    y = options.subtitle ? 51 : 46;
  };
  const tableHeader = () => {
    pdf.setFillColor(241, 245, 249);
    pdf.rect(left, y - 5, width, 8, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(51, 65, 85);
    options.columns.forEach((column, i) => pdf.text(column, left + i * colWidth + 1.5, y));
    y += 7;
  };
  header();
  tableHeader();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  options.rows.forEach((row, rowIndex) => {
    if (y > pageHeight - 22) {
      pdf.addPage();
      header();
      tableHeader();
    }
    if (rowIndex % 2) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(left, y - 4.5, width, 7, "F");
    }
    pdf.setTextColor(30, 41, 59);
    row.forEach((value, i) => {
      const text = pdf.splitTextToSize(String(value ?? "—"), colWidth - 3)[0] ?? "";
      pdf.text(text, left + i * colWidth + 1.5, y);
    });
    y += 7;
  });
  if (options.summary?.length) {
    y += 4;
    pdf.setDrawColor(226, 232, 240);
    pdf.line(left, y - 3, left + width, y - 3);
    options.summary.forEach(([label, value]) => {
      pdf.setFont("helvetica", "bold");
      pdf.text(label, left, y);
      pdf.text(value, left + width, y, { align: "right" });
      y += 7;
    });
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text("POWERED BY ORCA DEVS SURF", pageWidth / 2, pageHeight - 7, { align: "center" });
    pdf.text(`${page} / ${pages}`, pageWidth - left, pageHeight - 7, { align: "right" });
  }
  const data = pdf.output("datauristring");
  if (!tab) return pdf.save(options.filename);
  const safeTitle = options.title.replace(/[<>&"]/g, "");
  tab.document.write(
    `<!doctype html><html><head><title>${safeTitle}</title><style>*{box-sizing:border-box}body{margin:0;height:100vh;background:#f1f5f9;font-family:Arial;display:flex;flex-direction:column}.bar{height:58px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;padding:0 20px}.title{font-size:14px;font-weight:700;color:#0f172a}.sub{font-size:11px;color:#64748b;margin-top:3px}.btn{border:0;border-radius:7px;background:#4f46e5;color:#fff;padding:8px 15px;font-weight:700;cursor:pointer}.wrap{flex:1;padding:14px 14px 0}.wrap iframe{width:100%;height:100%;border:0;border-radius:8px;box-shadow:0 2px 12px #0002}.foot{text-align:center;padding:8px;font-size:10px;letter-spacing:.15em;font-weight:700;color:#64748b}</style></head><body><div class="bar"><div><div class="title">${safeTitle}</div><div class="sub">${options.subtitle ?? "PDF document"}</div></div><button class="btn" onclick="dl()">Download PDF</button></div><div class="wrap"><iframe src="${data}"></iframe></div><div class="foot"><a href="https://orca.devs.surf" target="_blank" rel="noreferrer" style="color:inherit;text-decoration:none">POWERED BY ORCA DEVS SURF</a></div><script>function dl(){const a=document.createElement('a');a.href='${data}';a.download='${options.filename}';a.click()}</script></body></html>`,
  );
  tab.document.close();
}
