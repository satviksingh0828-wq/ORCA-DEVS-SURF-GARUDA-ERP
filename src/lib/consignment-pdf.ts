import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

type AnyRecord = Record<string, unknown>;

type ConsignmentPdfOptions = {
  consignment: AnyRecord;
  shipments: AnyRecord[];
  packages: AnyRecord[];
};

const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number(value || 0);
const date = (value: unknown) => {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
};
const money = (value: unknown) =>
  num(value) ? num(value).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "";
const join = (...values: unknown[]) => values.map(text).filter(Boolean).join(", ");
const num3 = (value: number) =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function partyName(source: AnyRecord, prefix: "supplier" | "recipient") {
  return text(source[`${prefix}_trade_name`]) || text(source[`${prefix}_legal_name`]);
}

function partyAddress(source: AnyRecord, prefix: "supplier" | "recipient") {
  return [
    text(source[`${prefix}_address_line_1`]) || text(source[`${prefix}_address`]),
    text(source[`${prefix}_address_line_2`]),
    join(source[`${prefix}_place`], source[`${prefix}_state`]),
  ]
    .filter(Boolean)
    .join("\n");
}

function billingChecks(status: unknown) {
  const value = text(status).toLowerCase();
  return {
    toPay: value === "billed",
    paid: value === "billed_and_paid",
    tbb: value === "to_be_billed" || !value,
  };
}

