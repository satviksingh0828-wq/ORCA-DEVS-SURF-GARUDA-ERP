import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { formatConsignmentGst } from "./consignment-pdf-format";

type RecordValue = Record<string, unknown>;
type PdfInput = {
  consignment: RecordValue;
  shipments: RecordValue[];
  packages: RecordValue[];
};
type Info = [string, string];
type Cell = string;

const INK: [number, number, number] = [23, 31, 42];
const BLUE: [number, number, number] = [32, 62, 105];
const SOFT: [number, number, number] = [242, 245, 249];
const EDGE: [number, number, number] = [38, 44, 54];
const TERMS =
  "I/We hereby agree to the terms & conditions set out on the reverse of this consignor's copy & declare that the contents on the waybill are true and correct. The To-pay freight has my/our consent and will be paid by the consignee along with the applicable service charges at the time of delivery.";

const value = (item: unknown) => String(item ?? "").trim();
const number = (item: unknown) => Number(item ?? 0) || 0;
const comma = (...items: unknown[]) => items.map(value).filter(Boolean).join(", ");
const unique = (items: string[]) => [...new Set(items.filter(Boolean))];
const date = (item: unknown) => {
  const raw = value(item).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : raw;
};
const quantity = (item: unknown) =>
  number(item) ? number(item).toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "";
const money = (item: unknown) =>
  value(item) === "" ? "" : number(item).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const partyName = (item: RecordValue, prefix: "supplier" | "recipient") =>
  value(item[prefix + "_trade_name"]) || value(item[prefix + "_legal_name"]);
const partyAddress = (item: RecordValue, prefix: "supplier" | "recipient") => {
  const parts = [
    value(item[prefix + "_address_line_1"]) || value(item[prefix + "_address"]),
    value(item[prefix + "_address_line_2"]),
    comma(item[prefix + "_place"], item[prefix + "_state"]),
    value(item[prefix + "_pin_code"]),
  ];
  return unique(parts).join(", ");
};
const record = (item: unknown): RecordValue =>
  item && typeof item === "object" && !Array.isArray(item) ? (item as RecordValue) : {};

