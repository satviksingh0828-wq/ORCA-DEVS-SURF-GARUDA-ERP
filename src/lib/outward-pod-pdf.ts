import jsPDF from "jspdf";
import QRCode from "qrcode";
import { fetchCompany } from "@/lib/trip-note-pdf";

export type OutwardPODPdfData = {
  consignmentNumber: string;
  consignmentDate?: string | null;
  consignor?: string | null;
  consignee?: string | null;
  destination?: string | null;
  branchName?: string | null;
  branchAddress?: string | null;
  consignmentType?: string | null;
  deliveryDate?: string | null;
  transporterLrNumber?: string | null;
  transporterLrDate?: string | null;
  createdAt?: string | null;
  viewQrUrl: string;
};

const RED: [number, number, number] = [139, 26, 44];
const GREY: [number, number, number] = [110, 110, 110];

function value(value: unknown) {
  return value == null || String(value).trim() === "" ? "—" : String(value);
}

function drawHeader(doc: jsPDF, companyName: string, address: string, title: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(companyName || "ORCA DEVS SURF", 88, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const addressLines = address ? (doc.splitTextToSize(address, 420) as string[]) : [];
  if (addressLines.length) doc.text(addressLines, 88, 45);
  const lineY = addressLines.length ? 45 + addressLines.length * 12 + 5 : 58;
  doc.setDrawColor(...RED);
  doc.setLineWidth(1.2);
  doc.line(36, lineY, 559, lineY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...RED);
  const titleY = lineY + 19;
  doc.text(title, 36, titleY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  const generatedY = titleY + 14;
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, 36, generatedY);
  doc.setTextColor(0, 0, 0);
  return generatedY + 25;
}

function drawFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    const height = doc.internal.pageSize.getHeight();
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.4);
    doc.line(36, height - 28, 559, height - 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`Page ${page} of ${pageCount}`, 559, height - 37, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text("POWERED BY ORCA DEVS SURF", 297.5, height - 12, { align: "center" });
    doc.setTextColor(0, 0, 0);
  }
}

function drawField(
  doc: jsPDF,
  label: string,
  fieldValue: unknown,
  x: number,
  y: number,
  width: number,
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const lines = doc.splitTextToSize(value(fieldValue), width - 110) as string[];
  doc.text(lines, x + 110, y);
  return Math.max(18, lines.length * 13);
}

export async function printOutwardPOD(data: OutwardPODPdfData): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.title = `Outward POD - ${data.consignmentNumber}`;
    tab.document.body.innerHTML =
      "<p style='font-family:Arial;padding:32px'>Preparing Outward POD PDF…</p>";
  }

  try {
    const [company, qrDataUrl] = await Promise.all([
      fetchCompany(),
      QRCode.toDataURL(data.viewQrUrl, { width: 360, margin: 2, errorCorrectionLevel: "M" }),
    ]);
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const companyAddress = [
      company?.address_line1,
      company?.address_line2,
      company?.city,
      company?.state,
      company?.pin_code,
    ]
      .filter(Boolean)
      .join(", ");
    const branchAddress = data.branchAddress?.trim() || companyAddress;
    const headerAddress = data.branchName
      ? `${data.branchName}${branchAddress ? `, ${branchAddress}` : ""}`
      : branchAddress;
    const contentStartY = drawHeader(
      doc,
      company?.company_name ?? "ORCA DEVS SURF",
      headerAddress,
      "Outward POD",
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    doc.text("CONSIGNMENT DETAILS", 36, contentStartY);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.6);
    const detailsY = contentStartY + 12;
    doc.roundedRect(36, detailsY, 523, 180, 4, 4);

    let y = detailsY + 24;
    y += drawField(doc, "Consignment No.", data.consignmentNumber, 52, y, 235);
    y += drawField(doc, "Consignment Date", data.consignmentDate, 52, y, 235);
    y += drawField(doc, "Consignor", data.consignor, 52, y, 235);
    y += drawField(doc, "Consignee", data.consignee, 52, y, 235);
    drawField(doc, "Destination", data.destination, 52, y, 235);

    let rightY = detailsY + 24;
    rightY += drawField(
      doc,
      "POD Type",
      data.consignmentType === "third_party" ? "Third Party" : "Own",
      315,
      rightY,
      235,
    );
    rightY += drawField(doc, "Delivery Date", data.deliveryDate, 315, rightY, 235);
    if (data.consignmentType === "third_party") {
      rightY += drawField(doc, "Transporter LR No.", data.transporterLrNumber, 315, rightY, 235);
      rightY += drawField(doc, "Transporter LR Date", data.transporterLrDate, 315, rightY, 235);
    }
    drawField(
      doc,
      "POD Created",
      data.createdAt ? new Date(data.createdAt).toLocaleDateString("en-IN") : null,
      315,
      rightY,
      235,
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    const qrTitleY = detailsY + 220;
    doc.text("VIEW-ONLY MOBILE QR", 36, qrTitleY);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(200, 200, 200);
    const qrBoxY = qrTitleY + 12;
    doc.roundedRect(36, qrBoxY, 523, 180, 4, 4);
    doc.addImage(qrDataUrl, "PNG", 54, qrBoxY + 18, 144, 144);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Outward POD view mode", 225, qrBoxY + 44);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      doc.splitTextToSize(
        "Scan this QR in ORCA Documents to view the POD and its attached documents. This QR is view-only; it cannot replace files or edit POD details.",
        275,
      ),
      225,
      qrBoxY + 69,
    );

    drawFooter(doc);
    const blobUrl = URL.createObjectURL(doc.output("blob"));
    if (tab) {
      tab.location.href = blobUrl;
    } else {
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `outward-pod-${data.consignmentNumber}.pdf`;
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    if (tab) tab.close();
    throw error;
  }
}
