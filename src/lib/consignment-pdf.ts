import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

type AnyRecord = Record<string, unknown>;

type ConsignmentPdfOptions = {
  consignment: AnyRecord;
  shipments: AnyRecord[];
  packages: AnyRecord[];
};

const A4_WIDTH = 595;
const A4_HEIGHT = 841;
const FORM_X = 16;
const FORM_Y = 49;
const FORM_W = 565;
const FORM_H = 358;
const BLACK: [number, number, number] = [20, 20, 20];
const RED: [number, number, number] = [185, 28, 28];

const text = (value: unknown) => String(value ?? "").trim();
const display = (value: unknown) => text(value);
const num = (value: unknown) => Number(value || 0);
const date = (value: unknown) => {
  const raw = text(value).slice(0, 10);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
};
const money = (value: unknown) => {
  const number = num(value);
  if (!number) return "";
  return number.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};
const join = (...values: unknown[]) => values.map(text).filter(Boolean).join(", ");
const numberString = (value: number, fraction = 3) =>
  value.toLocaleString("en-IN", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  });

function addressLines(party: AnyRecord, prefix: "supplier" | "recipient") {
  return [
    text(party[`${prefix}_address_line_1`]) || text(party[`${prefix}_address`]),
    text(party[`${prefix}_address_line_2`]),
    join(party[`${prefix}_place`], party[`${prefix}_state`]),
  ].filter(Boolean);
}

function partyName(party: AnyRecord, prefix: "supplier" | "recipient") {
  return text(party[`${prefix}_trade_name`]) || text(party[`${prefix}_legal_name`]);
}

function billingCheckboxes(status: unknown) {
  const normalized = text(status).toLowerCase();
  return {
    toPay: normalized === "billed",
    paid: normalized === "billed_and_paid",
    tbb: normalized === "to_be_billed" || !normalized,
  };
}

function safeImageData(url: string): Promise<string | null> {
  return fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => null);
}

function drawWrapped(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  width: number,
  lineHeight = 7,
) {
  if (!value) return 0;
  const lines = doc.splitTextToSize(value, width) as string[];
  doc.text(lines, x, y);
  return lines.length * lineHeight;
}

function field(doc: jsPDF, label: string, value: string, x: number, y: number, width: number) {
  doc.setFont("helvetica", "bold");
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.text(value, x + doc.getTextWidth(label) + 3, y, { maxWidth: width });
}

function checkbox(doc: jsPDF, x: number, y: number, label: string, checked: boolean) {
  doc.rect(x, y - 8, 15, 10);
  doc.setFont("helvetica", "normal");
  doc.text(label, x + 18, y);
  if (checked) {
    doc.setFont("helvetica", "bold");
    doc.text("✓", x + 3, y);
  }
}