async function imageData(url: string): Promise<string | null> {
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

function fit(doc: jsPDF, content: string, x: number, y: number, maxWidth: number, fontSize = 8) {
  doc.setFontSize(fontSize);
  let size = fontSize;
  while (size > 5.5 && doc.getTextWidth(content) > maxWidth) {
    size -= 0.3;
    doc.setFontSize(size);
  }
  doc.text(content, x, y);
}

function lines(doc: jsPDF, content: string, width: number, size = 8): string[] {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  return (doc.splitTextToSize(content || " ", Math.max(20, width)) as string[]);
}

function outlined(doc: jsPDF, x: number, y: number, width: number, height: number) {
  doc.setDrawColor(...EDGE);
  doc.setLineWidth(0.8);
  doc.rect(x, y, width, height);
}

function shaded(doc: jsPDF, x: number, y: number, width: number, height: number) {
  doc.setFillColor(...SOFT);
  doc.rect(x, y, width, height, "F");
}

function barcodeAccent(doc: jsPDF, id: string, x: number, y: number, width: number) {
  // Document-reference stripes mirror the reference form; the printed ID below
  // is authoritative. These are not presented as a machine-scannable barcode.
  const alphabet = id || "GR";
  let cursor = x;
  let n = 0;
  while (cursor < x + width - 2) {
    const code = alphabet.charCodeAt(n % alphabet.length) || 65;
    const bar = 0.65 + ((code + n * 3) % 4) * 0.37;
    const gap = 0.8 + ((code + n) % 3) * 0.4;
    doc.setFillColor(...INK);
    doc.rect(cursor, y, Math.min(bar, x + width - cursor), 18 + (n % 6 === 0 ? 2 : 0), "F");
    cursor += bar + gap;
    n += 1;
  }
  doc.setFont("helvetica", "bold");
  fit(doc, id, x + width / 2 - Math.min(45, id.length * 2.1), y + 29, width - 2, 8.2);
}

function panelText(doc: jsPDF, label: string, content: string, x: number, y: number, labelWidth: number, totalWidth: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  fit(doc, content, x + labelWidth, y, totalWidth - labelWidth, 7.8);
}

function drawHeader(
  doc: jsPDF,
  logo: string | null,
  companyName: string,
  branch: RecordValue,
  grNumber: string,
  x: number,
  y: number,
  width: number,
) {
  const h = 78;
  const logoW = 86;
  const contactW = 175;
  const mainW = width - logoW - contactW;
  outlined(doc, x, y, width, h);
  doc.line(x + logoW, y, x + logoW, y + h);
  doc.line(x + logoW + mainW, y, x + logoW + mainW, y + h);

  if (logo) {
    try { doc.addImage(logo, "PNG", x + 8, y + 10, logoW - 16, h - 21); }
    catch { /* Leave the text logo if the image format is unavailable. */ }
  }
  if (!logo) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BLUE);
    fit(doc, "GARUDA", x + 7, y + 37, logoW - 14, 15);
    fit(doc, "LOGISTICS", x + 12, y + 49, logoW - 20, 8);
    doc.setTextColor(...INK);
  }

  const mainX = x + logoW + 9;
  const infoW = mainW - 145;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BLUE);
  fit(doc, companyName, mainX, y + 18, infoW - 8, 14.2);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  const addr1 = value(branch.address_line1);
  const addr2 = comma(branch.address_line2, branch.area_locality);
  const addr3 = comma(branch.city, branch.state) +
    (value(branch.pin_code) ? " - " + value(branch.pin_code) : "");
  fit(doc, addr1, mainX, y + 34, infoW - 7, 8.3);
  fit(doc, addr2, mainX, y + 45, infoW - 7, 8.3);
  fit(doc, addr3, mainX, y + 56, infoW - 7, 8.3);
  doc.setFont("helvetica", "bold");
  fit(doc, "SAC Code: 9965   |   GST: " + value(branch.gstin) + "   |   PAN: " + value(branch.pan),
    mainX, y + 69, mainW - 16, 7.1);
  barcodeAccent(doc, grNumber, x + logoW + mainW - 135, y + 10, 126);

  const sideX = x + logoW + mainW + 6;
  panelText(doc, "GST NO", value(branch.gstin), sideX, y + 13, 56, contactW - 12);
  panelText(doc, "PAN NO", value(branch.pan), sideX, y + 26, 56, contactW - 12);
  panelText(doc, "MOB NO", value(branch.mobile_number || branch.telephone_number), sideX, y + 39, 56, contactW - 12);
  doc.line(sideX - 5, y + 46, x + width, y + 46);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("CONSIGNOR COPY", sideX, y + 59);
  doc.setFont("helvetica", "normal");
  fit(doc, "Transport / Goods Receipt", sideX, y + 71, contactW - 12, 7);
  return y + h;
}

function checkbox(doc: jsPDF, x: number, y: number, label: string, selected: boolean) {
  doc.setLineWidth(0.6);
  doc.rect(x, y - 7, 7, 7);
  if (selected) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.1);
    doc.text("X", x + 1.1, y - 0.7);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.1);
  doc.text(label, x + 9, y - 0.5);
}