async function imageData(path: string) {
  try {
    const blob = await fetch(path).then((response) => response.blob());
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

function addText(doc: jsPDF, value: string, x: number, y: number, width: number, lineHeight = 3.4) {
  if (!value) return 0;
  const lines = doc.splitTextToSize(value, width) as string[];
  doc.text(lines, x, y);
  return lines.length * lineHeight;
}

function cell(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  doc.rect(x, y, width, height);
  doc.setFont("helvetica", "bold");
  doc.text(label, x + 2, y + 4);
  doc.setFont("helvetica", "normal");
  const labelWidth = doc.getTextWidth(label) + 3;
  addText(doc, value, x + labelWidth, y + 4, Math.max(8, width - labelWidth - 2));
}

function checkbox(doc: jsPDF, x: number, y: number, label: string, checked: boolean) {
  doc.rect(x, y, 3.5, 3.5);
  if (checked) {
    doc.setFont("helvetica", "bold");
    doc.text("✓", x + 0.35, y + 3);
  }
  doc.setFont("helvetica", "normal");
  doc.text(label, x + 5, y + 3);
}

export async function printConsignorCopyPdf({
  consignment,
  shipments,
  packages,
}: ConsignmentPdfOptions) {
  const [companyResult, logo] = await Promise.all([
    supabase.from("company").select("company_name").limit(1).maybeSingle(),
    imageData("/garuda-logo.png"),
  ]);
  const companyName =
    text(companyResult.data?.company_name) || "GARUDA LOGISTICS SOLUTION PRIVATE LIMITED";
  const branch = (consignment.branch ?? {}) as AnyRecord;
  const first = shipments[0] ?? {};
  const allItems = shipments.flatMap((shipment) => (shipment.shipment_items ?? []) as AnyRecord[]);
  const ewayNumbers = shipments
    .map((shipment) => text(shipment.eway_bill_number))
    .filter(Boolean)
    .join(", ");
  const invoiceNumbers = shipments
    .map((shipment) => text(shipment.document_number))
    .filter(Boolean)
    .join(", ");
  const goods = allItems
    .map((item) => text(item.product_name) || text(item.description))
    .filter(Boolean)
    .join(", ");
  const packageRows = packages as AnyRecord[];
  const articleCount =
    packageRows.reduce((sum, entry) => sum + num(entry.quantity), 0) ||
    allItems.reduce((sum, item) => sum + num(item.quantity), 0);
  const actualWeight = allItems.reduce((sum, item) => sum + num(item.weight_kg), 0);
  const chargedWeight = packageRows.reduce((sum, entry) => sum + num(entry.weight_kg), 0);
  const packageType = packageRows
    .map((entry) => text(entry.package_type))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ");
  const gstRate = allItems.reduce(
    (sum, item) =>
      sum + num(item.gst_rate || item.cgst_rate) + num(item.sgst_rate) + num(item.igst_rate),
    0,
  );
  const billing = billingChecks(consignment.billing_status);
  const vehicle = (consignment.vehicle ?? {}) as AnyRecord;
  const branchAddress = [
    text(branch.address_line1),
    text(branch.address_line2),
    text(branch.area_locality),
    join(branch.city, branch.state),
    text(branch.pin_code) ? `- ${text(branch.pin_code)}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 8;
  const top = 8;
  const width = pageWidth - 16;
  const right = left + width;
  doc.setDrawColor(20, 20, 20);
  doc.setTextColor(20, 20, 20);
  doc.setLineWidth(0.25);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.rect(left, top, width, 264);

  // Header: fixed columns and generous inner padding prevent text from touching borders.
  const headerBottom = 39;
  doc.line(left, headerBottom, right, headerBottom);
  doc.line(142, top, 142, headerBottom);
  if (logo) doc.addImage(logo, "PNG", 10, 13, 25, 21);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.3);
  doc.text(
    `SAC Code :                         GST No. : ${text(branch.gstin)}       PAN No. : ${text(branch.pan)}`,
    10,
    11.5,
  );
  doc.setFontSize(10);
  doc.text(companyName, 39, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  addText(doc, branchAddress, 39, 22, 98, 3.2);
  doc.text(`GSTIN : ${text(branch.gstin)}`, 39, 34.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("CONSIGNOR COPY", 146, 13);
  doc.setFontSize(6.7);
  cell(doc, "GR No. :", text(consignment.consignment_number), 142, 16, 60, 7);
  cell(doc, "DATE :", date(consignment.consignment_date || consignment.created_at), 142, 23, 60, 7);
  cell(
    doc,
    "Truck/Flight No. :",
    text(consignment.part_b_vehicle_no || vehicle.registration_number),
    142,
    30,
    60,
    9,
  );

  // Movement and parties.
  const partiesBottom = 82;
  doc.line(left, partiesBottom, right, partiesBottom);
  doc.line(142, headerBottom, 142, partiesBottom);
  cell(doc, "Mode of Movement :", text(consignment.transport_mode).toUpperCase(), 142, 39, 60, 8);
  cell(
    doc,
    "From :",
    text(first.dispatch_from_place) || text(first.supplier_place),
    142,
    47,
    60,
    8,
  );
  cell(doc, "To :", text(first.recipient_place), 142, 55, 60, 8);
  cell(doc, "Packing Type :", packageType, 142, 63, 60, 8);
  cell(doc, "Article :", articleCount ? String(articleCount) : "", 142, 71, 60, 11);
  doc.setFont("helvetica", "bold");
  doc.text("Consignor", 10, 44);
  doc.text("Consignee", 10, 62);
  doc.setFont("helvetica", "normal");
  addText(
    doc,
    `${partyName(first, "supplier")}\n${partyAddress(first, "supplier")}\nGST No. : ${text(first.supplier_gstin)}    M : 0000000000`,
    10,
    48,
    126,
    3.5,
  );
  addText(
    doc,
    `${partyName(first, "recipient")}\n${partyAddress(first, "recipient")}\nGST No. : ${text(first.recipient_gstin)}    M : 0000000000`,
    10,
    66,
    126,
    3.5,
  );

  // Billing and weights have a dedicated non-overlapping row.
  const weightsBottom = 101;
  doc.line(left, weightsBottom, right, weightsBottom);
  doc.line(142, partiesBottom, 142, weightsBottom);
  doc.setFont("helvetica", "bold");
  doc.text("Billing", 145, 87);
  checkbox(doc, 160, 84, "To Pay", billing.toPay);
  checkbox(doc, 178, 84, "Paid", billing.paid);
  checkbox(doc, 193, 84, "TBB", billing.tbb);
  cell(doc, "Actual Wt.:", actualWeight ? num3(actualWeight) : "", 10, 84, 42, 10);
  cell(doc, "Charged Wt.:", chargedWeight ? num3(chargedWeight) : "", 52, 84, 46, 10);
  cell(doc, "Particulars:", "FREIGHT", 98, 84, 44, 10);

  // Consolidated goods and all E-Way Bills.
  const goodsBottom = 135;
  doc.line(left, goodsBottom, right, goodsBottom);
  cell(doc, "Goods Description :", goods, 10, 101, 192, 10);
  cell(doc, "Invoice No. :", invoiceNumbers, 10, 111, 96, 12);
  cell(
    doc,
    "Value :",
    shipments
      .map((shipment) => money(shipment.total_invoice_value))
      .filter(Boolean)
      .join(", "),
    106,
    111,
    96,
    12,
  );
  cell(doc, "Date :", date(first.document_date), 10, 123, 96, 12);
  cell(doc, "GST :", `${gstRate.toFixed(2)}%`, 106, 123, 96, 12);
  cell(doc, "E-Way Bill No. :", ewayNumbers, 10, 135, 192, 12);

  // Blank future fields remain intentionally blank, but retain their labels.
  cell(doc, "PO No. :", "", 10, 147, 64, 10);
  cell(doc, "Challan No. :", "", 74, 147, 64, 10);
  cell(doc, "TOTAL :", "", 138, 147, 64, 10);
  cell(doc, "Remarks :", "", 10, 157, 192, 10);
  cell(doc, "Rs in Words :", "", 10, 167, 192, 10);
  cell(doc, "Delivery At :", text(first.recipient_place), 10, 177, 64, 12);
  cell(doc, "Acknowledgement :", "Goods received in good condition", 74, 177, 64, 12);
  cell(doc, "IGST Paid By :", "", 138, 177, 64, 12);

  doc.setFont("helvetica", "bold");
  doc.text("Terms & Conditions :", 10, 196);
  doc.setFont("helvetica", "normal");
  addText(
    doc,
    "I/We hereby agree to the terms & conditions set out on the reverse of this consignor's copy & declare that the contents on the waybill are true and correct. The To-pay freight has my/our consent and will be paid by the consignee along with the applicable service charges at the time of delivery.",
    10,
    201,
    123,
    3.6,
  );
  doc.setTextColor(185, 28, 28);
  doc.setFont("helvetica", "bold");
  doc.text(`FOR ${companyName}`, 142, 201);
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "normal");
  doc.text("Signature with Stamp", 92, 247);
  doc.text("Booking Clerk", 171, 247);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("Smart People Great Solution", pageWidth / 2, 268, { align: "center" });
  doc.setFontSize(7);
  doc.text("POWERED BY ORCA DEVS SURF", pageWidth / 2, pageHeight - 7, { align: "center" });

  const filename = `Consignor-Copy-${text(consignment.consignment_number) || "consignment"}.pdf`;
  doc.save(filename);
}