export async function printConsignorCopyPdf({
  consignment,
  shipments,
  packages,
}: ConsignmentPdfOptions) {
  const [companyResult, logo] = await Promise.all([
    supabase.from("company").select("company_name").limit(1).maybeSingle(),
    safeImageData("/garuda-logo.png"),
  ]);
  const companyName =
    text(companyResult.data?.company_name) || "GARUDA LOGISTICS SOLUTION PRIVATE LIMITED";
  const branch = (consignment.branch ?? {}) as AnyRecord;
  const branchAddress = [
    text(branch.address_line1),
    text(branch.address_line2),
    text(branch.area_locality),
    text(branch.city),
    text(branch.state) || "",
    text(branch.pin_code) ? `- ${text(branch.pin_code)}` : "",
  ].filter(Boolean);
  const shipment = shipments[0] ?? {};
  const items = shipments.flatMap((entry) => (entry.shipment_items ?? []) as AnyRecord[]);
  const packageRows = packages as AnyRecord[];
  const actualWeight = items.reduce((sum, item) => sum + num(item.weight_kg), 0);
  const packageWeight = packageRows.reduce((sum, item) => sum + num(item.weight_kg), 0);
  const chargedWeight = packageWeight;
  const articleCount =
    packageRows.reduce((sum, item) => sum + num(item.quantity), 0) ||
    items.reduce((sum, item) => sum + num(item.quantity), 0);
  const packageType = packageRows
    .map((entry) => text(entry.package_type))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ");
  const goodsDescription = items
    .map((item) => text(item.product_name) || text(item.description))
    .filter(Boolean)
    .join(", ");
  const gstRate = items.reduce(
    (sum, item) =>
      sum + num(item.gst_rate || item.cgst_rate) + num(item.sgst_rate) + num(item.igst_rate),
    0,
  );
  const billing = billingCheckboxes(consignment.billing_status);
  const vehicle = consignment.vehicle as AnyRecord | null | undefined;
  const fromName = partyName(shipment, "supplier");
  const toName = partyName(shipment, "recipient");
  const fromAddress = addressLines(shipment, "supplier");
  const toAddress = addressLines(shipment, "recipient");
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  pdf.setTextColor(...BLACK);
  pdf.setDrawColor(...BLACK);
  pdf.setLineWidth(0.7);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.3);

  // Outer frame and the reference's compact top-of-A4 form.
  pdf.rect(FORM_X, FORM_Y, FORM_W, FORM_H);
  pdf.line(375, FORM_Y, 375, 220.5);
  pdf.line(474, FORM_Y, 474, 77.5);
  pdf.line(375, 63, 474, 63);
  pdf.line(375, 77, FORM_X + FORM_W, 77);
  pdf.line(375, 90.5, FORM_X + FORM_W, 90.5);
  pdf.line(375, 104, FORM_X + FORM_W, 104);
  pdf.line(FORM_X, 130, FORM_X + FORM_W, 130);
  pdf.line(FORM_X, 175, 375, 175);
  pdf.line(375, 172, FORM_X + FORM_W, 172);
  pdf.line(438, 172, 438, 272);
  pdf.line(518, 172, 518, 272);
  pdf.line(FORM_X, 220, FORM_X + FORM_W, 220);
  pdf.line(FORM_X, 234.5, 267.5, 234.5);
  pdf.line(267.5, 234.5, 267.5, 272);
  pdf.line(FORM_X, 272, FORM_X + FORM_W, 272);
  pdf.line(FORM_X, 284.5, FORM_X + FORM_W, 284.5);
  pdf.line(FORM_X, 306.5, FORM_X + FORM_W, 306.5);
  pdf.line(235.8, 306.5, 235.8, FORM_Y + FORM_H);
  pdf.line(365, 306.5, 365, FORM_Y + FORM_H);
  pdf.line(FORM_X, 331.5, 580, 331.5);

  if (logo) pdf.addImage(logo, "PNG", 18.5, 62.3, 70, 61);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.5);
  field(pdf, "SAC Code :", "", 20, 57, 78);
  field(pdf, "GST No. :", text(branch.gstin), 112, 57, 100);
  field(pdf, "PAN No. :", text(branch.pan), 238, 57, 120);
  pdf.setFontSize(10);
  pdf.text(companyName, 93, 73);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);
  pdf.text(branchAddress.slice(0, 1).join(""), 119, 86);
  pdf.text(branchAddress.slice(1).join(" "), 174, 96);
  pdf.text(`GSTIN : ${text(branch.gstin)}`, 186, 107);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.7);
  pdf.text("CONSIGNOR COPY", 391, 58);
  field(pdf, "GR No. :", text(consignment.consignment_number), 476, 58, 97);
  field(
    pdf,
    "DATE :",
    date(consignment.consignment_date || consignment.created_at),
    408,
    71.5,
    160,
  );
  field(
    pdf,
    "Truck/Flight No. :",
    text(consignment.part_b_vehicle_no || vehicle?.registration_number),
    378,
    84.8,
    196,
  );
  field(pdf, "Mode of Movement :", text(consignment.transport_mode).toUpperCase(), 378, 98, 196);
  field(
    pdf,
    "From :",
    text(shipment.dispatch_from_place) || text(shipment.supplier_place),
    378,
    111.5,
    196,
  );

  pdf.setFontSize(7);
  field(pdf, "Consignor :", fromName, 20, 137, 348);
  let y = 148;
  fromAddress.forEach((line) => {
    y += drawWrapped(pdf, line, 20, y, 348, 7);
  });
  field(pdf, "GST No. :", text(shipment.supplier_gstin), 20, 169, 270);
  field(pdf, "M :", "0000000000", 315, 169, 55);
  field(pdf, "Consignee :", toName, 20, 182, 348);
  y = 193;
  toAddress.forEach((line) => {
    y += drawWrapped(pdf, line, 20, y, 348, 7);
  });
  field(pdf, "GST No. :", text(shipment.recipient_gstin), 20, 214, 270);
  field(pdf, "M :", "0000000000", 315, 214, 55);

  field(pdf, "To :", text(shipment.recipient_place), 378, 137, 196);
  field(pdf, "Packing Type :", packageType, 378, 151, 196);
  field(pdf, "Article :", articleCount ? String(articleCount) : "", 378, 165, 98);
  checkbox(pdf, 481, 165, "To Pay", billing.toPay);
  checkbox(pdf, 523, 165, "Paid", billing.paid);
  checkbox(pdf, 561, 165, "TBB", billing.tbb);
  pdf.setFont("helvetica", "bold");
  pdf.text("Actual Wt.", 379, 186);
  pdf.text("Particulars", 443, 186);
  pdf.text("Amount", 523, 186);
  pdf.setFont("helvetica", "normal");
  pdf.text(actualWeight ? numberString(actualWeight) : "", 395, 198);
  pdf.text("FREIGHT", 442, 200);
  pdf.text("Charged Wt.", 379, 211);
  pdf.text(chargedWeight ? numberString(chargedWeight) : "", 395, 224);
  pdf.text("", 523, 224);

  field(pdf, "Goods Description :", goodsDescription, 20, 230, 340);
  field(
    pdf,
    "Invoice No. :",
    shipments
      .map((entry) => text(entry.document_number))
      .filter(Boolean)
      .join(", "),
    20,
    245,
    240,
  );
  field(pdf, "PO No. :", "", 271, 245, 135);
  field(
    pdf,
    "Value :",
    shipments
      .map((entry) => money(entry.total_invoice_value))
      .filter(Boolean)
      .join(", "),
    20,
    256,
    240,
  );
  field(pdf, "Challan No. :", "", 271, 256, 135);
  field(pdf, "Date :", date(shipment.document_date), 20, 269, 240);
  field(pdf, "GST", `${gstRate.toFixed(2)}%`, 442, 269, 120);
  field(
    pdf,
    "E-Way Bill No. :",
    shipments
      .map((entry) => text(entry.eway_bill_number))
      .filter(Boolean)
      .join(", "),
    20,
    280,
    550,
  );
  field(pdf, "TOTAL", "", 518, 280, 58);
  field(pdf, "Remarks :", "", 20, 294, 550);
  field(pdf, "Rs in Words :", "", 20, 304, 550);
  field(pdf, "Delivery At :", text(shipment.recipient_place), 20, 318, 210);
  field(pdf, "Acknowledgement :", "Goods received in good condition", 239, 318, 120);
  field(pdf, "IGST Paid By :", "", 366, 318, 210);

  pdf.setFont("helvetica", "bold");
  pdf.text("Terms & Conditions :", 20, 337);
  pdf.setFont("helvetica", "normal");
  drawWrapped(
    pdf,
    "I/We hereby agree to the terms & conditions set out on the reverse of this consignor's copy & declare that the contents on the waybill are true and correct. The To-pay freight has my/our consent and will be paid by the consignee along with the applicable service charges at the time of delivery.",
    20,
    350,
    205,
    7,
  );
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(...RED);
  pdf.text(`FOR ${companyName}`, 371, 347);
  pdf.setTextColor(...BLACK);
  pdf.text("Signature with Stamp", 264, 385);
  pdf.text("Booking Clerk", 496, 385);
  pdf.setFontSize(6.5);
  pdf.text("Smart People Great Solution", A4_WIDTH / 2, 402, { align: "center" });
  pdf.setFontSize(7);
  pdf.text("POWERED BY ORCA DEVS SURF", A4_WIDTH / 2, A4_HEIGHT - 10, { align: "center" });

  const filename = `Consignor-Copy-${text(consignment.consignment_number) || "consignment"}.pdf`;
  pdf.save(filename);
}