function drawParty(
  doc: jsPDF,
  title: string,
  name: string,
  address: string,
  gst: string,
  phone: string,
  side: Info[],
  payment: string | null,
  x: number,
  y: number,
  width: number,
) {
  const sideW = 205;
  const leftW = width - sideW;
  const nLines = lines(doc, name, leftW - 98, 8.7);
  const aLines = lines(doc, address, leftW - 98, 7.8);
  const h = Math.max(payment ? 94 : 86, 37 + nLines.length * 10 + aLines.length * 9 + 13);
  outlined(doc, x, y, width, h);
  doc.line(x + leftW, y, x + leftW, y + h);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(title.toUpperCase(), x + leftW / 2, y + 13, { align: "center" });
  doc.line(x, y + 17, x + leftW, y + 17);
  doc.setFontSize(7.9);
  doc.text(title + " :", x + 6, y + 29);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.7);
  doc.text(nLines, x + 85, y + 29);
  const addressY = y + 29 + nLines.length * 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.9);
  doc.text("Address :", x + 6, addressY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.text(aLines, x + 85, addressY);
  doc.line(x, y + h - 17, x + leftW, y + h - 17);
  panelText(doc, "GST NO :", gst, x + 6, y + h - 5, 53, leftW * 0.54);
  panelText(doc, "Mobile :", phone, x + leftW * 0.57, y + h - 5, 44, leftW * 0.41);

  const sideX = x + leftW + 6;
  const rowH = payment ? 11.1 : 11.2;
  side.forEach(([label, val], index) =>
    panelText(doc, label + " :", val, sideX, y + 12 + index * rowH, 79, sideW - 11));
  if (payment) {
    const toPay = payment === "billed";
    const paid = payment === "billed_and_paid";
    const tbb = payment === "to_be_billed" || (!toPay && !paid);
    doc.line(x + leftW, y + h - 24, x + width, y + h - 24);
    checkbox(doc, sideX, y + h - 8, "To Pay", toPay);
    checkbox(doc, sideX + 63, y + h - 8, "Paid", paid);
    checkbox(doc, sideX + 116, y + h - 8, "TBB", tbb);
  }
  return y + h;
}

function section(doc: jsPDF, title: string, x: number, y: number, width: number, h = 16) {
  shaded(doc, x, y, width, h);
  outlined(doc, x, y, width, h);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  doc.setTextColor(...BLUE);
  doc.text(title.toUpperCase(), x + 6, y + 11);
  doc.setTextColor(...INK);
  return y + h;
}

function cell(doc: jsPDF, content: string, x: number, y: number, width: number, height: number, opts?: { bold?: boolean; right?: boolean; size?: number }) {
  doc.setDrawColor(...EDGE);
  doc.setLineWidth(0.55);
  doc.rect(x, y, width, height);
  doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  const size = opts?.size ?? 7.5;
  doc.setFontSize(size);
  const chunks = lines(doc, content, width - 7, size);
  doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  chunks.forEach((chunk, index) =>
    doc.text(chunk, opts?.right ? x + width - 3.5 : x + 3.5, y + 10 + index * 8.5,
      opts?.right ? { align: "right" } : undefined));
}

function repeatTableHeader(doc: jsPDF, x: number, y: number, invoiceWidths: number[], chargeWidths: number[]) {
  const left = invoiceWidths.reduce((sum, w) => sum + w, 0);
  const right = chargeWidths.reduce((sum, w) => sum + w, 0);
  shaded(doc, x, y, left + right, 17);
  outlined(doc, x, y, left, 17);
  outlined(doc, x + left, y, right, 17);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("INVOICE DETAILS", x + left / 2, y + 12, { align: "center" });
  doc.text("GR / FREIGHT DETAILS", x + left + right / 2, y + 12, { align: "center" });
  y += 17;
  const heads1 = ["Invoice Date", "Box Type", "Pkgs", "Invoice Value", "Invoice Number", "E-Way Bill No"];
  const heads2 = ["Freight Type", "Unit", "Actual Qty", "Charged Qty", "Amount"];
  let tx = x;
  [...heads1, ...heads2].forEach((head, i) => {
    const w = i < invoiceWidths.length ? invoiceWidths[i] : chargeWidths[i - invoiceWidths.length];
    cell(doc, head, tx, y, w, 22, { bold: true, size: 7.1 });
    tx += w;
  });
  return y + 22;
}

function continuation(doc: jsPDF, grNumber: string, companyName: string, x: number, width: number) {
  doc.addPage();
  doc.setTextColor(...INK);
  outlined(doc, x, 14, width, 31);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(companyName, x + 8, 27, { maxWidth: width - 180 });
  doc.setFontSize(8.5);
  doc.text("GR " + grNumber + " - CONTINUED", x + 8, 39);
  doc.text("CONSIGNOR COPY", x + width - 8, 34, { align: "right" });
  return 49;
}

function drawDetail(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  left: Info,
  right: Info | null,
  onOverflow: () => number,
  maxY: number,
) {
  const half = right ? width / 2 : width;
  const labelWidth = Math.min(92, half * 0.28);
  const leftLines = lines(doc, left[1], half - labelWidth - 13, 7.8);
  const rightLines = right ? lines(doc, right[1], half - labelWidth - 13, 7.8) : [];
  const height = Math.max(17, Math.max(leftLines.length, rightLines.length) * 9 + 8);
  if (y + height > maxY) y = onOverflow();
  outlined(doc, x, y, half, height);
  if (right) outlined(doc, x + half, y, half, height);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.6);
  doc.text(left[0], x + 5, y + 11);
  if (right) doc.text(right[0], x + half + 5, y + 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.text(leftLines, x + labelWidth, y + 11);
  if (right) doc.text(rightLines, x + half + labelWidth, y + 11);
  return y + height;
}

function drawTerms(doc: jsPDF, x: number, y: number, width: number, onOverflow: () => number, maxY: number, companyName: string) {
  const chunks = lines(doc, TERMS, width - 16, 7.5);
  const height = 19 + chunks.length * 9;
  if (y + height + 43 > maxY) y = onOverflow();
  outlined(doc, x, y, width, height);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("TERMS & CONDITIONS", x + 6, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(chunks, x + 7, y + 22);
  y += height;
  outlined(doc, x, y, width, 40);
  doc.line(x + width / 3, y, x + width / 3, y + 40);
  doc.line(x + width * 2 / 3, y, x + width * 2 / 3, y + 40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Signature with Stamp", x + width / 6, y + 32, { align: "center" });
  doc.text("Booking Clerk", x + width / 2, y + 32, { align: "center" });
  doc.setTextColor(...BLUE);
  fit(doc, "FOR " + companyName, x + width * 2 / 3 + 8, y + 32, width / 3 - 16, 8.3);
  doc.setTextColor(...INK);
  return y + 40;
}

/**
 * Print the existing Consignor Copy fields in a GR layout based on the
 * bordered transport receipt reference. Long invoice lists paginate instead
 * of being squeezed into one cell or silently omitted.
 */
export async function printConsignorCopyPdf({ consignment, shipments, packages }: PdfInput) {
  const [companyResult, logo] = await Promise.all([
    supabase.from("company").select("company_name").limit(1).maybeSingle(),
    imageData("/garuda-logo.png"),
  ]);
  const companyName = value(companyResult.data?.company_name) ||
    "GARUDA LOGISTICS SOLUTION PRIVATE LIMITED";
  const branch = record(consignment.branch);
  const vehicle = record(consignment.vehicle);
  const driver = record(consignment.driver);
  const transporter = record(consignment.transporter);
  const rental = record(consignment.rental);
  const source = record(consignment.source);
  const shipment = shipments[0] || {};
  const grNumber = value(consignment.consignment_number) || "consignment";

  const items = shipments.flatMap((item) =>
    Array.isArray(item.shipment_items) ? item.shipment_items as RecordValue[] : []);
  const actualWeight = items.reduce((total, item) => total + number(item.weight_kg), 0);
  const chargedWeight = packages.reduce((total, item) => total + number(item.weight_kg), 0);
  const articles = packages.reduce((total, item) => total + number(item.quantity), 0) ||
    items.reduce((total, item) => total + number(item.quantity), 0);
  const packType = unique(packages.map((item) => value(item.package_type))).join(", ");
  const goods = items.map((item) => value(item.product_name) || value(item.description))
    .filter(Boolean).join(", ");
  const gstRate = items.reduce((total, item) =>
    total + number(item.gst_rate || item.cgst_rate) + number(item.sgst_rate) + number(item.igst_rate), 0);

  const from = value(shipment.dispatch_from_place) || value(shipment.supplier_place);
  const to = value(shipment.recipient_place);
  const invoiceRows: Cell[][] = shipments.length ? shipments.map((item) => {
    const matched = packages.filter((entry) => {
      const linked = record(entry.shipment);
      return (value(entry.shipment_id) && value(entry.shipment_id) === value(item.id)) ||
        (value(linked.eway_bill_number) && value(linked.eway_bill_number) === value(item.eway_bill_number));
    });
    const related = matched.length ? matched : shipments.length === 1 ? packages : [];
    return [
      date(item.document_date),
      unique(related.map((pkg) => value(pkg.package_type))).join(", "),
      quantity(related.reduce((sum, pkg) => sum + number(pkg.quantity), 0)),
      money(item.total_invoice_value),
      value(item.document_number),
      value(item.eway_bill_number),
    ];
  }) : [["", "", "", "", "", ""]];

  const charges: Cell[][] = [
    ["FREIGHT", "KG", quantity(actualWeight), quantity(chargedWeight), ""],
    ["Loading", "FIX", "", "", ""],
    ["Unloading", "FIX", "", "", ""],
    ["Toll", "FIX", "", "", ""],
  ];
  const adjustments: Array<[string, unknown, boolean]> = [
    ["Freight deduction", consignment.freight_deduction, true],
    ["Additional freight", consignment.additional_freight, false],
    ["Loading deduction", consignment.loading_deduction, true],
    ["Additional loading", consignment.additional_loading, false],
  ];
  adjustments.forEach(([label, amount, deduct]) => {
    if (number(amount)) charges.push([label, "FIX", "", "", (deduct ? "-" : "+") + money(amount)]);
  });
  charges.push(["GST", "", "", "", formatConsignmentGst(gstRate)]);
  charges.push(["TOTAL", "", "", "", ""]);

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const x = 15;
  const w = width - x * 2;
  const maxY = height - 30;
  pdf.setTextColor(...INK);
  pdf.setDrawColor(...EDGE);
  pdf.setFont("helvetica", "normal");

  let y = drawHeader(pdf, logo, companyName, branch, grNumber, x, 14, w);
  y = drawParty(pdf, "Consignor", partyName(shipment, "supplier"),
    partyAddress(shipment, "supplier"), value(shipment.supplier_gstin),
    value(shipment.supplier_phone), [
      ["GR No", grNumber],
      ["GR Date", date(consignment.consignment_date || consignment.created_at)],
      ["Origin", from],
      ["Destination", to],
      ["From PIN", value(consignment.from_pin_code)],
      ["To PIN", value(consignment.to_pin_code)],
    ], null, x, y, w);
  y = drawParty(pdf, "Consignee", partyName(shipment, "recipient"),
    partyAddress(shipment, "recipient"), value(shipment.recipient_gstin),
    value(shipment.recipient_phone), [
      ["Vehicle No", value(consignment.part_b_vehicle_no || vehicle.registration_number)],
      ["Driver", value(driver.full_name || driver.driver_code)],
      ["Mode", value(consignment.transport_mode).toUpperCase()],
      ["Packing Type", packType],
      ["Articles", quantity(articles)],
      ["E-Way Bill No", value(shipment.eway_bill_number)],
    ], value(consignment.billing_status), x, y, w);

  const invoiceWidths = [68, 70, 38, 84, 100, 108];
  const chargeWidths = [110, 37, 57, 59, w - invoiceWidths.reduce((a, b) => a + b, 0) - 263];
  const tableHeader = () => repeatTableHeader(pdf, x, y, invoiceWidths, chargeWidths);
  if (y + 58 > maxY) y = continuation(pdf, grNumber, companyName, x, w);
  y = tableHeader();
  for (let index = 0; index < Math.max(invoiceRows.length, charges.length); index += 1) {
    const invoice = invoiceRows[index] || ["", "", "", "", "", ""];
    const freight = charges[index] || ["", "", "", "", ""];
    const all = [...invoice, ...freight];
    const widths = [...invoiceWidths, ...chargeWidths];
    const rowLines = all.map((text, i) => lines(pdf, text, widths[i] - 7, 7.5).length);
    const rowHeight = Math.max(19, Math.max(...rowLines) * 8.5 + 7);
    if (y + rowHeight > maxY) {
      y = continuation(pdf, grNumber, companyName, x, w);
      y = tableHeader();
    }
    let cx = x;
    all.forEach((entry, col) => {
      cell(pdf, entry, cx, y, widths[col], rowHeight, {
        right: col === 2 || col === 3 || col === 8 || col === 9 || col === 10,
      });
      cx += widths[col];
    });
    y += rowHeight;
  }

  const nextPage = () => continuation(pdf, grNumber, companyName, x, w);
  if (y + 35 > maxY) y = nextPage();
  y = section(pdf, "Goods & document particulars", x, y + 5, w);
  const detailRows: Array<[Info, Info | null]> = [
    [["Goods Description :", goods], null],
    [["Packing Type :", packType], ["Articles :", quantity(articles)]],
    [["Actual Wt. :", quantity(actualWeight) + (actualWeight ? " KG" : "")],
      ["Charged Wt. :", quantity(chargedWeight) + (chargedWeight ? " KG" : "")]],
    [["Invoice No. :", shipments.map((row) => value(row.document_number)).filter(Boolean).join(", ")],
      ["Date :", shipments.map((row) => date(row.document_date)).filter(Boolean).join(", ")]],
    [["Value :", shipments.map((row) => money(row.total_invoice_value)).filter(Boolean).join(", ")],
      ["E-Way Bill No. :", shipments.map((row) => value(row.eway_bill_number)).filter(Boolean).join(", ")]],
    [["PO No. :", ""], ["Challan No. :", ""]],
    [["GST :", formatConsignmentGst(gstRate)], ["TOTAL :", ""]],
    [["Remarks :", value(consignment.remarks)], ["Rs in Words :", ""]],
    [["Delivery At :", to], ["IGST Paid By :", ""]],
    [["Acknowledgement :", "Goods received in good condition"], null],
  ];
  detailRows.forEach(([left, right]) => {
    y = drawDetail(pdf, x, y, w, left, right, nextPage, maxY);
  });

  const metadataRows: Array<[Info, Info | null]> = [
    [["Source / Contract :", value(source.contract_name)], ["Consignment Type :", value(consignment.consignment_type)]],
    [["Movement Mode :", value(consignment.movement_mode)], ["Own Transport :", value(consignment.own_transport_mode)]],
    [["Transporter :", value(transporter.transporter_name)], ["Transporter GST :", value(transporter.gstin)]],
    [["Rental :", value(rental.rental_name)], ["Delivery Date :", date(consignment.delivery_date)]],
    [["Transporter LR No. :", value(consignment.transporter_lr_number)],
      ["Transporter LR Date :", date(consignment.transporter_lr_date)]],
  ].filter(([left, right]) => left[1] || right?.[1]);
  if (metadataRows.length) {
    if (y + 35 > maxY) y = nextPage();
    y = section(pdf, "Transport & other particulars", x, y + 5, w);
    metadataRows.forEach(([left, right]) => {
      y = drawDetail(pdf, x, y, w, left, right, nextPage, maxY);
    });
  }
  y = drawTerms(pdf, x, y + 6, w, nextPage, maxY, companyName);

  const totalPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(...EDGE);
    pdf.setLineWidth(0.4);
    pdf.line(x, height - 22, width - x, height - 22);
    pdf.setTextColor(...INK);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text("Smart People Great Solution  |  POWERED BY ORCA DEVS SURF",
      width / 2, height - 12, { align: "center" });
    pdf.text(String(p) + " / " + String(totalPages), width - x, height - 12, { align: "right" });
  }
  pdf.save("Consignor-Copy-" + grNumber + ".pdf");
}
